import type { Outcome, Result, Row, Slot } from "../../service";

// The three parts of the result (MEMO-6): the results that the answers decide, the items of the
// second part in their order, and the group of the third part that holds each conditional row. The
// result screen and the files of the export read them, so that both show the same parts.

// An item of the second part (VALID-2) is an open answer, by its slot's id, or, for a high-risk
// result for a point of Annex III, whether the product's intended use is one of the uses listed
// under that point, which no answer of the intake holds, by "listed-" and the result's gate (GATE-4).
export const listed = (gate: string) => `listed-${gate}`;

// The items that a result depends on: its open slots, and the listed use of a high-risk result. The
// conditions of Article 6(3) belong to the listed use.
export function openOf(outcome: Outcome) {
  return [
    ...outcome.conditions.map((condition) => condition.slot),
    ...(outcome.result === "listed_use" ? [listed(outcome.gate)] : []),
  ];
}

// The items that a conditional row depends on: those of its result, the fact that it also needs while
// that fact's answer is not "yes", and those of the result that it also needs (GATE-5). decide()
// makes a row conditional in exactly these cases, so a conditional row has at least one item. The
// writer states the same in words for the model (depends_on() in writer.py).
function dependsOn(result: Result, outcome: Outcome, row: Row) {
  const needs = row.needs;
  const gate = needs?.gate ? result.gates.find((item) => item.gate === needs.gate) : undefined;
  return [
    ...new Set([
      ...openOf(outcome),
      ...(needs?.slot && needs.value !== "yes" ? [needs.slot] : []),
      ...(gate ? openOf(gate) : []),
    ]),
  ];
}

// The point of Annex III that a high-risk result quotes for a listed use.
export function pointOf(outcome: Outcome) {
  return outcome.quotes.find((unit) => unit.citation.includes("Annex III"));
}

// A conditional row with its result and the items that it depends on.
export type Placed = { outcome: Outcome; row: Row; on: string[] };

// An item of the second part: an open slot, or a high-risk result's listed use, with the number of
// conditional rows that depend on it.
export type Item = { key: string; slot: string | null; outcome: Outcome | null; rows: number };

// What the titles and the sentences of the items need: the result, and the label of a slot.
export type Labels = { result: Result; labelOf: (slot: string) => string | undefined };

// The title of an item: the label of its fact, or the point of Annex III.
export function titleOf(item: Item, ctx: Labels) {
  return item.slot !== null
    ? ctx.labelOf(item.slot)
    : `Intended use listed under ${item.outcome && pointOf(item.outcome)?.citation}`;
}

// An item in a sentence, such as "the open answer about Profiling".
export function said(item: string, ctx: Labels) {
  const outcome = ctx.result.gates.find((gate) => listed(gate.gate) === item);
  return outcome
    ? `whether the intended use is one of the uses listed under ${pointOf(outcome)?.citation}`
    : `the open answer about ${ctx.labelOf(item)}`;
}

// Each regulation with the result that decides whether it applies, and its other results, for the
// regulations that the result holds (MEMO-6).
function groups(result: Result) {
  return result.regulations
    .map((regulation) => ({
      regulation,
      head: result.gates.find((gate) => gate.gate === regulation.gate),
      parts: result.gates.filter((gate) => gate.regulation === regulation.id && gate.gate !== regulation.gate),
    }))
    .filter(({ head, parts }) => head || parts.length > 0);
}

// The regulations of the first part, each with the results that the answers decide: its head, when
// it is decided, and its other results that are. A regulation without one shows only when the result
// assumes it to apply (MEMO-6).
function decided(result: Result) {
  return groups(result)
    .map(({ regulation, head, parts }) => ({
      regulation,
      head: head?.status === "conditional" ? undefined : head,
      parts: parts.filter((outcome) => outcome.status !== "conditional"),
    }))
    .filter(({ regulation, head, parts }) => head || parts.length > 0 || regulation.gate === null);
}

// The rows of a result that apply.
export const applying = (outcome: Outcome) => outcome.rows.filter((row) => row.status === "applies");

// The rows that apply now, and what the answers to check could add.
export function summary(rows: Row[], items: number) {
  const applies = rows.filter((row) => row.status === "applies").length;
  const conditional = rows.length - applies;
  const now =
    applies === 0
      ? "No obligation applies"
      : `${applies} ${applies === 1 ? "obligation applies" : "obligations apply"}`;
  if (items === 0) return `${now} to your product.`;
  const answers = `${items} ${items === 1 ? "answer" : "answers"}`;
  return conditional === 0
    ? `${now} now. ${answers} ${items === 1 ? "is" : "are"} left to check.`
    : `${now} now. ${answers} to check could add ${conditional} more.`;
}

// The results that depend on an open slot, and the conditional rows that need the slot's fact while
// their result does not depend on it: what an open answer of the second part gives.
export function onSlot(result: Result, placed: Placed[], slot: string) {
  const results = result.gates.filter((outcome) => outcome.conditions.some((condition) => condition.slot === slot));
  return { results, needs: placed.filter(({ row, outcome }) => row.needs?.slot === slot && !results.includes(outcome)) };
}

// The slot of Article 6(3) of a high-risk result, while it is open.
export const profilingOf = (outcome: Outcome) =>
  outcome.conditions.find((condition) => condition.cases.some((entry) => entry.result === "always"));

// The parts of a result: the regulations of the first part, the conditional rows with the items that
// they depend on, the items of the second part, and the groups of the third part.
export function parts(result: Result, openSlots: string[], slots: Slot[]) {
  const list = decided(result);
  const placed: Placed[] = result.gates.flatMap((outcome) =>
    outcome.rows
      .filter((row) => row.status === "conditional")
      .map((row) => ({ outcome, row, on: dependsOn(result, outcome, row) })),
  );
  // The items: each open slot, and each item that a result or a row depends on, in the order of the
  // number of rows that depend on each, most first; in a tie the listed use first, since the answer
  // about profiling only matters for a listed use, then the slots in the schema's order (MEMO-6).
  const order = (key: string) => slots.findIndex((slot) => slot.id === key);
  const items: Item[] = [...new Set([...openSlots, ...result.gates.flatMap(openOf), ...placed.flatMap(({ on }) => on)])]
    .map((key) => {
      const outcome = result.gates.find((gate) => listed(gate.gate) === key) ?? null;
      return { key, slot: outcome ? null : key, outcome, rows: placed.filter(({ on }) => on.includes(key)).length };
    })
    .sort((a, b) => b.rows - a.rows || Number(b.slot === null) - Number(a.slot === null) || order(a.key) - order(b.key));
  // Each conditional row under the first item that it depends on (GATE-5).
  const also = items
    .map((item) => ({ item, rows: placed.filter(({ on }) => items.find((first) => on.includes(first.key)) === item) }))
    .filter((group) => group.rows.length > 0);
  return { list, placed, items, also };
}

// The rows of one result in a group of the third part, each with the other items that it depends on,
// and those that every row shares, which the result names once above its rows.
export function alsoRows(here: Placed[], outcome: Outcome, item: Item) {
  const entries = here
    .filter((entry) => entry.outcome === outcome)
    .map(({ row, on }) => ({ row, also: on.filter((other) => other !== item.key) }));
  const shared = entries[0].also;
  const once = shared.length > 0 && entries.every(({ also: other }) => other.join() === shared.join());
  return { entries: once ? entries.map(({ row }) => ({ row, also: [] })) : entries, shared: once ? shared : [] };
}
