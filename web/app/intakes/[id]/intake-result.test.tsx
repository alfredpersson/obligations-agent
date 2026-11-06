import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Cited, NotSure, Outcome, Row, Texts } from "../../service";
import { testQuestions, testResult, testRows, testSchema } from "../../testing";
import IntakeResult from "./intake-result";
import styles from "./intake-result.module.css";

// The intake ended with "not sure" about the audience, with a reason and a note; the slot
// stores_video is relevant and was not asked, so it has neither. Its open slots, in schema order.
const notSure: Record<string, NotSure> = { audience: { reason: "unknown", note: "We sell to both." } };
const OPEN = ["audience", "stores_video"];

// jsdom has no modal dialog, so the tests give the dialog element the two methods that the screen
// calls: showModal opens it, and close closes it and sends its close event.
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
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// The address of the screen of the answers of the intake (INTAKE-5).
const ANSWERS = "/intakes/kq2V8yZx0bP4mT7nLw3sAg/answers";

function show(gates: Outcome[] = testResult.gates, texts: Texts = null, openSlots: string[] = OPEN) {
  render(
    <IntakeResult
      result={{ ...testResult, gates }}
      notSure={notSure}
      questions={testQuestions}
      openSlots={openSlots}
      schema={testSchema}
      texts={texts}
      answers={ANSWERS}
    />,
  );
}

// A part of the result, or a section of a part, by the name of its heading.
function region(name: string, inside: HTMLElement = document.body) {
  return within(inside).getByRole("region", { name });
}

// The three parts (MEMO-6).
const APPLIES = "What applies";
const CHECK = "Answers to check";
const ALSO = "What may also apply";

// The part of the screen from a heading to the next heading of the same level or higher.
function under(name: string, inside: HTMLElement = document.body) {
  const heading = within(inside).getByRole("heading", { name });
  const level = Number(heading.tagName[1]);
  const parts: Element[] = [];
  for (let next = heading.nextElementSibling; next; next = next.nextElementSibling) {
    if (/^H[1-6]$/.test(next.tagName) && Number(next.tagName[1]) <= level) break;
    parts.push(next);
  }
  return parts;
}

function text(parts: Element[]) {
  return parts.map((part) => (part as HTMLElement).textContent).join(" ");
}

// The text and the address of each link in the parts.
function links(parts: Element[]) {
  return parts
    .flatMap((part) => within(part as HTMLElement).queryAllByRole("link"))
    .map((link) => [link.textContent, link.getAttribute("href")]);
}

function headings(level: number, inside: HTMLElement = document.body) {
  return within(inside)
    .queryAllByRole("heading", { level })
    .map((heading) => heading.textContent);
}

function items(inside: HTMLElement) {
  return within(inside)
    .getAllByRole("listitem")
    .map((item) => item.textContent);
}

// A conditional row of a result, with its own id and label.
function conditional(gate: string, label: string, needs: Row["needs"] = null): Row {
  return { ...testRows[0], id: `${gate}:${label}`, label, status: "conditional", needs };
}

