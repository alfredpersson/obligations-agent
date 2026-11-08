import type { WhatIf } from "../../service";

// What a result says (GATE-2), the question of the second part for a high-risk result for an area
// of Annex III (GATE-4), and the names of the three parts of the result (MEMO-6). The result screen
// and the excerpt on the start page use them.
export const STATUS = { applies: "Applies.", does_not_apply: "Does not apply.", conditional: "Conditional." };
export const LISTED_USE =
  "Is the product's intended use one of the uses listed under this point? You decide this: no answer of the intake holds it.";
export const PARTS = ["What applies", "Answers to check", "What may also apply"] as const;

// The sentences that the result screen and the files of the export both show, so that both say the
// same.

// What each answer of a conditional result gives (GATE-2, VALID-2).
export const CASE: Record<string, string> = {
  applies: "applies",
  does_not_apply: "does not apply",
  conditional: "depends on the other open answer",
  listed_use: "high-risk if the product's intended use is one of the uses listed under that point",
  always: "a listed use is always high-risk",
  unless: "a listed use is high-risk unless one of the conditions of Article 6(3) applies",
};
// What Article 6(3) gives for a listed use while profiling is answered "yes"; "no" gives the
// conditions of that paragraph, which the listed use names in its case (GATE-4).
export const ALWAYS = "Under Article 6(3), a use listed in Annex III is always high-risk when the product performs profiling.";
// Who carries out the action of a row (MEMO-5).
export const CATEGORY = { legal: "Legal", technical: "Technical", organisation: "Organisation" };
// A date of the regulations, such as "2 December 2027".
export const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export const NOTHING_OPEN = "Nothing is left to check: the result depends on no open answer.";
export const ALSO_LINE = "These obligations depend on the answers above.";
export const NOT_WRITTEN = "The meaning and the action of this row could not be written.";
// After the link of a row's unit that its result quotes, which shows the quote once (MEMO-8).
export const QUOTED_ABOVE = ", quoted above as the article that defines the result";
// An answer of an open item for a high-risk result: the areas of Annex III as one case, the answer
// "no" of a fact that a row needs, and a use that is not listed.
export const AREAS = "one of the areas of Annex III";
export const IF_NO = "If No: does not apply.";
export const IF_NOT_LISTED = "If it is not listed: does not apply.";

export function assumed(name: string) {
  return `No check decides yet whether the ${name} applies to the product: the result assumes that it does, as said above.`;
}

// The number of the rows that depend on an item of the second part.
export function counted(rows: number) {
  return rows === 0
    ? "No obligation depends on this answer now."
    : `${rows} ${rows === 1 ? "obligation depends" : "obligations depend"} on this`;
}

// The line in place of the rows of a result that has rows, none of them of the category that the
// result screen shows (MEMO-11).
export const noneOf = (category: keyof typeof CATEGORY) => `No ${CATEGORY[category].toLowerCase()} obligations here.`;

// The other items that a row, or every row of a result, of the third part depends on.
export const alsoOn = (items: string[]) => `Also depends on ${items.join(", and on ")}.`;
export const eachAlsoOn = (items: string[]) => `Each of these also depends on ${items.join(", and on ")}.`;

// What else a row needs: the answer of a fact, or the status of another result.
export const needsFact = (label: string | undefined, value: string | undefined) =>
  `Needs ${label}: ${value ?? "not answered yet"}.`;
export const needsResult = (label: string, status: keyof typeof STATUS) => `Needs ${label}: ${STATUS[status]}`;

// What the answers of an open item give for a result.
export const caseOf = (values: string, result: string) => `If ${values}: ${CASE[result]}.`;
// What the answer "yes" of a fact gives for a row that needs it, while the row's result does not
// depend on the fact.
export const ifYes = (status: string) => `If Yes: ${status === "conditional" ? CASE.conditional : "applies"}.`;
// What a listed use gives for a high-risk result, with the open answer about profiling, if any.
export const ifListed = (profiling: string | undefined, derogation: "always" | "unless" | null) =>
  `If it is listed: ${
    profiling
      ? `depends on the open answer about ${profiling}`
      : derogation === "unless"
        ? "applies, unless one of the conditions of Article 6(3) applies"
        : "applies"
  }.`;

// The statuses without the full stop that the result's sentences end with, as in "Conditional to
// Applies".
export const STATE = { applies: "Applies", does_not_apply: "Does not apply", conditional: "Conditional" };

// A number with its word, such as "1 obligation" or "2 questions".
export function many(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// The titles of the rows that changed answers would remove, and of those whose status they would
// change, in the panel, under an open answer, in a planned change and in its file (#44, #63).
export const NO_LONGER_APPLY = "Obligations that would no longer apply";
export const STATUS_WOULD_CHANGE = "Obligations whose status would change";

// The part of the planned changes, after the three parts (#63), and its line.
export const PLANNED = "Planned changes";
export const PLANNED_LINE =
  "What the rules would give for each change that you plan, each computed for your answers with its own. Your answers and the parts above stay as they are.";

// The line under the label of a planned change: the number of obligations that it would add and
// remove (#63).
export function plannedCount(change: WhatIf) {
  const added = change.rows_added.length;
  const removed = change.rows_removed.length;
  if (added === 0 && removed === 0) return "Adds no obligation and removes none.";
  if (removed === 0) return `Adds ${many(added, "obligation")}.`;
  if (added === 0) return `Removes ${many(removed, "obligation")}.`;
  return `Adds ${many(added, "obligation")} and removes ${removed}.`;
}

// The question of a planned change (#63).
export const youAsked = (question: string) => `You asked: ${question}`;

// What a row depends on, in the file, and on the screen for a row of a planned change.
export const dependsOn = (items: string[]) => `Depends on ${items.join(", and on ")}.`;

// An answer of a planned change that can no longer be applied, once the answers of the intake changed
// (#63).
export function cannotApply(
  item: WhatIf["refused"][number],
  labelOf: (slot: string) => string | undefined,
  valueOf: (slot: string, value: string) => string | undefined,
) {
  const fact = labelOf(item.fact) ?? item.fact;
  const value = valueOf(item.fact, item.value) ?? item.value;
  if (item.error === "same_answer") return `${fact}: ${value} is your answer now, so this change no longer changes it.`;
  if (item.error === "not_asked") return `${fact} is no longer asked with your answers, so the change's answer ${value} cannot be applied.`;
  return `${fact}: ${value} cannot be applied.`;
}
