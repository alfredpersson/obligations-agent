import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Intake, Question } from "../../service";
import { stubFetch, testSchema } from "../../testing";
import IntakeScreen from "./intake-screen";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "kq2V8yZx0bP4mT7nLw3sAg" }) }));

const INTAKE_URL = "/api/intakes/kq2V8yZx0bP4mT7nLw3sAg";
const ANSWERS_URL = `${INTAKE_URL}/answers`;

function question(number: number, text: string) {
  return {
    type: "question",
    number,
    text,
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "not_sure", label: "Not sure" },
    ],
  } satisfies Question;
}

const FIRST = question(1, "Does the product store video?");
const SECOND = question(2, "Does the product share video with others?");

// An intake that waits for the answer to its second question, and the same intake at its end.
const waiting = {
  description: { purpose: "A door camera.", people: "Building staff." },
  answers: { uses_camera: "yes", audience: "staff", stores_video: "yes" },
  open_slots: [],
  step: SECOND,
} satisfies Intake;
const ended = {
  ...waiting,
  answers: { ...waiting.answers, shares_video: "no" },
  step: { type: "ready_to_confirm" },
} satisfies Intake;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function sendAnswer(text: string, label: string) {
  fireEvent.click(within(screen.getByRole("group", { name: text })).getByRole("radio", { name: label }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
}

test("an intake that waits for an answer opens on that question, for example after a reload", async () => {
  stubFetch({ [INTAKE_URL]: Response.json(waiting), "/api/schema": Response.json(testSchema) });
  render(<IntakeScreen />);

  expect(await screen.findByRole("heading", { level: 1, name: "Question 2" })).toBeTruthy();
  expect(screen.getByRole("group", { name: SECOND.text })).toBeTruthy();
});

test("an intake that has ended opens on the recorded answers", async () => {
  stubFetch({ [INTAKE_URL]: Response.json(ended), "/api/schema": Response.json(testSchema) });
  render(<IntakeScreen />);

  expect(await screen.findByRole("heading", { level: 1, name: "Recorded answers" })).toBeTruthy();
});

test("after an answer, the next question of the response is shown with no choice selected", async () => {
  stubFetch({
    [INTAKE_URL]: Response.json({ ...waiting, step: FIRST }),
    "/api/schema": Response.json(testSchema),
    [ANSWERS_URL]: Response.json({ step: SECOND }),
  });
  render(<IntakeScreen />);
  await screen.findByRole("group", { name: FIRST.text });

  sendAnswer(FIRST.text, "No");

  const second = await screen.findByRole("group", { name: SECOND.text });
  expect(screen.getByRole("heading", { level: 1, name: "Question 2" })).toBeTruthy();
  const radios = within(second).getAllByRole("radio") as HTMLInputElement[];
  expect(radios.map((radio) => radio.checked)).toEqual([false, false, false]);
});

test("after the last answer, the intake is loaded again and the recorded answers are shown", async () => {
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

  expect(await screen.findByRole("heading", { level: 1, name: "Recorded answers" })).toBeTruthy();
  expect(fetchMock.mock.calls.filter(([url]) => url === INTAKE_URL)).toHaveLength(1);
  expect(screen.getAllByRole("term").map((term) => term.textContent)).toContain("Video sharing");
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