// The way back to the answers (issue #50): in place of the recorded answers, a link to the screen
// of the answers under the summary.
test("the result links to the screen of the answers below its heading and before the results, and shows no recorded answers", () => {
  show();

  const back = screen.getByRole("link", { name: "Check or change the answers" });
  expect(back.getAttribute("href")).toBe(ANSWERS);
  const heading = screen.getByRole("heading", { level: 1, name: "Result" });
  const first = screen.getByRole("heading", { level: 2, name: APPLIES });
  expect(heading.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(back.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Recorded answers" })).toBeNull();
});

test("the result has its heading, the assumptions and the items not checked, each with its links", () => {
  show();

  expect(screen.getByRole("heading", { level: 1, name: "Result" })).toBeTruthy();
  const assumptions = screen.getByText(/^This result assumes:/);
  expect(assumptions.textContent).toBe("This result assumes: The product is a camera system. (Rule 1)");
  expect(within(assumptions).getByRole("link", { name: "Rule 1" }).getAttribute("href")).toBe(
    "https://eur-lex.europa.eu/rule#art_1",
  );
  const notChecked = within(under("Not checked yet")[0] as HTMLElement);
  expect(notChecked.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["The exclusions: Rule 9"]);
  expect(notChecked.getByRole("link", { name: "Rule 9" }).getAttribute("href")).toBe(
    "https://eur-lex.europa.eu/rule#art_9",
  );
});

// On a first visit, and again about five minutes after its last check, EUR-Lex checks the browser
// and loads the page again, which loses the place that the link opens. A link at such a time
// therefore says so first.
const FIRST_VISIT =
  "EUR-Lex checks the browser on a first visit, and again after some minutes. The page then opens at the top, not at the article. Answer the cookie notice if it shows, come back to this page and open the link again: it then opens at the article.";

function dialog() {
  return screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement;
}

// fireEvent gives false when the screen stops the browser from following the link.
function follows(name: string) {
  return fireEvent.click(screen.getByRole("link", { name }));
}

test("the first link to EUR-Lex in a session opens a dialog that explains the first visit, in place of the link", () => {
  show([testResult.gates[0]]);
  expect(dialog().open).toBe(false);

  expect(follows("Rule 2(1)")).toBe(false);

  expect(dialog().open).toBe(true);
  expect(within(dialog()).getByRole("heading", { name: "Opening EUR-Lex" })).toBeTruthy();
  expect(within(dialog()).getByText(/^EUR-Lex checks the browser/).textContent).toBe(FIRST_VISIT);
  const open = within(dialog()).getByRole("link", { name: "Open EUR-Lex" });
  expect(open.getAttribute("href")).toBe(testResult.gates[0].quotes[0].link);
  expect(open.getAttribute("target")).toBe("_blank");
});

test("opening EUR-Lex from the dialog closes it, and the links in the next five minutes open EUR-Lex at once", () => {
  show();
  follows("Rule 2(1)");

  fireEvent.click(within(dialog()).getByRole("link", { name: "Open EUR-Lex" }));

  expect(dialog().open).toBe(false);
  expect(follows("Rule 9")).toBe(true);
  expect(follows("Rule 2(1)")).toBe(true);
  expect(dialog().open).toBe(false);
});

test("five minutes after EUR-Lex was opened from the dialog, the next link opens the dialog again", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T10:00:00Z"));
  show();
  follows("Rule 2(1)");
  fireEvent.click(within(dialog()).getByRole("link", { name: "Open EUR-Lex" }));

  vi.setSystemTime(new Date("2026-11-04T10:04:59Z"));
  expect(follows("Rule 9")).toBe(true);
  vi.setSystemTime(new Date("2026-11-04T10:05:00Z"));
  expect(follows("Rule 9")).toBe(false);
  expect(dialog().open).toBe(true);
});

test("cancel closes the dialog, and the next link opens it again", () => {
  show();
  follows("Rule 1");

  fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));

  expect(dialog().open).toBe(false);
  expect(follows("Rule 9")).toBe(false);
  expect(dialog().open).toBe(true);
});

test("when session storage cannot be used, every link opens the dialog first", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage is blocked.");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage is blocked.");
  });
  show();
  follows("Rule 1");
  fireEvent.click(within(dialog()).getByRole("link", { name: "Open EUR-Lex" }));

  expect(follows("Rule 9")).toBe(false);
  expect(dialog().open).toBe(true);
});

// The three parts (issue #51, criterion 1).
test("the result has three parts in this order: what applies, the answers to check and what may also apply, then the items not checked", () => {
  const [audience, storage, , head] = testResult.gates;
  show([head, audience, { ...storage, rows: [conditional("storage", "A notice at the door")] }]);

  expect(headings(2)).toEqual([APPLIES, CHECK, ALSO, "Not checked yet"]);
});

// The first part (criterion 2).
test("a result that applies or does not apply shows in the first part under its regulation, with its rows that apply", () => {
  const [audience, storage, , head] = testResult.gates;
  show(
    [
      head,
      { ...audience, status: "does_not_apply", result: "does_not_apply", answers: { audience: "public" }, conditions: [] },
      { ...storage, status: "applies", result: "applies", conditions: [], rows: testRows },
    ],
    null,
    ["shares_video"],
  );

  const first = region(APPLIES);
  expect(headings(3, first)).toEqual(["Camera Law"]);
  expect(headings(4, first)).toEqual(["Audience rules apply", "Storage role"]);
  expect(under("Audience rules apply", first)[0].textContent).toBe("Does not apply. Your answer: Audience: The public.");
  expect(text(under("Storage role", first))).toContain("Delete old video");
  // The conditional row stands in the third part only.
  expect(text(under("Storage role", first))).not.toContain("A notice at the door");
  expect(within(region(ALSO)).getByText("A notice at the door")).toBeTruthy();
});

