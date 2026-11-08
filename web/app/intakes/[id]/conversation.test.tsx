import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NOT_LEGAL_ADVICE } from "../../not-legal-advice";
import type { Example, Intake, Result, Turn, WhatIf } from "../../service";
import { stubFetch, testIntake, testSchema } from "../../testing";
import IntakeResult from "./intake-result";
import styles from "./intake-result.module.css";

// The panel beside the result, with questions about the result and about a change to the product
// (issue #44: QA-2 to QA-10).

const ANSWERS = `/intakes/${testIntake.id}/answers`;
const ASKED = `/api/intakes/${testIntake.id}/questions`;
const ASKING = "Reading your result and the regulations. This takes a few seconds.";
const LINK = "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689#005.001";
const WHAT_IF = "What if…?";
const HINT = "Planning a change to your product? Ask what it would do to your answers and obligations.";

const ENTRY: Example = {
  id: "visitor_screens",
  quotes: [{ heading: "2.1. Screens in public places", text: "A screen that shows visitors counts as public use." }],
  source: {
    id: "camera_guide",
    title: "Guide to camera rules",
    body: "The Camera Board",
    link: "https://example.test/guide",
    checked: "2026-10-01",
    note: null,
  },
};

const ANSWERED: Turn = {
  question: "What does the storage rule say?",
  answered: true,
  blocks: [
    {
      kind: "paragraph",
      segments: [
        { text: "It limits how long you keep video, see ", link: null },
        { text: "Rule 5(1)", link: LINK },
        { text: ".", link: null },
      ],
    },
    { kind: "list", ordered: true, start: 1, items: [[{ text: "Delete video after a month", link: null }]] },
  ],
  quotes: [{ citation: "Camera Law Rule 5(1)", link: `${LINK}:~:text=Video`, text: "Video shall be deleted after one month." }],
  guidance: [ENTRY],
  scenario: null,
  for_earlier_answers: false,
};

const FAILED: Turn = {
  question: "Which national law applies to us?",
  answered: false,
  blocks: [],
  quotes: [],
  guidance: [],
  scenario: null,
  for_earlier_answers: false,
};

const CHANGES: WhatIf = {
  changed: [
    { fact: "Audience", fact_id: "audience", value: "public", now: "Not sure", to: "The public" },
    { fact: "Video sharing", fact_id: "shares_video", value: "yes", now: "no answer", to: "Yes" },
  ],
  refused: [],
  results: [
    {
      result: "Audience rules apply",
      regulation: "Camera Law",
      before: { status: "conditional", open: ["Audience"], article_6_3: null },
      after: { status: "applies", open: [], article_6_3: null },
    },
  ],
  rows_added: [
    {
      label: "A notice at the door",
      result: "Storage role",
      category: "legal",
      status: "applies",
      citation: "Camera Law Rule 6(1)",
      date: "2 August 2026",
    },
  ],
  rows_removed: [
    {
      label: "Staff training",
      result: "Audience rules apply",
      category: "organisation",
      status: "conditional",
      citation: "Camera Law Rule 2(1)",
      date: "2 February 2025",
    },
  ],
  rows_changed: [],
  now_open: [],
  no_longer_asked: [],
};

const CHANGE: Turn = {
  question: "What if we add a screen at the door that shows visitors?",
  answered: true,
  blocks: [{ kind: "paragraph", segments: [{ text: "A screen for visitors may change two answers.", link: null }] }],
  quotes: [],
  guidance: [ENTRY],
  scenario: {
    questions: [
      {
        fact: "Audience",
        fact_id: "audience",
        question: "Is the product used by your staff or by the public?",
        now: "Not sure",
        to: "The public",
        guidance: [ENTRY],
      },
      {
        fact: "Video sharing",
        fact_id: "shares_video",
        question: "Does the product send video to anyone outside your company?",
        now: "no answer",
        to: "Yes",
        guidance: [],
      },
    ],
    changes: CHANGES,
  },
  for_earlier_answers: false,
};

// jsdom has no modal dialog, so the tests give the dialog element the two methods that the screen
// calls.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function show(conversation: Turn[] | null, onTurn: (turn: Turn) => void = () => {}) {
  const intake: Intake & { result: Result } = { ...testIntake, conversation };
  render(<IntakeResult intake={intake} schema={testSchema} answers={ANSWERS} onTurn={onTurn} />);
  return intake;
}

// Opens the panel with its button, and gives the panel.
function opened() {
  fireEvent.click(screen.getByRole("button", { name: /^What if…\?/ }));
  return screen.getByRole("complementary", { name: WHAT_IF });
}

function field() {
  return screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
}

