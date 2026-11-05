import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Intake, Question, Texts } from "../../service";
import { PLAIN, stubFetch, testResult, testRows, testSchema } from "../../testing";
import IntakeScreen from "./intake-screen";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "kq2V8yZx0bP4mT7nLw3sAg" }) }));

const INTAKE_URL = "/api/intakes/kq2V8yZx0bP4mT7nLw3sAg";
const ANSWERS_URL = `${INTAKE_URL}/answers`;
const TEXTS_URL = `${INTAKE_URL}/texts`;

function question(number: number, slot: string, text: string) {
  return {
    type: "question",
    number,
    slot,
    text,
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "not_sure", label: "Not sure" },
    ],
    ...PLAIN,
  } satisfies Question;
}

const FIRST = question(1, "stores_video", "Does the product store video?");
const SECOND = question(2, "shares_video", "Does the product share video with others?");

// An intake that waits for the answer to its second question, and the same intake at its end, with
// its result.
const waiting = {
  description: { purpose: "A door camera.", people: "Building staff." },
  answers: { uses_camera: "yes", audience: "staff", stores_video: "yes" },
  open_slots: [],
  not_sure: {},
  step: SECOND,
  result: null,
  texts: null,
} satisfies Intake;
const ended = {
  ...waiting,
  answers: { ...waiting.answers, shares_video: "no" },
  step: { type: "ready_to_confirm" },
  result: testResult,
} satisfies Intake;