test("each result in the first part shows its label as a heading under its regulation, what it gives, and the answers that decided it with their labels", () => {
  show([
    {
      ...testResult.gates[0],
      status: "applies",
      result: "applies",
      answers: { uses_camera: "yes" },
      conditions: [],
    },
  ]);

  const first = region(APPLIES);
  expect(within(first).getByRole("heading", { level: 4, name: "Audience rules apply" })).toBeTruthy();
  expect(under("Audience rules apply", first)[0].textContent).toBe("Applies. Your answer: Camera: Yes.");
});

test("a conditional result does not show in the first part, nor a regulation whose results are all conditional, except one that the result assumes", () => {
  show();

  const first = region(APPLIES);
  expect(headings(3, first)).toEqual(["Camera Law", "Listing Law"]);
  expect(headings(4, first)).toEqual([]);
  expect(under("Camera Law", first)[0].textContent).toBe("Applies. Your answer: Camera: Yes.");
  expect(text(under("Camera Law", first))).toContain("Show the article that defines it: Rule 1(1)");
  expect(under("Listing Law", first)[0].textContent).toBe(
    "Assumed. No check decides yet whether the Listing Law applies to the product: the result assumes that it does, as said above.",
  );
  cleanup();

  const [audience, storage, listed, head] = testResult.gates;
  show([{ ...head, status: "conditional", result: null, answers: { uses_camera: "not_sure" } }, audience, storage, listed]);

  expect(headings(3, region(APPLIES))).toEqual(["Listing Law"]);
});

// The second part: each open answer once (criterion 3).
test("an open answer shows once in the second part, with its last question, its reason and note, what each answer gives for each result that depends on it with its units, and a link to it on the screen of the answers", () => {
  show();

  const check = region(CHECK);
  expect(headings(3, check).filter((heading) => heading === "Audience")).toHaveLength(1);
  const audience = region("Audience", check);
  const parts = audience.textContent;
  expect(parts).toContain("Is the product used by your staff or by the public?");
  expect(parts).toContain("Not sure · I don't know this about the product");
  expect(parts).toContain("Note: We sell to both.");
  expect(parts).toContain("Audience rules apply (Camera Law)");
  expect(parts).toContain("Storage role (Camera Law)");
  expect(items(audience)).toEqual([
    "If Staff: applies.",
    "If The public: does not apply.",
    "If Staff: depends on the other open answer.",
    "If The public: does not apply.",
  ]);
  expect(within(audience).getByText("Show the article that defines it: Rule 2(1)").tagName).toBe("SUMMARY");
  const answer = within(audience).getByRole("link", { name: "Answer Audience on the screen of the answers" });
  expect(answer.getAttribute("href")).toBe(`${ANSWERS}#audience`);
  expect(answer.textContent).toBe("Answer it on the screen of the answers");
});

test("a relevant slot without an answer says that it is not answered yet, with what each answer gives", () => {
  show();

  const storage = region("Video storage", region(CHECK));
  expect(storage.textContent).toContain("Does the product keep the video that it records?");
  expect(storage.textContent).toContain("Not answered yet");
  expect(storage.textContent).toContain("Storage role (Camera Law)");
  expect(items(storage)).toEqual(["If Yes: applies.", "If No: does not apply."]);
  expect(
    within(storage).getByRole("link", { name: "Answer Video storage on the screen of the answers" }).getAttribute("href"),
  ).toBe(`${ANSWERS}#stores_video`);
});

test("a row that needs an open fact, under a result that does not depend on it, shows under that fact with what each answer gives", () => {
  const [, storage, , head] = testResult.gates;
  show([head, { ...storage, status: "applies", result: "applies", conditions: [], rows: testRows }], null, ["shares_video"]);

  const sharing = region("Video sharing", region(CHECK));
  expect(sharing.textContent).toContain("A notice at the door (Storage role)");
  expect(items(sharing)).toEqual(["If Yes: applies.", "If No: does not apply."]);
  const count = within(sharing).getByRole("link", { name: "1 obligation depends on this" });
  expect(count.getAttribute("href")).toBe("#also-shares_video");
});

