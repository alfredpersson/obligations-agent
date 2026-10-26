import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { Intake } from "../../service";
import { testSchema } from "../../testing";
import RecordedAnswers from "./recorded-answers";

const intake = {
  description: { purpose: "A door camera. <b>It records video.</b>", people: "Building staff." },
  answers: { uses_camera: "yes", audience: "not_sure" },
  open_slots: ["audience"],
  step: { type: "ready_to_confirm" },
} satisfies Intake;

afterEach(cleanup);

test("the screen shows each description field under its label as text, each slot with the label of its value, and the open slots", () => {
  render(<RecordedAnswers intake={intake} schema={testSchema} />);

  expect(screen.getByRole("heading", { level: 1, name: "Recorded answers" })).toBeTruthy();
  expect(screen.getByText("A door camera. <b>It records video.</b>")).toBeTruthy();
  expect(document.querySelector("b")).toBeNull();
  const texts = [
    ["Purpose", "A door camera. <b>It records video.</b>"],
    ["People", "Building staff."],
  ];
  for (const [label, text] of texts) {
    expect(screen.getByRole("heading", { name: label }).nextElementSibling?.textContent).toBe(text);
  }
  expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual(["Camera", "Audience"]);
  expect(screen.getAllByRole("definition").map((value) => value.textContent)).toEqual([
    "Yes",
    "Not sure",
  ]);
  expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Audience"]);
});

test("the follow-up slots with an answer come after the form slots, and an open follow-up slot is listed", () => {
  // shares_video was not asked: it has no answer and is not open, so it is not shown.
  const withFollowUps = {
    ...intake,
    answers: { ...intake.answers, stores_video: "not_sure" },
    open_slots: ["audience", "stores_video"],
  };
  render(<RecordedAnswers intake={withFollowUps} schema={testSchema} />);

  expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual([
    "Camera",
    "Audience",
    "Video storage",
  ]);
  expect(screen.getAllByRole("definition").map((value) => value.textContent)).toEqual([
    "Yes",
    "Not sure",
    "Not sure",
  ]);
  expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "Audience",
    "Video storage",
  ]);
});

test("the screen says so when no slot is open", () => {
  render(
    <RecordedAnswers
      intake={{ ...intake, answers: { uses_camera: "yes", audience: "staff" }, open_slots: [] }}
      schema={testSchema}
    />,
  );

  expect(screen.getByText(/no open questions/i)).toBeTruthy();
  expect(screen.queryAllByRole("listitem")).toEqual([]);
});
