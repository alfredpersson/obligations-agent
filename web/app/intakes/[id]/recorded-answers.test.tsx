import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { Intake } from "../../service";
import { testSchema } from "../../testing";
import RecordedAnswers from "./recorded-answers";

const intake = {
  description: { purpose: "A door camera. <b>It records video.</b>", people: "Building staff." },
  answers: { uses_camera: "yes", audience: "not_sure" },
  open_slots: ["audience"],
  not_sure: { audience: { reason: "unknown", note: "" } },
  step: { type: "ready_to_confirm" },
} satisfies Intake;

afterEach(cleanup);

// The label of each open slot, which comes first in its list item, before a reason and a note.
function openSlots() {
  return screen.getAllByRole("listitem").map((item) => item.firstChild?.textContent);
}

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
  expect(openSlots()).toEqual(["Audience"]);
});

test("the follow-up slots with an answer come after the form slots, and an open follow-up slot is listed", () => {
  // shares_video was not asked: it has no answer and is not open, so it is not shown.
  const withFollowUps = {
    ...intake,
    answers: { ...intake.answers, stores_video: "not_sure" },
    open_slots: ["audience", "stores_video"],
    not_sure: { ...intake.not_sure, stores_video: { reason: "unknown", note: "" } },
  } satisfies Intake;
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
  expect(openSlots()).toEqual(["Audience", "Video storage"]);
});

test("the screen says so when no slot is open", () => {
  render(
    <RecordedAnswers
      intake={{
        ...intake,
        answers: { uses_camera: "yes", audience: "staff" },
        open_slots: [],
        not_sure: {},
      }}
      schema={testSchema}
    />,
  );

  expect(screen.getByText(/no open questions/i)).toBeTruthy();
  expect(screen.queryAllByRole("listitem")).toEqual([]);
});

test("each open slot answered not_sure shows its label, the label of its reason, and its note when it has one", () => {
  // shares_video is relevant but was never asked, so it has no reason.
  const withNotes = {
    ...intake,
    answers: { uses_camera: "not_sure", audience: "not_sure", stores_video: "not_sure" },
    open_slots: ["uses_camera", "audience", "stores_video", "shares_video"],
    not_sure: {
      uses_camera: { reason: "unclear", note: "Does a doorbell count? <b>It has a lens.</b>" },
      audience: { reason: "unknown", note: "" },
      stores_video: { reason: "unknown", note: "Ask the facility manager." },
    },
  } satisfies Intake;
  render(<RecordedAnswers intake={withNotes} schema={testSchema} />);

  const lines = screen
    .getAllByRole("listitem")
    .map((item) => [...item.childNodes].map((line) => line.textContent));
  expect(lines).toEqual([
    ["Camera", "I don't understand the question", "Note: Does a doorbell count? <b>It has a lens.</b>"],
    ["Audience", "I don't know this about the product"],
    ["Video storage", "I don't know this about the product", "Note: Ask the facility manager."],
    ["Video sharing"],
  ]);
  // The note is text, as the description is.
  expect(document.querySelector("b")).toBeNull();
});