test("an open slot that nothing depends on shows with a line that says so", () => {
  show(testResult.gates, null, ["audience", "stores_video", "shares_video"]);

  const sharing = region("Video sharing", region(CHECK));
  expect(sharing.textContent).toContain("No obligation depends on this answer now.");
  expect(within(sharing).getByRole("link", { name: "Answer Video sharing on the screen of the answers" })).toBeTruthy();
});

test("each defining quote is folded behind its citation, a link to EUR-Lex, and keeps its lines", () => {
  show([testResult.gates[0]]);

  const definition = screen.getByText("Show the article that defines it: Rule 2(1)");
  expect(definition.tagName).toBe("SUMMARY");
  const folded = definition.closest("details");
  expect(folded?.open).toBe(false);
  const link = within(folded as HTMLElement).getByRole("link", { name: "Rule 2(1)" });
  expect(link.getAttribute("href")).toBe(testResult.gates[0].quotes[0].link);
  expect(link.getAttribute("target")).toBe("_blank");
  const quote = link.closest("p")?.nextElementSibling;
  expect(quote?.tagName).toBe("BLOCKQUOTE");
  expect(quote?.textContent).toBe("Staff cameras are covered:\n(a) door cameras;");
});

test("the areas of Annex III are one case, named as such and not by their labels", () => {
  show([
    {
      ...testResult.gates[0],
      conditions: [
        {
          slot: "audience",
          gate: "audience_rules",
          cases: [
            { values: ["staff", "public"], result: "listed_use" },
            { values: ["none"], result: "does_not_apply" },
          ],
        },
      ],
    },
  ]);

  const audience = region("Audience", region(CHECK));
  expect(items(audience)).toContain(
    "If one of the areas of Annex III: high-risk if the product's intended use is one of the uses listed under that point.",
  );
  expect(items(audience).filter((item) => item?.includes("Staff"))).toEqual([]);
});

// The second part: the listed use (criterion 4).
const LISTED = "Intended use listed under Listing Rule Annex III, point 2";

test.each([
  [
    "always",
    "If it is listed: applies.",
    "Under Article 6(3), a use listed in Annex III is always high-risk when the product performs profiling.",
  ],
  ["unless", "If it is listed: applies, unless one of the conditions of Article 6(3) applies.", null],
] as const)(
  "a listed use shows once in the second part, with its quoted point, what Article 6(3) gives (%s), and no link to the screen of the answers",
  (derogation, listedCase, sentence) => {
    show([{ ...testResult.gates[2], derogation }]);

    const check = region(CHECK);
    expect(headings(3, check).filter((heading) => heading === LISTED)).toHaveLength(1);
    const listed = region(LISTED, check);
    expect(listed.textContent).toContain(
      "Is the product's intended use one of the uses listed under this point? You decide this: no answer of the intake holds it.",
    );
    // The point, linked, and its quote, open.
    const point = within(listed).getByRole("link", { name: "Listing Rule Annex III, point 2" });
    expect(point.getAttribute("href")).toBe("https://eur-lex.europa.eu/rule#anx_III.002");
    const quote = within(listed).getByText(/^Door cameras:/);
    expect(quote.textContent).toBe("Door cameras:\n(a) cameras at a main door;");
    expect(quote.closest("details")).toBeNull();
    expect(listed.textContent).toContain("Listed camera use (Listing Law)");
    expect(items(listed)).toEqual([listedCase, "If it is not listed: does not apply."]);
    if (sentence) expect(listed.textContent).toContain(sentence);
    else expect(listed.textContent).not.toContain("Under Article 6(3)");
    // The other units of the result, folded.
    expect(within(listed).getByText("Show the article that defines it: Listing Rule 6(2)").tagName).toBe("SUMMARY");
    expect(links([listed]).filter(([, href]) => href?.startsWith(ANSWERS))).toEqual([]);
  },
);

test("while the answer about the slot of Article 6(3) is open, the listed use names it, and that slot's item gives both results", () => {
  show([
    {
      ...testResult.gates[2],
      derogation: null,
      conditions: [
        {
          slot: "stores_video",
          gate: "camera_list",
          cases: [
            { values: ["yes"], result: "always" },
            { values: ["no"], result: "unless" },
          ],
        },
      ],
    },
  ]);

  const check = region(CHECK);
  expect(items(region(LISTED, check))).toEqual([
    "If it is listed: depends on the open answer about Video storage.",
    "If it is not listed: does not apply.",
  ]);
  expect(items(region("Video storage", check))).toEqual([
    "If Yes: a listed use is always high-risk.",
    "If No: a listed use is high-risk unless one of the conditions of Article 6(3) applies.",
  ]);
});

