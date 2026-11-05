import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Cited, NotSure, Outcome, Row, Texts } from "../../service";
import { testResult, testRows, testSchema } from "../../testing";
import IntakeResult from "./intake-result";

// The intake ended with "not sure" about the audience, with a reason and a note; the slot
// stores_video is relevant and was not asked, so it has neither.
const notSure: Record<string, NotSure> = { audience: { reason: "unknown", note: "We sell to both." } };

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

function show(gates: Outcome[] = testResult.gates, texts: Texts = null) {
  render(<IntakeResult result={{ ...testResult, gates }} notSure={notSure} schema={testSchema} texts={texts} />);
}

// The part of the screen from a heading to the next heading of the same level or higher.
function under(name: string) {
  const heading = screen.getByRole("heading", { name });
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

test("each result shows its label as a heading under its regulation, what it gives, and the answers that decided it with their labels", () => {
  show([
    {
      ...testResult.gates[0],
      status: "applies",
      result: "applies",
      answers: { uses_camera: "yes" },
      conditions: [],
    },
  ]);

  expect(screen.getByRole("heading", { level: 3, name: "Audience rules apply" })).toBeTruthy();
  expect(under("Audience rules apply")[0].textContent).toBe("Applies. Your answer: Camera: Yes.");
});

test("a result that does not apply says so", () => {
  show([{ ...testResult.gates[0], status: "does_not_apply", result: "does_not_apply", conditions: [] }]);

  expect(under("Audience rules apply")[0].textContent).toBe("Does not apply. Your answer: Audience: Not sure.");
});

test("a conditional result names its open slot with the reason and the note, and gives the result for each answer", () => {
  show([testResult.gates[0]]);

  const parts = text(under("Audience rules apply"));
  expect(parts).toContain("Conditional.");
  expect(parts).toContain(
    "This depends on the open answer about Audience: I don't know this about the product. Note: We sell to both.",
  );
  expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toContain("If Staff: applies.");
  expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toContain(
    "If The public: does not apply.",
  );
});

test("a slot of the gate above names that gate, and a relevant slot without an answer says that it was not asked", () => {
  show();

  const parts = text(under("Storage role"));
  expect(parts).toContain(
    "This depends on the open answer about Audience, on which Audience rules apply depends: I don't know this about the product. Note: We sell to both.",
  );
  expect(parts).toContain("If Staff: depends on the other open answer.");
  expect(parts).toContain(
    "This depends on the open answer about Video storage: not asked before the intake ended.",
  );
  expect(parts).toContain("If Yes: applies.");
});

test("a slot of the gate that decides whether a regulation applies names the regulation", () => {
  show([
    { ...testResult.gates[3], status: "conditional", result: null, answers: { uses_camera: "not_sure" } },
    {
      ...testResult.gates[1],
      conditions: [{ slot: "uses_camera", gate: "camera_law_applies", cases: testResult.gates[0].conditions[0].cases }],
    },
  ]);

  expect(text(under("Storage role"))).toContain(
    "This depends on the open answer about Camera, as for the Camera Law above: not asked before the intake ended.",
  );
});

test.each([
  ["always", "Under Article 6(3), a use listed in Annex III is always high-risk when the product performs profiling."],
  [
    "unless",
    "Under Article 6(3), a use listed in Annex III is high-risk unless one of the conditions of that paragraph applies.",
  ],
] as const)("a listed use says that the user decides, and what Article 6(3) gives: %s", (derogation, sentence) => {
  show([{ ...testResult.gates[2], derogation }]);

  expect(under("Listed camera use")[0].textContent).toBe(
    `Conditional. High-risk if the product's intended use is one of the uses listed under the point of Annex III quoted below. You decide this. ${sentence} Your answers: Camera: Yes; Video sharing: Yes.`,
  );
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

  const items = screen.getAllByRole("listitem").map((item) => item.textContent);
  expect(items).toContain(
    "If one of the areas of Annex III quoted below: high-risk if the product's intended use is one of the uses listed under that point.",
  );
  expect(items.filter((item) => item?.includes("Staff"))).toEqual([]);
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

// The grouping by regulation (MEMO-6, issue #41).
test("the results are grouped by regulation: the head of a regulation decides whether it applies, and one without a head is assumed", () => {
  show();

  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
    "Camera Law",
    "Listing Law",
    "Not checked yet",
  ]);
  expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
    "Audience rules apply",
    "Storage role",
    "Listed camera use",
  ]);
  const camera = under("Camera Law");
  expect(camera[0].textContent).toBe("Applies. Your answer: Camera: Yes.");
  expect(text(camera)).toContain("Show the article that defines it: Rule 1(1)");
  expect(screen.queryByRole("heading", { name: "Camera Law applies" })).toBeNull();
  expect(under("Listing Law")[0].textContent).toBe(
    "Assumed. No check decides yet whether the Listing Law applies to the product: the result assumes that it does, as said above.",
  );
});

// The rows of a result (MEMO-5, issue #41), under a result that applies.
function withRows(rows: Row[] = testRows): Outcome[] {
  return [{ ...testResult.gates[1], status: "applies", conditions: [], rows }];
}

function rowHeaders() {
  return screen.getAllByRole("rowheader").map((cell) => cell.textContent);
}

test("the summary counts the rows and the results that have them", () => {
  show(withRows());

  expect(screen.getByText(/obligations for your product/).textContent).toBe(
    "2 obligations for your product under 1 result: 1 applies and 1 is conditional.",
  );
});

