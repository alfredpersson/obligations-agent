import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Question } from "../../service";
import { stubFetch } from "../../testing";
import FollowUpQuestion from "./follow-up-question";

const ID = "kq2V8yZx0bP4mT7nLw3sAg";
const ANSWERS_URL = `/api/intakes/${ID}/answers`;

// The text and the option labels differ from the test schema: the screen shows those of the step.
const question = {
  type: "question",
  number: 2,
  text: "Is video from the camera kept after it is shown?",
  options: [
    { value: "yes", label: "Yes, it is kept" },
    { value: "no", label: "No, it is not kept" },
    { value: "not_sure", label: "Not sure" },
  ],
} satisfies Question;

// The model writes the labels, so the screen finds the option "not sure" by its value.
const unsure = {
  ...question,
  options: [
    { value: "yes", label: "Yes, it is kept" },
    { value: "no", label: "No, it is not kept" },
    { value: "not_sure", label: "I don't know" },
  ],
} satisfies Question;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function choice(label: string) {
  const group = screen.getByRole("group", { name: question.text });
  return within(group).getByRole("radio", { name: label }) as HTMLInputElement;
}

function nextButton() {
  return screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
}

function reason(label: string) {
  const group = screen.getByRole("group", { name: "Why are you not sure?" });
  return within(group).getByRole("radio", { name: label }) as HTMLInputElement;
}