// The order of the second part (criterion 5).
const VIDEO_RULES: Outcome = {
  ...testResult.gates[0],
  gate: "video_rules",
  label: "Video rules apply",
  answers: {},
  conditions: [
    {
      slot: "stores_video",
      gate: "video_rules",
      cases: [
        { values: ["yes"], result: "applies" },
        { values: ["no"], result: "does_not_apply" },
      ],
    },
  ],
  quotes: [],
};

test("the items of the second part stand in the order of the number of rows that depend on each, most first", () => {
  const [audience, , , head] = testResult.gates;
  show([
    head,
    { ...audience, rows: [conditional("audience_rules", "A sign for the public")] },
    {
      ...VIDEO_RULES,
      rows: [conditional("video_rules", "A list of the stored video"), conditional("video_rules", "A delete date")],
    },
  ]);

  expect(headings(3, region(CHECK))).toEqual(["Video storage", "Audience"]);
  expect(within(region("Video storage", region(CHECK))).getByText("2 obligations depend on this")).toBeTruthy();
});

test("in a tie, the listed use comes first, then the slots in the schema's order", () => {
  const [audience, , listed, head] = testResult.gates;
  show([
    head,
    { ...VIDEO_RULES, rows: [conditional("video_rules", "A delete date")] },
    { ...audience, rows: [conditional("audience_rules", "A sign for the public")] },
    { ...listed, rows: [conditional("camera_list", "A register of the cameras")] },
  ]);

  expect(headings(3, region(CHECK))).toEqual([LISTED, "Audience", "Video storage"]);
});

// The third part (criterion 6).
test("a conditional row shows once in the third part, under the first item that it depends on, and names the other item once above the rows", () => {
  const [, storage, , head] = testResult.gates;
  show([head, { ...storage, rows: [conditional("storage", "A notice at the door")] }]);

  const also = region(ALSO);
  expect(headings(3, also)).toEqual(["Audience"]);
  const group = region("Storage role", region("Audience", also));
  expect(group.textContent).toContain("Each of these also depends on the open answer about Video storage.");
  expect(screen.getAllByText("A notice at the door")).toHaveLength(1);
});

test("rows of one result that depend on different other items each name theirs under their label", () => {
  const [, storage, , head] = testResult.gates;
  show(
    [
      head,
      {
        ...storage,
        rows: [
          conditional("storage", "A notice at the door"),
          conditional("storage", "A sign at the gate", { slot: "shares_video", value: null, gate: null, status: null }),
        ],
      },
    ],
    null,
    ["audience", "stores_video", "shares_video"],
  );

  const group = region("Storage role", region("Audience", region(ALSO)));
  expect(group.textContent).not.toContain("Each of these");
  expect(within(group).getByRole("button", { name: /^A notice at the door/ }).textContent).toBe(
    "A notice at the door OrganisationAlso depends on the open answer about Video storage.",
  );
  expect(within(group).getByRole("button", { name: /^A sign at the gate/ }).textContent).toBe(
    "A sign at the gate OrganisationAlso depends on the open answer about Video storage, and on the open answer about Video sharing.",
  );
});

test("a row that needs a conditional result stands under the item that the needed result depends on", () => {
  const [audience, storage, , head] = testResult.gates;
  show([
    head,
    audience,
    {
      ...storage,
      status: "applies",
      result: "applies",
      conditions: [],
      rows: [conditional("storage", "A notice at the door", { slot: null, value: null, gate: "audience_rules", status: "conditional" })],
    },
  ]);

  expect(within(region("Storage role", region("Audience", region(ALSO)))).getByText("A notice at the door")).toBeTruthy();
});

// Nothing open (criterion 7).
test("when nothing is open, the result shows only the first part, with a line that nothing is left to check", () => {
  const [audience, , , head] = testResult.gates;
  show(
    [head, { ...audience, status: "applies", result: "applies", answers: { audience: "staff" }, conditions: [], rows: [testRows[0]] }],
    null,
    [],
  );

  expect(headings(2)).toEqual([APPLIES, "Not checked yet"]);
  expect(screen.getByText("Nothing is left to check: the result depends on no open answer.")).toBeTruthy();
  expect(screen.queryByRole("region", { name: CHECK })).toBeNull();
});

