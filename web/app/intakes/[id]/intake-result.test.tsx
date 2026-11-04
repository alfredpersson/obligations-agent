import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { NotSure, Outcome } from "../../service";
import { testResult, testSchema } from "../../testing";
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

function show(gates: Outcome[] = testResult.gates) {
  render(<IntakeResult result={{ ...testResult, gates }} notSure={notSure} schema={testSchema} />);
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
  const assumptions = within(screen.getByText("This result assumes:").nextElementSibling as HTMLElement);
  expect(assumptions.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "The product is a camera system. Rule 1",
  ]);
  expect(assumptions.getByRole("link", { name: "Rule 1" }).getAttribute("href")).toBe(
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

test("each gate shows its label as a heading, what it gives, and the answers that decided it with their labels", () => {
  show([
    {
      ...testResult.gates[0],
      status: "applies",
      result: "applies",
      answers: { uses_camera: "yes" },
      conditions: [],
    },
  ]);

  expect(screen.getByRole("heading", { level: 2, name: "Audience rules apply" })).toBeTruthy();
  const parts = under("Audience rules apply");
  expect(parts[0].textContent).toBe("Applies.");
  expect(within(parts[1] as HTMLElement).getByRole("term").textContent).toBe("Camera");
  expect(within(parts[1] as HTMLElement).getByRole("definition").textContent).toBe("Yes");
});

test("a result that does not apply says so", () => {
  show([{ ...testResult.gates[0], status: "does_not_apply", result: "does_not_apply", conditions: [] }]);

  expect(under("Audience rules apply")[0].textContent).toBe("Does not apply.");
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

test.each([
  ["always", "Under Article 6(3), a use listed in Annex III is always high-risk when the product performs profiling."],
  [
    "unless",
    "Under Article 6(3), a use listed in Annex III is high-risk unless one of the conditions of that paragraph applies.",
  ],
] as const)("a listed use says that the user decides, and what Article 6(3) gives: %s", (derogation, sentence) => {
  show([{ ...testResult.gates[2], derogation }]);

  expect(under("Listed camera use")[0].textContent).toBe(
    `Conditional. High-risk if the product's intended use is one of the uses listed under the point of Annex III quoted below. You decide this. ${sentence}`,
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

test("each quote shows its citation as a link to EUR-Lex, then the quote with its lines", () => {
  show([testResult.gates[0]]);

  const link = screen.getByRole("link", { name: "Rule 2(1)" });
  expect(link.getAttribute("href")).toBe(testResult.gates[0].quotes[0].link);
  expect(link.getAttribute("target")).toBe("_blank");
  const quote = link.closest("p")?.nextElementSibling;
  expect(quote?.tagName).toBe("BLOCKQUOTE");
  expect(quote?.textContent).toBe("Staff cameras are covered:\n(a) door cameras;");
});
