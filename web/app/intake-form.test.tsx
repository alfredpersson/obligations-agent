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

function description() {
  return screen.getByRole("textbox", { name: "What does the product do?" }) as HTMLTextAreaElement;
}

function sendButton() {
  return screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
}

// Answers both slots, the second with "Not sure", and fills in the description.
async function fillIn() {
  await screen.findByRole("button", { name: "Send" });
  fireEvent.click(radio("Does the product use a camera?", "Yes"));
  fireEvent.click(radio("Who uses the product?", "Not sure"));
  fireEvent.change(description(), { target: { value: "A door camera." } });
}

test("the form shows the description and every slot from the schema, in order, with no choice selected", async () => {
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
  expect(description().maxLength).toBe(300);
});

test("the description is the first field, so that the product is described before the questions", async () => {
  stubFetch({ "/api/schema": Response.json(testSchema) });
  render(<IntakeForm />);
  await screen.findByRole("button", { name: "Send" });

  expect(description().form?.elements[0]).toBe(description());
});

test("the form cannot be sent until every slot has an answer and the description is filled in", async () => {
  stubFetch({ "/api/schema": Response.json(testSchema) });
  render(<IntakeForm />);
  await screen.findByRole("button", { name: "Send" });
  expect(sendButton().disabled).toBe(true);

  fireEvent.click(radio("Does the product use a camera?", "Yes"));
  fireEvent.change(description(), { target: { value: "A door camera." } });
  expect(sendButton().disabled).toBe(true);

  // "Not sure" counts as an answer.
  fireEvent.click(radio("Who uses the product?", "Not sure"));
  expect(sendButton().disabled).toBe(false);

  fireEvent.change(description(), { target: { value: "   " } });
  expect(sendButton().disabled).toBe(true);

  fireEvent.change(description(), { target: { value: "" } });
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
    description: "A door camera.",
  });
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
  expect(description().value).toBe("A door camera.");
  expect(push).not.toHaveBeenCalled();
});