// The result, then the recorded answers below it (GATE-4).
async function expectResultThenAnswers() {
  const result = await screen.findByRole("heading", { level: 1, name: "Result" });
  const answers = screen.getByRole("heading", { level: 2, name: "Recorded answers" });
  expect(result.compareDocumentPosition(answers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function sendAnswer(text: string, label: string) {
  fireEvent.click(within(screen.getByRole("group", { name: text })).getByRole("radio", { name: label }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
}

test("an intake that waits for an answer opens on that question, under the label of its fact as the heading, for example after a reload", async () => {
  stubFetch({ [INTAKE_URL]: Response.json(waiting), "/api/schema": Response.json(testSchema) });
  render(<IntakeScreen />);

  const heading = await screen.findByRole("heading", { level: 1, name: "Video sharing" });
  const group = screen.getByRole("group", { name: SECOND.text });
  expect(heading.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole("heading", { name: /Question/ })).toBeNull();
});

test("an intake that has ended opens on the result, with the recorded answers below it", async () => {
  stubFetch({ [INTAKE_URL]: Response.json(ended), "/api/schema": Response.json(testSchema) });
  render(<IntakeScreen />);

  await expectResultThenAnswers();
});

test("after an answer, the next question of the response is shown under the label of its fact, with no choice selected", async () => {
  stubFetch({
    [INTAKE_URL]: Response.json({ ...waiting, step: FIRST }),
    "/api/schema": Response.json(testSchema),
    [ANSWERS_URL]: Response.json({ step: SECOND }),
  });
  render(<IntakeScreen />);
  await screen.findByRole("group", { name: FIRST.text });
  expect(screen.getByRole("heading", { level: 1, name: "Video storage" })).toBeTruthy();

  sendAnswer(FIRST.text, "No");

  const second = await screen.findByRole("group", { name: SECOND.text });
  expect(screen.getByRole("heading", { level: 1, name: "Video sharing" })).toBeTruthy();
  const radios = within(second).getAllByRole("radio") as HTMLInputElement[];
  expect(radios.map((radio) => radio.checked)).toEqual([false, false, false]);
});

test("after the last answer, the intake is loaded again and the result and the recorded answers are shown", async () => {
  stubFetch({ [INTAKE_URL]: Response.json(waiting), "/api/schema": Response.json(testSchema) });
  render(<IntakeScreen />);
  await screen.findByRole("group", { name: SECOND.text });
  // The service as it is after the last answer.
  const fetchMock = stubFetch({
    [INTAKE_URL]: Response.json(ended),
    "/api/schema": Response.json(testSchema),
    [ANSWERS_URL]: Response.json({ step: { type: "ready_to_confirm" } }),
  });

  sendAnswer(SECOND.text, "No");

  await expectResultThenAnswers();
  expect(fetchMock.mock.calls.filter(([url]) => url === INTAKE_URL)).toHaveLength(1);
  expect(screen.getAllByRole("term").map((term) => term.textContent)).toContain("Video sharing");
});

test("while the intake loads, a status says that the answers are loading", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  render(<IntakeScreen />);

  expect(screen.getByRole("status").textContent).toBe("Loading the answers.");
});

test("after the last answer, the screen's status says that the result is loading until the result is shown, in the same element before, during and after the wait", async () => {
  stubFetch({ [INTAKE_URL]: Response.json(waiting), "/api/schema": Response.json(testSchema) });
  render(<IntakeScreen />);
  await screen.findByRole("group", { name: SECOND.text });
  // The screen's status comes first, before the status after Next. It is the same element in each
  // view of the screen, so that screen readers announce the change of its message.
  const [status] = screen.getAllByRole("status");
  expect(status.textContent).toBe("");
  const intake = Promise.withResolvers<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      if (input === ANSWERS_URL) return Response.json({ step: { type: "ready_to_confirm" } });
      if (input === "/api/schema") return Response.json(testSchema);
      return intake.promise;
    }),
  );

  sendAnswer(SECOND.text, "No");

  await waitFor(() => expect(status.textContent).toBe("Loading the result."));
  expect(screen.getAllByRole("status")).toEqual([status]);
  intake.resolve(Response.json(ended));
  await expectResultThenAnswers();
  expect(screen.getAllByRole("status")).toEqual([status]);
  expect(status.textContent).toBe("");
});

test("when the intake cannot be loaded, the message shows and the status is empty", async () => {
  stubFetch({
    [INTAKE_URL]: new Response(null, { status: 500 }),
    "/api/schema": Response.json(testSchema),
  });
  render(<IntakeScreen />);

  await screen.findByRole("alert");
  expect(screen.getByRole("status").textContent).toBe("");
});

test("when the intake cannot be loaded after the last answer, the message for a failed load shows", async () => {
  stubFetch({ [INTAKE_URL]: Response.json(waiting), "/api/schema": Response.json(testSchema) });
  render(<IntakeScreen />);
  await screen.findByRole("group", { name: SECOND.text });
  stubFetch({
    [INTAKE_URL]: new Response(null, { status: 500 }),
    "/api/schema": Response.json(testSchema),
    [ANSWERS_URL]: Response.json({ step: { type: "ready_to_confirm" } }),
  });

  sendAnswer(SECOND.text, "No");

  expect((await screen.findByRole("alert")).textContent).toBe(
    "The answers could not be loaded. Reload the page to try again.",
  );
});

test("an id that is not stored shows that the intake was not found", async () => {
  stubFetch({
    [INTAKE_URL]: Response.json({ error: { code: "not_found" } }, { status: 404 }),
    "/api/schema": Response.json(testSchema),
  });
  render(<IntakeScreen />);

  expect((await screen.findByRole("alert")).textContent).toBe("This intake was not found.");
});

test("a failed call shows a message", async () => {
  stubFetch({
    [INTAKE_URL]: new Response(null, { status: 500 }),
    "/api/schema": Response.json(testSchema),
  });
  render(<IntakeScreen />);

  expect((await screen.findByRole("alert")).textContent).toBe(
    "The answers could not be loaded. Reload the page to try again.",
  );
});

// The texts of the rows (issue #41): the result with rows under a result that applies, and the
// texts that the service writes for them.
const withRows = {
  ...testResult,
  gates: testResult.gates.map((gate) =>
    gate.gate === "storage" ? { ...gate, status: "applies" as const, conditions: [], rows: testRows } : gate,
  ),
};
const TEXTS: Texts = {
  "storage:rule:art5(1)": { meaning: "You must delete video after a month.", action: "Add a job that deletes old video." },
  "storage:rule:art6(1)": { meaning: "If you share video, show a notice.", action: "Draft the notice." },
};
const PLACEHOLDER = "Writing what this means for your product, and an action.";

function endedWith(texts: Texts) {
  return { ...ended, result: withRows, texts } satisfies Intake;
}

function textRequests(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(([input]) => String(input) === TEXTS_URL);
}

test("an ended intake with rows sends the request for the texts once, and shows the texts in the rows", async () => {
  const fetchMock = stubFetch({
    [INTAKE_URL]: Response.json(endedWith({})),
    "/api/schema": Response.json(testSchema),
    [TEXTS_URL]: Response.json({ texts: TEXTS }),
  });
  render(<IntakeScreen />);

  expect(await screen.findByText("Add a job that deletes old video.")).toBeTruthy();
  expect(screen.getByText("Draft the notice.")).toBeTruthy();
  const requests = textRequests(fetchMock);
  expect(requests).toHaveLength(1);
  expect(requests[0][1]?.method).toBe("POST");
  expect(screen.queryByText(PLACEHOLDER)).toBeNull();
});

test("while the request for the texts waits, the result and the rows show, each row with its placeholder", async () => {
  const texts = Promise.withResolvers<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      if (String(input) === TEXTS_URL) return texts.promise;
      if (String(input) === INTAKE_URL) return Response.json(endedWith({}));
      return Response.json(testSchema);
    }),
  );
  render(<IntakeScreen />);

  await expectResultThenAnswers();
  expect(await screen.findAllByText(PLACEHOLDER)).toHaveLength(2);
  expect(screen.getByRole("status").textContent).toBe(
    "Writing what each row means for your product, and an action. This takes a few seconds.",
  );
  texts.resolve(Response.json({ texts: TEXTS }));
  expect(await screen.findByText("Draft the notice.")).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe(""));
});

test("without the key, the screen sends no request for the texts and shows no placeholder", async () => {
  const fetchMock = stubFetch({ [INTAKE_URL]: Response.json(endedWith(null)), "/api/schema": Response.json(testSchema) });
  render(<IntakeScreen />);

  await expectResultThenAnswers();
  expect(screen.getAllByRole("rowheader")).toHaveLength(2);
  expect(textRequests(fetchMock)).toHaveLength(0);
  expect(screen.queryByText(PLACEHOLDER)).toBeNull();
});

test("texts that the service has stored show at once, with no request", async () => {
  const fetchMock = stubFetch({ [INTAKE_URL]: Response.json(endedWith(TEXTS)), "/api/schema": Response.json(testSchema) });
  render(<IntakeScreen />);

  expect(await screen.findByText("Draft the notice.")).toBeTruthy();
  expect(textRequests(fetchMock)).toHaveLength(0);
});

test("a failed request for the texts leaves each row with the line that its texts could not be written", async () => {
  stubFetch({
    [INTAKE_URL]: Response.json(endedWith({})),
    "/api/schema": Response.json(testSchema),
    [TEXTS_URL]: new Response(null, { status: 500 }),
  });
  render(<IntakeScreen />);

  expect(await screen.findAllByText("The meaning and the action of this row could not be written.")).toHaveLength(2);
  expect(screen.queryByText(PLACEHOLDER)).toBeNull();
});