// The rows (criteria 8 to 10): a to-do list, each row's details inside the row.
const TEXTS: Texts = {
  "storage:rule:art5(1)": { meaning: "You must delete video after a month.", action: "Add a job that deletes old video." },
  "storage:rule:art6(1)": { meaning: "If you share video, show a notice.", action: "Draft the notice." },
};
const PLACEHOLDER = "Writing what this means for your product, and an action.";

// The two test rows under a result that applies: the second needs the answer "yes" of a fact.
function applying(rows: Row[] = [testRows[0], { ...testRows[1], status: "applies", needs: { slot: "shares_video", value: "yes", gate: null, status: null } }]): Outcome[] {
  return [{ ...testResult.gates[1], status: "applies", result: "applies", conditions: [], rows }];
}

function row(label: string) {
  return screen.getByText(label, { selector: "p, span" }).closest("li") as HTMLElement;
}

test("a row in the first part shows its label and its action, and its meaning, its clause and what else it needs show inside the row when its details are opened", () => {
  show(applying(), TEXTS, []);

  const first = row("Delete old video");
  expect(first.textContent).toContain("Add a job that deletes old video.");
  expect(first.textContent).not.toContain("Applies.");
  expect(within(first).queryByText(/You must delete video after a month/)).toBeNull();
  expect(within(first).queryByRole("link", { name: "Rule 5(1)" })).toBeNull();
  const details = within(first).getByRole("button", { name: "Details" });
  expect(details.getAttribute("aria-expanded")).toBe("false");

  fireEvent.click(details);

  expect(details.getAttribute("aria-expanded")).toBe("true");
  expect(within(first).getByText(/You must delete video after a month/).textContent).toBe(
    "What it means: You must delete video after a month.",
  );
  expect(within(first).getByRole("link", { name: "Rule 5(1)" }).getAttribute("href")).toBe(testRows[0].unit.link);
  expect(within(first).getByText("Video is deleted after a month.").tagName).toBe("BLOCKQUOTE");
  const second = row("A notice at the door");
  fireEvent.click(within(second).getByRole("button", { name: "Details" }));
  expect(second.textContent).toContain("Needs Video sharing: Yes.");

  fireEvent.click(details);

  expect(details.getAttribute("aria-expanded")).toBe("false");
  expect(within(first).queryByText(/You must delete video after a month/)).toBeNull();
});

test("a row that needs another result names it and its status in its details", () => {
  show(
    [
      testResult.gates[3],
      ...applying([{ ...testRows[0], needs: { slot: null, value: null, gate: "camera_law_applies", status: "applies" } }]),
    ],
    null,
    [],
  );

  const first = row("Delete old video");
  fireEvent.click(within(first).getByRole("button", { name: "Details" }));
  expect(first.textContent).toContain("Needs Camera Law applies: Applies.");
});

test("without the key, a row shows no action, and its details hold its clause", () => {
  show(applying(), null, []);

  const first = row("Delete old video");
  expect(first.textContent).not.toContain(PLACEHOLDER);
  fireEvent.click(within(first).getByRole("button", { name: "Details" }));
  expect(within(first).getByRole("link", { name: "Rule 5(1)" })).toBeTruthy();
  expect(first.textContent).not.toContain("What it means:");
});

test("while the texts are written, each row shows a placeholder in the place of its action", () => {
  show(applying(), {}, []);

  expect(screen.getAllByText(PLACEHOLDER)).toHaveLength(2);
});

test("a row whose texts could not be written says so in the place of its action, and the other rows show theirs", () => {
  show(applying(), { "storage:rule:art5(1)": null, "storage:rule:art6(1)": TEXTS["storage:rule:art6(1)"] }, []);

  expect(row("Delete old video").textContent).toContain("The meaning and the action of this row could not be written.");
  expect(row("A notice at the door").textContent).toContain("Draft the notice.");
  expect(screen.queryByText(PLACEHOLDER)).toBeNull();
});

