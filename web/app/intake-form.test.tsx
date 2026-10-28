import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import IntakeForm from "./intake-form";
import { stubFetch, testSchema } from "./testing";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockClear();
});

function radio(question: string, label: string) {
  const group = screen.getByRole("group", { name: question });
  return within(group).getByRole("radio", { name: label }) as HTMLInputElement;
}

// A reason, and the note field, in the group of the slot with this question.
function reason(question: string, label: string) {
  const slot = screen.getByRole("group", { name: question });
  const group = within(slot).getByRole("group", { name: "Why are you not sure?" });
  return within(group).getByRole("radio", { name: label }) as HTMLInputElement;
}

function note(question: string) {
  const slot = screen.getByRole("group", { name: question });
  return within(slot).getByRole("textbox") as HTMLTextAreaElement;
}

// The questions of the two description fields in the test schema.
const PURPOSE = "What is the product for?";
const PEOPLE = "Who works with the product?";

function descriptionField(question: string) {
  return screen.getByRole("textbox", { name: question }) as HTMLTextAreaElement;
}

function sendButton() {
  return screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
}

// Answers both slots, the second with "Not sure", a reason and a note, and fills in both
// description fields.
async function fillIn() {
  await screen.findByRole("button", { name: "Send" });
  fireEvent.click(radio("Does the product use a camera?", "Yes"));
  fireEvent.click(radio("Who uses the product?", "Not sure"));
  fireEvent.click(reason("Who uses the product?", "I don't know this about the product"));
  fireEvent.change(note("Who uses the product?"), { target: { value: "Ask the facility manager." } });
  fireEvent.change(descriptionField(PURPOSE), { target: { value: "A door camera." } });
  fireEvent.change(descriptionField(PEOPLE), { target: { value: "Building staff." } });
}

test("the form shows the description fields and every slot from the schema, in order, with no choice selected", async () => {
  stubFetch({ "/api/schema": Response.json(testSchema) });
  render(<IntakeForm />);

  const camera = await screen.findByRole("group", { name: "Does the product use a camera?" });
  const audience = screen.getByRole("group", { name: "Who uses the product?" });
  expect(screen.getAllByRole("group")).toEqual([camera, audience]);
  const choices = {
    "Does the product use a camera?": ["Yes", "No", "Not sure"],
    "Who uses the product?": ["Staff", "The public", "Not sure"],
  };
  for (const [question, labels] of Object.entries(choices)) {
    for (const label of labels) expect(radio(question, label).checked).toBe(false);
  }
  expect(screen.getAllByRole("radio")).toHaveLength(6);
  expect(descriptionField(PURPOSE).maxLength).toBe(300);
  expect(descriptionField(PEOPLE).maxLength).toBe(200);
});

test("the description fields are the first fields, so that the product is described before the questions", async () => {
  stubFetch({ "/api/schema": Response.json(testSchema) });
  render(<IntakeForm />);
  await screen.findByRole("button", { name: "Send" });

  const fields = descriptionField(PURPOSE).form?.elements;
  expect(fields?.[0]).toBe(descriptionField(PURPOSE));
  expect(fields?.[1]).toBe(descriptionField(PEOPLE));
});

test("the form cannot be sent until every slot has an answer and every description field is filled in", async () => {
  stubFetch({ "/api/schema": Response.json(testSchema) });
  render(<IntakeForm />);
  await screen.findByRole("button", { name: "Send" });
  expect(sendButton().disabled).toBe(true);

  fireEvent.click(radio("Does the product use a camera?", "Yes"));
  fireEvent.change(descriptionField(PURPOSE), { target: { value: "A door camera." } });
  fireEvent.change(descriptionField(PEOPLE), { target: { value: "Building staff." } });
  expect(sendButton().disabled).toBe(true);

  // "Not sure" counts as an answer once it has a reason.
  fireEvent.click(radio("Who uses the product?", "Not sure"));
  expect(sendButton().disabled).toBe(true);
  fireEvent.click(reason("Who uses the product?", "I don't know this about the product"));
  expect(sendButton().disabled).toBe(false);

  fireEvent.change(descriptionField(PEOPLE), { target: { value: "   " } });
  expect(sendButton().disabled).toBe(true);

  fireEvent.change(descriptionField(PEOPLE), { target: { value: "" } });
  expect(sendButton().disabled).toBe(true);

  fireEvent.change(descriptionField(PEOPLE), { target: { value: "Building staff." } });
  fireEvent.change(descriptionField(PURPOSE), { target: { value: "" } });
  expect(sendButton().disabled).toBe(true);
});

test("a sent form creates the intake and opens the screen with the recorded answers", async () => {
  const fetchMock = stubFetch({
    "/api/schema": Response.json(testSchema),
    "/api/intakes": Response.json(
      { id: "kq2V8yZx0bP4mT7nLw3sAg", step: { type: "ready_to_confirm" } },
      { status: 201 },
    ),
  });
  render(<IntakeForm />);
  await fillIn();
  fireEvent.click(sendButton());

  await waitFor(() => expect(push).toHaveBeenCalledWith("/intakes/kq2V8yZx0bP4mT7nLw3sAg"));
  const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/intakes") ?? [];
  expect(init?.method).toBe("POST");
  expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  expect(JSON.parse(String(init?.body))).toEqual({
    answers: { uses_camera: "yes", audience: "not_sure" },
    description: { purpose: "A door camera.", people: "Building staff." },
    not_sure: { audience: { reason: "unknown", note: "Ask the facility manager." } },
  });
});