// The part of the panel that holds a turn, from the question's text.
function turnOf(question: string) {
  const item = screen.getByText(question).closest("li");
  if (!item) throw new Error(`No turn for ${question}`);
  return item as HTMLElement;
}

function sent(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.map(([input, init]) => [String(input), init?.method, JSON.parse(String(init?.body))]);
}

test("the panel opens from its button and closes again, with the questions and their answers in order and the line on legal advice above its field", () => {
  show([ANSWERED, FAILED, CHANGE]);

  const panel = opened();

  const shown = panel.textContent ?? "";
  expect(shown.indexOf(ANSWERED.question)).toBeLessThan(shown.indexOf(FAILED.question));
  expect(shown.indexOf(FAILED.question)).toBeLessThan(shown.indexOf(CHANGE.question));
  const line = within(panel).getByText(NOT_LEGAL_ADVICE);
  expect(line.compareDocumentPosition(field()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("complementary", { name: WHAT_IF })).toBeNull();
  expect(screen.getByRole("button", { name: /^What if…\?/ })).toBeTruthy();
});

test("each question stands under \"You asked\" at the top of its card, apart from its answer", () => {
  show([CHANGE]);
  opened();

  const question = screen.getByText(CHANGE.question);
  expect(question.previousElementSibling?.textContent).toBe("You asked");
  const head = question.parentElement as HTMLElement;
  expect(head.textContent).toBe(`You asked${CHANGE.question}`);
  expect(head.nextElementSibling?.textContent).toContain("This change may change 2 of your answers");
});

test("without the key the result has no button, no hint and no panel", () => {
  show(null);

  expect(screen.queryByRole("button", { name: /^What if/ })).toBeNull();
  expect(screen.queryByText(HINT)).toBeNull();
  expect(screen.queryByRole("complementary", { name: WHAT_IF })).toBeNull();
});

test("the button shows an icon with its name, and after questions their number", () => {
  show([ANSWERED, FAILED]);

  const button = screen.getByRole("button", { name: `${WHAT_IF} 2 questions` });
  expect(button.querySelector("svg")).not.toBeNull();
  expect(button.textContent).toBe(`${WHAT_IF}2`);
});

test("opening the panel moves the focus to its field, and closing it moves the focus back to the button", () => {
  show([]);

  const panel = opened();
  expect(document.activeElement).toBe(field());
  fireEvent.click(within(panel).getByRole("button", { name: "Close" }));

  expect(document.activeElement).toBe(screen.getByRole("button", { name: /^What if…\?/ }));
});

test("the panel's title is the button's name, with a line on what it answers", () => {
  show([]);

  const panel = opened();

  expect(within(panel).getByRole("heading", { level: 2 }).textContent).toBe(WHAT_IF);
  expect(within(panel).getByText("Check what a change to your product would do.")).toBeTruthy();
});

test("on the first view a hint says what the panel is for, and Try it opens the panel", () => {
  show([]);

  expect(screen.getByText(HINT)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try it" }));

  expect(screen.getByRole("complementary", { name: WHAT_IF })).toBeTruthy();
  expect(screen.queryByText(HINT)).toBeNull();
});

test("once closed, or once the panel was opened, the hint does not show again in this browser", () => {
  show([]);
  fireEvent.click(screen.getByRole("button", { name: "Close the hint" }));
  expect(screen.queryByText(HINT)).toBeNull();
  cleanup();
  show([]);
  expect(screen.queryByText(HINT)).toBeNull();

  localStorage.clear();
  cleanup();
  show([]);
  opened();
  cleanup();
  show([]);
  expect(screen.queryByText(HINT)).toBeNull();
});

test("the field takes at most 500 characters and shows an example of a change", () => {
  show([]);
  opened();

  expect(field().maxLength).toBe(500);
  expect(field().placeholder).toBe("What if we add a feature that ...");
});

test("an answer shows its paragraphs and lists with each citation as a link that opens the dialog about EUR-Lex, its quotes and its examples folded", () => {
  show([ANSWERED]);
  opened();
  const turn = within(turnOf(ANSWERED.question));

  expect(turn.getByText(/It limits how long you keep video/).tagName).toBe("P");
  expect(turn.getByRole("listitem").textContent).toBe("Delete video after a month");
  const citation = turn.getByRole("link", { name: "Rule 5(1)" });
  expect(citation.getAttribute("href")).toBe(LINK);
  expect(fireEvent.click(citation)).toBe(false);
  expect((screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement).open).toBe(true);
  expect(turn.getByRole("link", { name: "Camera Law Rule 5(1)" }).getAttribute("href")).toBe(`${LINK}:~:text=Video`);
  expect(turn.getByText("Video shall be deleted after one month.").tagName).toBe("BLOCKQUOTE");
  expect(turn.getByText("1 example from official guidance (not law)").tagName).toBe("SUMMARY");
  expect(turn.getByText(ENTRY.quotes[0].text)).toBeTruthy();
});

test("a question that could not be answered says so", () => {
  show([FAILED]);
  opened();

  expect(turnOf(FAILED.question).textContent).toContain("This question could not be answered. Ask it again.");
});

test("Enter sends the question and the answer joins the conversation, and Shift and Enter does not send it", async () => {
  const answer: Turn = { ...ANSWERED, question: "What does Rule 5 say?" };
  const fetchMock = stubFetch({ [ASKED]: new Response(JSON.stringify({ turn: answer })) });
  const onTurn = vi.fn<(turn: Turn) => void>();
  show([FAILED], onTurn);
  opened();

  fireEvent.change(field(), { target: { value: "What does Rule 5 say?" } });
  fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.keyDown(field(), { key: "Enter" });

  await waitFor(() => expect(onTurn).toHaveBeenCalledOnce());
  expect(sent(fetchMock)).toEqual([[ASKED, "POST", { text: "What does Rule 5 say?" }]]);
  expect(onTurn).toHaveBeenCalledWith(answer);
  expect(field().value).toBe("");
});

test("while a question is answered, the panel shows the loading status and the field waits", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
  show([]);
  opened();

  fireEvent.change(field(), { target: { value: "What if we add a screen?" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));

  expect(screen.getByText(ASKING)).toBeTruthy();
  expect(field().disabled).toBe(true);
});

test("a question that could not be answered or sent stays in the field", async () => {
  const failed: Turn = { ...FAILED, question: "What if we add a screen?" };
  stubFetch({ [ASKED]: new Response(JSON.stringify({ turn: failed })) });
  const onTurn = vi.fn<(turn: Turn) => void>();
  show([], onTurn);
  opened();

  fireEvent.change(field(), { target: { value: "What if we add a screen?" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  await waitFor(() => expect(onTurn).toHaveBeenCalledWith(failed));
  expect(field().value).toBe("What if we add a screen?");

  stubFetch({ [ASKED]: new Error("offline") });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect((await screen.findByRole("alert")).textContent).toBe("The question could not be sent. Ask it again.");
  expect(field().value).toBe("What if we add a screen?");
});

test("a question after the limit of questions says that the intake has reached it", async () => {
  stubFetch({ [ASKED]: Response.json({ error: { code: "limit_reached" } }, { status: 409 }) });
  show([]);
  opened();

  fireEvent.change(field(), { target: { value: "What if we add a screen?" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));

  expect((await screen.findByRole("alert")).textContent).toBe("This intake has reached its limit of questions.");
  expect(field().value).toBe("What if we add a screen?");
});

test("a change shows a line with its numbers, each answer it may change with its question and its examples, and the obligations and results that would change", () => {
  show([CHANGE]);
  opened();
  const turn = turnOf(CHANGE.question);
  const shown = turn.textContent ?? "";

  expect(within(turn).getByText("This change may change 2 of your answers, add 1 obligation, remove 1 obligation.")).toBeTruthy();
  expect(shown.indexOf("This change may change")).toBeLessThan(shown.indexOf("A screen for visitors may change two answers."));
  expect(shown).toContain("Answers this change may change");
  expect(shown).toContain("Audience: now Not sure, may become The public");
  expect(shown).toContain("Is the product used by your staff or by the public?");
  expect(shown).toContain("Video sharing: now no answer, may become Yes");
  expect(within(turn).getAllByText("1 example from official guidance (not law)")).toHaveLength(1);
  expect(within(turn).queryByRole("link", { name: "Review this answer" })).toBeNull();
  expect(shown.indexOf("Obligations this would add")).toBeLessThan(shown.indexOf("A notice at the door"));
  const added = within(turn).getByText("A notice at the door").closest("li") as HTMLElement;
  expect(added.textContent).toContain("Camera Law Rule 6(1)");
  expect(added.textContent).toContain("2 August 2026");
  const tag = within(added).getByText("Legal");
  expect(tag.className).toContain(styles.tag);
  expect(tag.className).toContain(styles.tag_legal);
  expect(shown.indexOf("Storage role")).toBeLessThan(shown.indexOf("A notice at the door"));
  expect(shown.indexOf("Obligations that would no longer apply")).toBeLessThan(shown.indexOf("Staff training"));
  expect(shown).toContain("Results that would change");
  expect(shown).toContain("Audience rules apply (Camera Law): Conditional to Applies");
});

test("an answer given for earlier answers says so", () => {
  show([{ ...CHANGE, for_earlier_answers: true }]);
  opened();

  expect(turnOf(CHANGE.question).textContent).toContain("Answered for your earlier answers.");
});