test("a row in the third part shows its label, and its action, its meaning, its clause and what else it needs show inside the row when it is opened", () => {
  const [, storage, , head] = testResult.gates;
  show([head, { ...storage, status: "applies", result: "applies", conditions: [], rows: testRows }], TEXTS, ["shares_video"]);

  const group = region("Storage role", region("Video sharing", region(ALSO)));
  const label = within(group).getByRole("button", { name: "A notice at the door Legal" });
  const item = label.closest("li") as HTMLElement;
  expect(label.getAttribute("aria-expanded")).toBe("false");
  expect(item.textContent).not.toContain("Draft the notice.");

  fireEvent.click(label);

  expect(label.getAttribute("aria-expanded")).toBe("true");
  expect(item.textContent).toContain("Draft the notice.");
  expect(item.textContent).toContain("What it means: If you share video, show a notice.");
  expect(within(item).getByRole("link", { name: "Rule 6(1)" })).toBeTruthy();
  expect(within(item).getByText("A notice is shown at each door.").tagName).toBe("BLOCKQUOTE");
  expect(item.textContent).toContain("Needs Video sharing: not answered yet.");
});

// The category of each row (issue #52): a tag that says who carries out the row's action, at the start
// of the action wherever the action shows, and after the label where it does not.
test("a row in the first part shows its category as a tag at the start of its action, not with its label", () => {
  show(applying(), TEXTS, []);

  expect(row("Delete old video").textContent).toContain("Organisation Add a job that deletes old video.");
  expect(row("A notice at the door").textContent).toContain("Legal Draft the notice.");
  expect(screen.getByText("Delete old video", { selector: "p" }).textContent).toBe("Delete old video");
  expect(within(row("Delete old video")).getAllByText("Organisation")).toHaveLength(1);
  // Each category has its own colour.
  expect(within(row("Delete old video")).getByText("Organisation").className).toContain(styles.tag_organisation);
  expect(within(row("A notice at the door")).getByText("Legal").className).toContain(styles.tag_legal);
});

test("while the texts are written, each row's tag stands beside the placeholder", () => {
  const encrypt = { ...testRows[0], id: "storage:rule:art8(1)", label: "Encrypt the video", category: "technical" as const };
  show(applying([testRows[0], encrypt]), {}, []);

  expect(row("Delete old video").textContent).toContain(`Organisation ${PLACEHOLDER}`);
  expect(row("Encrypt the video").textContent).toContain(`Technical ${PLACEHOLDER}`);
  expect(within(row("Encrypt the video")).getByText("Technical").className).toContain(styles.tag_technical);
});

test("a row whose texts could not be written keeps its tag beside the line that says so", () => {
  show(applying(), { ...TEXTS, "storage:rule:art5(1)": null }, []);

  expect(row("Delete old video").textContent).toContain(
    "Organisation The meaning and the action of this row could not be written.",
  );
});

test("a folded row in the third part shows its tag after its label, and at the start of its action once it is opened", () => {
  const [, storage, , head] = testResult.gates;
  show([head, { ...storage, status: "applies", result: "applies", conditions: [], rows: testRows }], TEXTS, ["shares_video"]);

  const label = within(region(ALSO)).getByRole("button", { name: "A notice at the door Legal" });
  const item = label.closest("li") as HTMLElement;
  expect(within(item).getAllByText("Legal")).toHaveLength(1);

  fireEvent.click(label);

  expect(label.textContent).toBe("A notice at the door");
  expect(item.textContent).toContain("Legal Draft the notice.");
  expect(within(item).getAllByText("Legal")).toHaveLength(1);

  fireEvent.click(label);

  expect(label.textContent).toBe("A notice at the door Legal");
});

test("without the key a row has no action, so its tag stands after its label in both parts, also when it is opened", () => {
  const [, storage, , head] = testResult.gates;
  show([head, { ...storage, status: "applies", result: "applies", conditions: [], rows: testRows }], null, ["shares_video"]);

  expect(screen.getByText("Delete old video", { selector: "p" }).textContent).toBe("Delete old video Organisation");
  const label = within(region(ALSO)).getByRole("button", { name: "A notice at the door Legal" });

  fireEvent.click(label);

  expect(label.textContent).toBe("A notice at the door Legal");
  expect(within(label.closest("li") as HTMLElement).getAllByText("Legal")).toHaveLength(1);
});