test("Send is disabled while the answers are sent, so that a second click sends nothing", async () => {
  let fail: (error: Error) => void = () => {};
  const fetchMock = vi.fn<typeof fetch>((input) =>
    input === "/api/schema"
      ? Promise.resolve(Response.json(testSchema))
      : new Promise<Response>((_, reject) => {
          fail = reject;
        }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<IntakeForm />);
  await fillIn();

  fireEvent.click(sendButton());
  await waitFor(() => expect(sendButton().disabled).toBe(true));
  fireEvent.click(sendButton());
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/intakes")).toHaveLength(1);

  // After a failure, Send can be used again.
  fail(new TypeError("fetch failed"));
  await screen.findByRole("alert");
  await waitFor(() => expect(sendButton().disabled).toBe(false));
});

test.each([
  ["a 500 response", new Response(null, { status: 500 })],
  ["a fetch that fails", new TypeError("fetch failed")],
])("when the schema cannot be loaded (%s), a message shows in place of the form", async (_, result) => {
  stubFetch({ "/api/schema": result });
  render(<IntakeForm />);

  expect((await screen.findByRole("alert")).textContent).not.toBe("");
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
});

test.each([
  [
    "a 422 response",
    Response.json({ error: { code: "invalid_value", field: "description" } }, { status: 422 }),
  ],
  ["a fetch that fails", new TypeError("fetch failed")],
])("when sending fails (%s), a message shows and the form keeps the answers", async (_, result) => {
  stubFetch({ "/api/schema": Response.json(testSchema), "/api/intakes": result });
  render(<IntakeForm />);
  await fillIn();
  fireEvent.click(sendButton());

  expect((await screen.findByRole("alert")).textContent).not.toBe("");
  expect(radio("Does the product use a camera?", "Yes").checked).toBe(true);
  expect(radio("Who uses the product?", "Not sure").checked).toBe(true);
  expect(reason("Who uses the product?", "I don't know this about the product").checked).toBe(true);
  expect(note("Who uses the product?").value).toBe("Ask the facility manager.");
  expect(descriptionField(PURPOSE).value).toBe("A door camera.");
  expect(descriptionField(PEOPLE).value).toBe("Building staff.");
  expect(push).not.toHaveBeenCalled();
});

test("the value not_sure, whatever its label, shows the reasons below the options of its slot and in no other group, until another option is chosen", async () => {
  // "Not sure" has another label here: the form finds the option by its value.
  const schema = {
    ...testSchema,
    slots: testSchema.slots.map((slot) => ({
      ...slot,
      values: slot.values.map((value) => (value.id === "not_sure" ? { ...value, label: "Can't say" } : value)),
    })),
  };
  stubFetch({ "/api/schema": Response.json(schema) });
  render(<IntakeForm />);
  await screen.findByRole("button", { name: "Send" });
  expect(screen.queryByRole("group", { name: "Why are you not sure?" })).toBeNull();

  fireEvent.click(radio("Who uses the product?", "Can't say"));

  const slot = screen.getByRole("group", { name: "Who uses the product?" });
  const reasons = within(slot).getByRole("group", { name: "Why are you not sure?" });
  expect(radio("Who uses the product?", "Can't say").compareDocumentPosition(reasons)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(screen.getAllByRole("group", { name: "Why are you not sure?" })).toEqual([reasons]);

  fireEvent.click(radio("Who uses the product?", "Staff"));
  expect(screen.queryByRole("group", { name: "Why are you not sure?" })).toBeNull();
});

test("a reason and a note entered for a slot that then gets another answer are not sent", async () => {
  const fetchMock = stubFetch({
    "/api/schema": Response.json(testSchema),
    "/api/intakes": Response.json(
      { id: "kq2V8yZx0bP4mT7nLw3sAg", step: { type: "ready_to_confirm" } },
      { status: 201 },
    ),
  });
  render(<IntakeForm />);
  await fillIn();
  fireEvent.click(radio("Does the product use a camera?", "Not sure"));
  fireEvent.click(reason("Does the product use a camera?", "I don't understand the question"));
  fireEvent.change(note("Does the product use a camera?"), { target: { value: "Which camera?" } });
  fireEvent.click(radio("Does the product use a camera?", "Yes"));

  fireEvent.click(sendButton());

  await waitFor(() => expect(push).toHaveBeenCalled());
  const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/intakes") ?? [];
  expect(JSON.parse(String(init?.body)).not_sure).toEqual({
    audience: { reason: "unknown", note: "Ask the facility manager." },
  });
});

test("two slots answered not_sure each get their own reasons, and Send waits for both", async () => {
  stubFetch({ "/api/schema": Response.json(testSchema) });
  render(<IntakeForm />);
  await fillIn();

  fireEvent.click(radio("Does the product use a camera?", "Not sure"));
  expect(sendButton().disabled).toBe(true);
  fireEvent.click(reason("Does the product use a camera?", "I don't understand the question"));

  expect(sendButton().disabled).toBe(false);
  expect(reason("Who uses the product?", "I don't know this about the product").checked).toBe(true);
  expect(note("Who uses the product?").value).toBe("Ask the facility manager.");
  // Radio buttons with the same name form one group in the browser.
  expect(reason("Does the product use a camera?", "I don't understand the question").name).not.toBe(
    reason("Who uses the product?", "I don't know this about the product").name,
  );
});
