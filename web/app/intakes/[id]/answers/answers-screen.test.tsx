import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Asked, Intake } from "../../../service";
import { PLAIN, stubFetch, testSchema } from "../../../testing";
import AnswersScreen from "./answers-screen";

// The address of the screen is /intakes/<id>/answers, and ?change=<slot> opens a fact's question.
const { router, search } = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  search: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "kq2V8yZx0bP4mT7nLw3sAg" }),
  useRouter: () => router,
  useSearchParams: () => search,
}));

const SCREEN = "/intakes/kq2V8yZx0bP4mT7nLw3sAg/answers";
const INTAKE_URL = "/api/intakes/kq2V8yZx0bP4mT7nLw3sAg";
const CONFIRM_URL = `${INTAKE_URL}/confirm`;

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "not_sure", label: "Not sure" },
];

function question(slot: string, text: string, more: Partial<Asked> = {}): Asked {
  return { slot, text, options: YES_NO, ...PLAIN, ...more };
}

// An ended intake of the test schema whose answers are not confirmed: the camera "yes"; the
// audience "not sure" with its reason and its note; the video storage "yes", asked by the model
// with an explanation, what each answer means and a check line; and the video sharing relevant and
// not asked.
const STORAGE = question("stores_video", "Does the door camera keep its video?", {
  explanation: "Keeping covers any copy of the video.",
  meaning: "Yes means the camera or a server keeps the video.",
  check: "Check where the camera sends its video.",
});
const intake = {
  description: { purpose: "A door camera.", people: "Building staff." },
  answers: { uses_camera: "yes", audience: "not_sure", stores_video: "yes" },
  open_slots: ["audience", "shares_video"],
  not_sure: { audience: { reason: "unknown", note: "We sell to both." } },
  questions: {
    uses_camera: question("uses_camera", "Does the product use a camera?"),
    audience: {
      slot: "audience",
      text: "Who uses the product?",
      options: [
        { value: "staff", label: "Staff" },
        { value: "public", label: "The public" },
        { value: "not_sure", label: "Not sure" },
      ],
      ...PLAIN,
    },
    stores_video: STORAGE,
    shares_video: question("shares_video", "Does the product share video with others?"),
  },
  step: { type: "ready_to_confirm" },
  confirmed: false,
  result: null,
  texts: null,
} satisfies Intake;

// The elements that the screen scrolled into view. jsdom does not scroll.
let scrolled: Element[] = [];

beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  search.delete("change");
  history.replaceState(null, "", "/");
});

function stubIntake(shown: Intake = intake, more: Record<string, Response> = {}) {
  return stubFetch({ [INTAKE_URL]: Response.json(shown), "/api/schema": Response.json(testSchema), ...more });
}

// The label of each fact in a list, and its answer, its reason and its note.
function facts(name: string) {
  const region = screen.getByRole("region", { name });
  return within(region)
    .getAllByRole("term")
    .map((term) => [
      term.textContent,
      ...[...(term.parentElement?.querySelectorAll("dd") ?? [])].map((item) => item.textContent),
    ]);
}

test("the screen lists the open facts first, then the answered facts, each with the label of its answer, and a not sure answer with its reason and its note", async () => {
  stubIntake();
  render(<AnswersScreen />);

  await screen.findByRole("heading", { level: 1, name: "Check your answers" });
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
    "Open answers",
    "Your answers",
  ]);
  expect(screen.getByText(/answers are open/).textContent).toBe(
    "2 answers are open. Each result that depends on one of them is conditional.",
  );
  expect(facts("Open answers")).toEqual([
    ["Audience", "Not sure · I don't know this about the product", "Note: We sell to both.", "Answer"],
    ["Video sharing", "Not answered yet", "Answer"],
  ]);
  expect(facts("Your answers")).toEqual([
    ["Camera", "Yes", "Change"],
    ["Video storage", "Yes", "Change"],
  ]);
});

test("with no open fact, the screen has no list of open answers", async () => {
  stubIntake({
    ...intake,
    answers: { ...intake.answers, audience: "staff", shares_video: "no" },
    open_slots: [],
    not_sure: {},
  });
  render(<AnswersScreen />);

  await screen.findByRole("heading", { level: 1, name: "Check your answers" });
  expect(screen.queryByRole("heading", { name: "Open answers" })).toBeNull();
  expect(facts("Your answers").map(([label]) => label)).toEqual(["Camera", "Audience", "Video storage", "Video sharing"]);
});

test("each fact has its slot id as its anchor, and links to its question, an open fact with Answer and another with Change", async () => {
  stubIntake();
  render(<AnswersScreen />);

  await screen.findByRole("heading", { level: 1, name: "Check your answers" });
  for (const [name, slot] of [
    ["Answer Audience", "audience"],
    ["Answer Video sharing", "shares_video"],
    ["Change Camera", "uses_camera"],
    ["Change Video storage", "stores_video"],
  ]) {
    const link = screen.getByRole("link", { name });
    expect(link.getAttribute("href")).toBe(`${SCREEN}?change=${slot}`);
    expect(link.closest("[id]")?.id).toBe(slot);
  }
});