test("the date of a result's rows shows once above them when they share it, with the article that sets it", () => {
  show(applying([testRows[0], { ...testRows[0], id: "storage:rule:art7(1)", label: "A log of the deletions" }]), null, []);

  const first = region(APPLIES);
  expect(within(first).getAllByText(/From 25 May 2018/)).toHaveLength(1);
  const line = within(first).getByText(/From 25 May 2018/);
  expect(line.textContent).toBe("From 25 May 2018 (Rule 99(2)).");
  expect(line.closest("li")).toBeNull();
  expect(within(line).getByRole("link", { name: "Rule 99(2)" }).getAttribute("href")).toBe("https://eur-lex.europa.eu/rule#099.002");
});

test("rows of a result with different dates each show their date under their label", () => {
  show(applying(), null, []);

  expect(row("Delete old video").textContent).toContain("From 25 May 2018 (Rule 99(2)).");
  expect(row("A notice at the door").textContent).toContain("From 2 December 2027 (Rule 113).");
});

test("the condition of the rows' date that the user decides is folded once above the rows, with its sentence and its quote", () => {
  const condition: Cited = {
    citation: "Rule 111(2)",
    link: "https://eur-lex.europa.eu/rule#111.002:~:text=Older%20cameras%20are%20covered%20only%20after%20a%20change.",
    quote: "Older cameras are covered only after a change.",
  };
  show(applying(testRows.map((item) => ({ ...item, status: "applies", needs: null, date: "2027-12-02", date_unit: testRows[1].date_unit, condition }))), null, []);

  const fold = screen.getByText("For a system already on the market or in service before that date");
  expect(fold.tagName).toBe("SUMMARY");
  const folded = fold.closest("details") as HTMLDetailsElement;
  expect(folded.open).toBe(false);
  expect(folded.textContent).toContain(
    "For a system placed on the market or put into service before that date, these rows apply only if its design changes significantly from that date. A system intended to be used by public authorities must meet them by 2 August 2030 in any case. You decide this.",
  );
  expect(screen.getAllByRole("link", { name: "Rule 111(2)" })).toHaveLength(1);
  expect(within(folded).getByText("Older cameras are covered only after a change.").tagName).toBe("BLOCKQUOTE");
});

// The summary (criterion 11).
test.each([
  ["open answers that rows depend on", applying(testRows), ["shares_video"], "1 obligation applies now. 1 answer to check could add 1 more."],
  ["nothing open", applying(), [], "2 obligations apply to your product."],
  ["an open answer that no row depends on", applying(), ["shares_video"], "2 obligations apply now. 1 answer is left to check."],
] as const)("the summary says how many obligations apply, and what the answers to check could add: %s", (_, gates, open, sentence) => {
  show([...gates], null, [...open]);

  expect(screen.getByText(/obligations? appl/).textContent).toBe(sentence);
});

// The list in the margin (issue #41), by part.
test("the list of the results has the three parts: the results that apply, the items to check and the results that may also apply, each with its number of rows", () => {
  const [audience, storage, , head] = testResult.gates;
  show(
    [
      head,
      { ...audience, rows: [conditional("audience_rules", "A sign for the public")] },
      { ...storage, status: "applies", result: "applies", conditions: [], rows: [testRows[0]] },
    ],
    null,
    ["audience"],
  );

  const list = within(screen.getByRole("navigation", { name: "The results" }));
  expect(list.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    [APPLIES, "#applies"],
    ["Camera Law", "#regulation-camera_law"],
    ["Storage role", "#result-storage"],
    [CHECK, "#check"],
    ["Audience", "#check-audience"],
    [ALSO, "#also"],
    ["Audience rules apply", "#also-audience-audience_rules"],
    ["Not checked yet", "#not-checked"],
  ]);
  expect(list.getAllByRole("listitem").map((item) => item.textContent)).toEqual(
    expect.arrayContaining(["Storage role1", "Audience1", "Audience rules apply1"]),
  );
  const short = within(screen.getByRole("navigation", { name: "The results, in short" }));
  expect(short.getAllByRole("link").map((link) => link.textContent)).toEqual([
    APPLIES,
    "Camera Law",
    "Storage role (1)",
    CHECK,
    "Audience (1)",
    ALSO,
    "Not checked yet",
  ]);
  for (const id of ["applies", "check", "also", "regulation-camera_law", "result-storage", "check-audience", "also-audience", "also-audience-audience_rules", "not-checked"]) {
    expect(document.getElementById(id)?.tagName, id).toBe("SECTION");
  }
});