test("each row shows its label, its status, the date from which it applies, what else it needs, and its unit, with the quote folded", () => {
  show(withRows());

  expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Obligation"]);
  expect(rowHeaders()).toEqual([
    "Delete old videoApplies. From 25 May 2018 (Rule 99(2)).Rule 5(1)Show the quoted textVideo is deleted after a month.",
    "A notice at the doorConditional. Depends on the open answer about Video sharing. From 2 December 2027 (Rule 113). Needs Video sharing: not asked before the intake ended.Rule 6(1)Show the quoted textA notice is shown at each door.",
  ]);
  expect(screen.getByRole("link", { name: "Rule 99(2)" }).getAttribute("href")).toBe(
    "https://eur-lex.europa.eu/rule#099.002",
  );
  const citation = screen.getByRole("link", { name: "Rule 5(1)" });
  expect(citation.getAttribute("href")).toBe(testRows[0].unit.link);
  const folded = screen.getByText("Video is deleted after a month.").closest("details");
  expect(folded?.open).toBe(false);
});

test("a row that needs the answer yes of a fact names that answer", () => {
  show(withRows([{ ...testRows[1], status: "applies", needs: { slot: "shares_video", value: "yes", gate: null, status: null } }]));

  expect(rowHeaders()[0]).toContain("Applies. From 2 December 2027 (Rule 113). Needs Video sharing: Yes.");
});

test("a row that needs another result names it and its status", () => {
  show([
    testResult.gates[3],
    ...withRows([{ ...testRows[0], needs: { slot: null, value: null, gate: "camera_law_applies", status: "applies" } }]),
  ]);

  expect(rowHeaders()[0]).toContain("Needs Camera Law applies: Applies.");
});

test("the condition of the rows' date is quoted once above the rows, folded behind its citation", () => {
  const condition: Cited = {
    citation: "Rule 111(2)",
    link: "https://eur-lex.europa.eu/rule#111.002:~:text=Older%20cameras%20are%20covered%20only%20after%20a%20change.",
    quote: "Older cameras are covered only after a change.",
  };
  show(withRows(testRows.map((row) => ({ ...row, date: "2027-12-02", condition }))));

  expect(
    screen.getAllByText(
      "The rows below apply from 2 December 2027. For a system placed on the market or put into service before that date, they apply only if its design changes significantly from that date. A system intended to be used by public authorities must meet them by 2 August 2030 in any case. You decide this.",
    ),
  ).toHaveLength(1);
  expect(screen.getAllByRole("link", { name: "Rule 111(2)" })).toHaveLength(1);
  expect(screen.getByText("Older cameras are covered only after a change.").closest("details")?.open).toBe(false);
});

const PLACEHOLDER = "Writing what this means for your product, and an action.";

test("while the texts are written, each row shows a placeholder in the columns of the meaning and the action", () => {
  show(withRows(), {});

  expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
    "Obligation",
    "What it means for your product",
    "Action",
  ]);
  expect(screen.getAllByText(PLACEHOLDER)).toHaveLength(2);
});

test("the meaning and the action of each row show in their columns", () => {
  show(withRows(), {
    "storage:rule:art5(1)": { meaning: "You must delete video after a month.", action: "Add a job that deletes old video." },
    "storage:rule:art6(1)": { meaning: "If you share video, show a notice.", action: "Draft the notice." },
  });

  const rows = screen.getAllByRole("row").slice(1);
  expect(within(rows[0]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
    "You must delete video after a month.",
    "Add a job that deletes old video.",
  ]);
  expect(within(rows[1]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
    "If you share video, show a notice.",
    "Draft the notice.",
  ]);
  expect(screen.queryByText(PLACEHOLDER)).toBeNull();
});

test("a row whose texts could not be written says so, and the other rows show theirs", () => {
  show(withRows(), {
    "storage:rule:art5(1)": null,
    "storage:rule:art6(1)": { meaning: "If you share video, show a notice.", action: "Draft the notice." },
  });

  expect(screen.getByText("The meaning and the action of this row could not be written.")).toBeTruthy();
  expect(screen.getByText("Draft the notice.")).toBeTruthy();
  expect(screen.queryByText(PLACEHOLDER)).toBeNull();
});

test("without the key, the rows have no columns for the texts and no placeholder", () => {
  show(withRows(), null);

  expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Obligation"]);
  expect(screen.queryByText(PLACEHOLDER)).toBeNull();
  expect(screen.getAllByRole("rowheader")).toHaveLength(2);
});

test("the results are listed by regulation, each with its number of rows, as links to their parts", () => {
  show([...withRows(), testResult.gates[2], testResult.gates[3]]);

  const list = within(screen.getByRole("navigation", { name: "The results" }));
  expect(list.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Camera Law", "#regulation-camera_law"],
    ["Storage role", "#result-storage"],
    ["Listing Law", "#regulation-listing_law"],
    ["Listed camera use", "#result-camera_list"],
    ["Not checked yet", "#not-checked"],
  ]);
  expect(list.getAllByRole("listitem").map((item) => item.textContent)).toContain("Storage role2");
  const short = within(screen.getByRole("navigation", { name: "The results, in short" }));
  expect(short.getAllByRole("link").map((link) => link.textContent)).toEqual([
    "Camera Law",
    "Storage role (2)",
    "Listing Law",
    "Listed camera use",
    "Not checked yet",
  ]);
  expect(document.getElementById("result-storage")?.tagName).toBe("SECTION");
  expect(document.getElementById("regulation-camera_law")?.tagName).toBe("SECTION");
  expect(document.getElementById("not-checked")).toBeTruthy();
});