function note() {
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

test("the question shows its number, its text and the options of the step, none selected, and Next is disabled until a choice is selected", () => {
  render(<FollowUpQuestion id={ID} question={question} onStep={vi.fn()} />);

  expect(screen.getByRole("heading", { level: 1, name: "Question 2" })).toBeTruthy();
  const radios = within(screen.getByRole("group", { name: question.text })).getAllByRole(
    "radio",
  ) as HTMLInputElement[];
  expect(radios.map((radio) => radio.parentElement?.textContent)).toEqual([
    "Yes, it is kept",
    "No, it is not kept",
    "Not sure",
  ]);
  expect(radios.map((radio) => radio.checked)).toEqual([false, false, false]);
  expect(nextButton().disabled).toBe(true);

  fireEvent.click(choice("No, it is not kept"));
  expect(nextButton().disabled).toBe(false);
});

test("a sent answer posts the question number and the value of the choice, and passes on the step of the response", async () => {
  const next = {
    type: "question",
    number: 3,
    text: "Does the product share video with others?",
    options: [{ value: "not_sure", label: "Not sure" }],
  } satisfies Question;
  const fetchMock = stubFetch({ [ANSWERS_URL]: Response.json({ step: next }) });
  const onStep = vi.fn();
  render(<FollowUpQuestion id={ID} question={question} onStep={onStep} />);

  fireEvent.click(choice("No, it is not kept"));
  fireEvent.click(nextButton());

  await waitFor(() => expect(onStep).toHaveBeenCalledWith(next));
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  expect(url).toBe(ANSWERS_URL);
  expect(init?.method).toBe("POST");
  // The service refuses a JSON body without this header.
  expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  expect(JSON.parse(String(init?.body))).toEqual({ question: 2, value: "no" });
});

test("Next is disabled while the answer is sent, so that a second click sends nothing", async () => {
  const { promise, reject } = Promise.withResolvers<Response>();
  const fetchMock = vi.fn<typeof fetch>(() => promise);
  vi.stubGlobal("fetch", fetchMock);
  render(<FollowUpQuestion id={ID} question={question} onStep={vi.fn()} />);
  fireEvent.click(choice("Yes, it is kept"));

  fireEvent.click(nextButton());
  await waitFor(() => expect(nextButton().disabled).toBe(true));
  fireEvent.click(nextButton());
  expect(fetchMock).toHaveBeenCalledTimes(1);

  // After a failure, Next can be used again.
  reject(new TypeError("fetch failed"));
  await screen.findByRole("alert");
  await waitFor(() => expect(nextButton().disabled).toBe(false));
});

test.each([
  ["a 500 response", new Response(null, { status: 500 })],
  [
    "a 422 response",
    Response.json({ error: { code: "invalid_value", field: "value" } }, { status: 422 }),
  ],
  ["a fetch that fails", new TypeError("fetch failed")],
])("when sending fails (%s), a message shows and the choice, the reason and the note stay", async (_, result) => {
  stubFetch({ [ANSWERS_URL]: result });
  const onStep = vi.fn();
  render(<FollowUpQuestion id={ID} question={question} onStep={onStep} />);
  fireEvent.click(choice("Not sure"));
  fireEvent.click(reason("I don't understand the question"));
  fireEvent.change(note(), { target: { value: "Which video?" } });

  fireEvent.click(nextButton());

  expect((await screen.findByRole("alert")).textContent).not.toBe("");
  expect(choice("Not sure").checked).toBe(true);
  expect(reason("I don't understand the question").checked).toBe(true);
  expect(note().value).toBe("Which video?");
  expect(onStep).not.toHaveBeenCalled();
});

test("the option with the value not_sure, whatever its label, shows the two reasons below the options, none chosen, until another option is chosen", () => {
  render(<FollowUpQuestion id={ID} question={unsure} onStep={vi.fn()} />);
  expect(screen.queryByRole("group", { name: "Why are you not sure?" })).toBeNull();

  fireEvent.click(choice("I don't know"));

  const group = within(screen.getByRole("group", { name: question.text })).getByRole("group", {
    name: "Why are you not sure?",
  });
  expect(choice("I don't know").compareDocumentPosition(group)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  const radios = within(group).getAllByRole("radio") as HTMLInputElement[];
  expect(radios.map((radio) => radio.parentElement?.textContent)).toEqual([
    "I don't understand the question",
    "I don't know this about the product",
  ]);
  expect(radios.map((radio) => radio.checked)).toEqual([false, false]);

  fireEvent.click(choice("No, it is not kept"));
  expect(screen.queryByRole("group", { name: "Why are you not sure?" })).toBeNull();
});

test("a note field of at most 500 characters appears once a reason is chosen, with a label that follows the reason", () => {
  render(<FollowUpQuestion id={ID} question={unsure} onStep={vi.fn()} />);
  fireEvent.click(choice("I don't know"));
  expect(screen.queryByRole("textbox")).toBeNull();

  fireEvent.click(reason("I don't understand the question"));
  const unclear = screen.getByRole("textbox", {
    name: "What is unclear about the question? (optional)",
  }) as HTMLTextAreaElement;
  expect(unclear.maxLength).toBe(500);
  fireEvent.change(unclear, { target: { value: "Which video?" } });

  // The label changes with the reason, and the text stays.
  fireEvent.click(reason("I don't know this about the product"));
  expect(screen.getAllByRole("textbox")).toEqual([
    screen.getByRole("textbox", { name: "What do you need to check? (optional)" }),
  ]);
  expect(note().value).toBe("Which video?");
});

test("Next stays disabled after the option not_sure until a reason is chosen, and the note is optional", () => {
  render(<FollowUpQuestion id={ID} question={unsure} onStep={vi.fn()} />);
  fireEvent.click(choice("I don't know"));
  expect(nextButton().disabled).toBe(true);

  fireEvent.click(reason("I don't know this about the product"));
  expect(nextButton().disabled).toBe(false);
});

test("a not_sure answer posts its reason and its note", async () => {
  const fetchMock = stubFetch({
    [ANSWERS_URL]: Response.json({ step: { type: "ready_to_confirm" } }),
  });
  const onStep = vi.fn();
  render(<FollowUpQuestion id={ID} question={unsure} onStep={onStep} />);
  fireEvent.click(choice("I don't know"));
  fireEvent.click(reason("I don't understand the question"));
  fireEvent.change(note(), { target: { value: "Which video?" } });

  fireEvent.click(nextButton());

  await waitFor(() => expect(onStep).toHaveBeenCalled());
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    question: 2,
    value: "not_sure",
    not_sure: { reason: "unclear", note: "Which video?" },
  });
});

test("the reason and the note stay while another option is chosen, and another answer posts neither", async () => {
  const fetchMock = stubFetch({
    [ANSWERS_URL]: Response.json({ step: { type: "ready_to_confirm" } }),
  });
  const onStep = vi.fn();
  render(<FollowUpQuestion id={ID} question={unsure} onStep={onStep} />);
  fireEvent.click(choice("I don't know"));
  fireEvent.click(reason("I don't understand the question"));
  fireEvent.change(note(), { target: { value: "Which video?" } });
  fireEvent.click(choice("No, it is not kept"));
  fireEvent.click(choice("I don't know"));
  expect(reason("I don't understand the question").checked).toBe(true);
  expect(note().value).toBe("Which video?");
  fireEvent.click(choice("No, it is not kept"));

  fireEvent.click(nextButton());

  await waitFor(() => expect(onStep).toHaveBeenCalled());
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ question: 2, value: "no" });
});