test("the description shows folded, each field under its label, with the line that it cannot change", async () => {
  stubIntake();
  render(<AnswersScreen />);

  const summary = await screen.findByText("Show your description");
  const folded = summary.closest("details");
  expect(folded?.open).toBe(false);
  expect(folded?.textContent).toBe(
    "Show your descriptionThe description cannot change. Start a new intake for another description.PurposeA door camera.PeopleBuilding staff.",
  );
});

test("the screen shows no result and sends no request for the texts", async () => {
  const fetchMock = stubIntake();
  render(<AnswersScreen />);

  await screen.findByRole("heading", { level: 1, name: "Check your answers" });
  expect(screen.queryByRole("heading", { name: "Result" })).toBeNull();
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([INTAKE_URL, "/api/schema"]);
});

test("at ?change=<slot>, the fact's question shows as its own screen under the fact's label, as a follow-up question, with the current answer chosen", async () => {
  search.set("change", "stores_video");
  stubIntake();
  render(<AnswersScreen />);

  const heading = await screen.findByRole("heading", { level: 1, name: "Video storage" });
  expect(screen.queryByRole("heading", { name: "Check your answers" })).toBeNull();
  const group = screen.getByRole("group", { name: STORAGE.text });
  // The explanation and the check line before the question, and what each answer means in it.
  for (const text of [STORAGE.explanation, STORAGE.check]) {
    const paragraph = screen.getByText(text);
    expect(heading.compareDocumentPosition(paragraph) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(paragraph.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(within(group).getByText(STORAGE.meaning)).toBeTruthy();
  expect((within(group).getByRole("radio", { name: "Yes" }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole("link", { name: "Back to your answers" }).getAttribute("href")).toBe(`${SCREEN}#stores_video`);
});

test("an open fact's question opens with not sure chosen, with its reason and its note", async () => {
  search.set("change", "audience");
  stubIntake();
  render(<AnswersScreen />);

  const group = await screen.findByRole("group", { name: "Who uses the product?" });
  expect((within(group).getByRole("radio", { name: "Not sure" }) as HTMLInputElement).checked).toBe(true);
  const reasons = within(group).getByRole("group", { name: "Why are you not sure?" });
  expect((within(reasons).getByRole("radio", { name: "I don't know this about the product" }) as HTMLInputElement).checked).toBe(
    true,
  );
  expect((within(group).getByRole("textbox") as HTMLTextAreaElement).value).toBe("We sell to both.");
});

test("a fact without an answer opens with no choice, and Save the answer stays disabled until one is chosen", async () => {
  search.set("change", "shares_video");
  stubIntake();
  render(<AnswersScreen />);

  const group = await screen.findByRole("group", { name: "Does the product share video with others?" });
  expect((within(group).getAllByRole("radio") as HTMLInputElement[]).map((radio) => radio.checked)).toEqual([
    false,
    false,
    false,
  ]);
  const save = screen.getByRole("button", { name: "Save the answer" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.click(within(group).getByRole("radio", { name: "No" }));
  expect(save.disabled).toBe(false);
});

// The service's answer to the change: the intake with the video storage "no".
const changed = { ...intake, answers: { ...intake.answers, stores_video: "no" } } satisfies Intake;

test("Save the answer sends the change, and the list shows the intake of the response at the fact, in place of the question", async () => {
  search.set("change", "stores_video");
  const fetchMock = stubIntake(intake, { [`${INTAKE_URL}/answers/stores_video`]: Response.json(changed) });
  const { rerender } = render(<AnswersScreen />);
  const group = await screen.findByRole("group", { name: STORAGE.text });

  fireEvent.click(within(group).getByRole("radio", { name: "No" }));
  fireEvent.click(screen.getByRole("button", { name: "Save the answer" }));

  await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`${SCREEN}#stores_video`));
  const [, init] = fetchMock.mock.calls.find(([url]) => url === `${INTAKE_URL}/answers/stores_video`) ?? [];
  expect(init?.method).toBe("PUT");
  expect(JSON.parse(String(init?.body))).toEqual({ value: "no" });
  // The navigation to the list: Next.js gives the screen the address without ?change.
  search.delete("change");
  history.replaceState(null, "", `${SCREEN}#stores_video`);
  rerender(<AnswersScreen />);
  await screen.findByRole("heading", { level: 1, name: "Check your answers" });
  expect(facts("Your answers")).toContainEqual(["Video storage", "No", "Change"]);
  expect(scrolled.map((element) => element.id)).toEqual(["stores_video"]);
});

test("a not sure answer is sent only with a reason, and with its note when one is written", async () => {
  search.set("change", "shares_video");
  const fetchMock = stubIntake(intake, { [`${INTAKE_URL}/answers/shares_video`]: Response.json(intake) });
  render(<AnswersScreen />);
  const group = await screen.findByRole("group", { name: "Does the product share video with others?" });
  const save = screen.getByRole("button", { name: "Save the answer" }) as HTMLButtonElement;

  fireEvent.click(within(group).getByRole("radio", { name: "Not sure" }));
  expect(save.disabled).toBe(true);
  fireEvent.click(within(group).getByRole("radio", { name: "I don't understand the question" }));
  expect(save.disabled).toBe(false);
  fireEvent.change(within(group).getByRole("textbox"), { target: { value: "Does a link to a clip count?" } });
  fireEvent.click(save);

  await waitFor(() => expect(router.replace).toHaveBeenCalled());
  const [, init] = fetchMock.mock.calls.find(([url]) => url === `${INTAKE_URL}/answers/shares_video`) ?? [];
  expect(JSON.parse(String(init?.body))).toEqual({
    value: "not_sure",
    not_sure: { reason: "unclear", note: "Does a link to a clip count?" },
  });
});

test("a failed change keeps the question and says that the answer could not be sent", async () => {
  search.set("change", "stores_video");
  stubIntake(intake, { [`${INTAKE_URL}/answers/stores_video`]: new Response(null, { status: 500 }) });
  render(<AnswersScreen />);
  const group = await screen.findByRole("group", { name: STORAGE.text });

  fireEvent.click(within(group).getByRole("radio", { name: "No" }));
  fireEvent.click(screen.getByRole("button", { name: "Save the answer" }));

  expect((await screen.findByRole("alert")).textContent).toBe("The answer could not be sent. Try again.");
  expect(screen.getByRole("group", { name: STORAGE.text })).toBeTruthy();
  expect(router.replace).not.toHaveBeenCalled();
});

test("Confirm sends the confirmation, stays disabled while it is sent, and then shows the result", async () => {
  const confirmed = Promise.withResolvers<Response>();
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    if (input === CONFIRM_URL) return confirmed.promise;
    return input === INTAKE_URL ? Response.json(intake) : Response.json(testSchema);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<AnswersScreen />);
  const confirm = (await screen.findByRole("button", { name: "Confirm and show the result" })) as HTMLButtonElement;

  fireEvent.click(confirm);

  await waitFor(() => expect(confirm.disabled).toBe(true));
  expect(fetchMock.mock.calls.find(([url]) => url === CONFIRM_URL)?.[1]?.method).toBe("POST");
  confirmed.resolve(Response.json({ ...intake, confirmed: true }));
  await waitFor(() => expect(router.push).toHaveBeenCalledWith("/intakes/kq2V8yZx0bP4mT7nLw3sAg"));
});

test("a failed confirmation stays on the screen and says so", async () => {
  stubIntake(intake, { [CONFIRM_URL]: new Response(null, { status: 500 }) });
  render(<AnswersScreen />);

  fireEvent.click(await screen.findByRole("button", { name: "Confirm and show the result" }));

  expect((await screen.findByRole("alert")).textContent).toBe("The answers could not be confirmed. Try again.");
  expect(router.push).not.toHaveBeenCalled();
});

test("while a question waits, the screen goes to the question in place of itself", async () => {
  stubIntake({ ...intake, step: { type: "question", number: 2, ...STORAGE } });
  render(<AnswersScreen />);

  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/intakes/kq2V8yZx0bP4mT7nLw3sAg"));
  expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
});

test("while the answers load, a status says so", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  render(<AnswersScreen />);

  expect(screen.getByRole("status").textContent).toBe("Loading the answers.");
});

test.each([
  [new Response(null, { status: 500 }), "The answers could not be loaded. Reload the page to try again."],
  [Response.json({ error: { code: "not_found" } }, { status: 404 }), "This intake was not found."],
])("a failed load shows its message, and the status is empty", async (response, message) => {
  stubFetch({ [INTAKE_URL]: response, "/api/schema": Response.json(testSchema) });
  render(<AnswersScreen />);

  expect((await screen.findByRole("alert")).textContent).toBe(message);
  expect(screen.getByRole("status").textContent).toBe("");
});

test("the screen scrolls to the fact in the address once the answers show", async () => {
  history.replaceState(null, "", `${SCREEN}#shares_video`);
  stubIntake();
  render(<AnswersScreen />);

  await screen.findByRole("heading", { level: 1, name: "Check your answers" });
  expect(scrolled.map((element) => element.id)).toEqual(["shares_video"]);
});

// Next.js keeps a visited page and shows it again with Activity, for example on Back from the
// result.
test("a page that is hidden and shown again loads the answers again, and does not show the answers loaded before while it loads", async () => {
  stubIntake();
  const { rerender } = render(
    <Activity mode="visible">
      <AnswersScreen />
    </Activity>,
  );
  await screen.findByRole("heading", { level: 1, name: "Check your answers" });
  rerender(
    <Activity mode="hidden">
      <AnswersScreen />
    </Activity>,
  );
  const later = Promise.withResolvers<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => (input === INTAKE_URL ? later.promise : Response.json(testSchema))),
  );

  rerender(
    <Activity mode="visible">
      <AnswersScreen />
    </Activity>,
  );

  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Loading the answers."));
  expect(screen.queryByText("Not answered yet")).toBeNull();
  later.resolve(Response.json(changed));
  await screen.findByRole("heading", { level: 1, name: "Check your answers" });
  expect(facts("Your answers")).toContainEqual(["Video storage", "No", "Change"]);
});
