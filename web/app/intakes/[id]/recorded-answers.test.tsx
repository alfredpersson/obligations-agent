import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { stubFetch, testSchema } from "../../testing";
import RecordedAnswers from "./recorded-answers";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "kq2V8yZx0bP4mT7nLw3sAg" }) }));

const intake = {
  id: "kq2V8yZx0bP4mT7nLw3sAg",
  description: "A door camera. <b>It records video.</b>",
  answers: { uses_camera: "yes", audience: "not_sure" },
  open_slots: ["audience"],
  step: { type: "ready_to_confirm" },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("the screen shows the description as text, each slot with the label of its value, and the open slots", async () => {
  stubFetch({
    "/api/intakes/kq2V8yZx0bP4mT7nLw3sAg": Response.json(intake),
    "/api/schema": Response.json(testSchema),
  });
  render(<RecordedAnswers />);

  expect(await screen.findByText("A door camera. <b>It records video.</b>")).toBeTruthy();
  expect(document.querySelector("b")).toBeNull();
  expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual(["Camera", "Audience"]);
  expect(screen.getAllByRole("definition").map((value) => value.textContent)).toEqual([
    "Yes",
    "Not sure",
  ]);
  expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Audience"]);
});

test("the screen says so when no slot is open", async () => {
  stubFetch({
    "/api/intakes/kq2V8yZx0bP4mT7nLw3sAg": Response.json({
      ...intake,
      answers: { uses_camera: "yes", audience: "staff" },
      open_slots: [],
    }),
    "/api/schema": Response.json(testSchema),
  });
  render(<RecordedAnswers />);

  expect(await screen.findByText(/no open questions/i)).toBeTruthy();
  expect(screen.queryAllByRole("listitem")).toEqual([]);
});

test("an id that is not stored shows that the intake was not found", async () => {
  stubFetch({
    "/api/intakes/kq2V8yZx0bP4mT7nLw3sAg": Response.json({ error: { code: "not_found" } }, { status: 404 }),
    "/api/schema": Response.json(testSchema),
  });
  render(<RecordedAnswers />);

  expect((await screen.findByRole("alert")).textContent).toMatch(/not found/i);
});

test("a failed call shows a message", async () => {
  stubFetch({
    "/api/intakes/kq2V8yZx0bP4mT7nLw3sAg": new Response(null, { status: 500 }),
    "/api/schema": Response.json(testSchema),
  });
  render(<RecordedAnswers />);

  const message = await screen.findByRole("alert");
  expect(message.textContent).not.toBe("");
  expect(message.textContent).not.toMatch(/not found/i);
});
