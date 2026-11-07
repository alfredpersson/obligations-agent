// The JSON that the service returns. The plans on issues #7, #12, #16, #24, #32, #34 and #36 show
// each response.

type Value = { id: string; label: string };

export type Slot = { id: string; label: string; question: string; values: Value[] };

type DescriptionField = { id: string; label: string; question: string; max_length: number };

export type Schema = {
  description: DescriptionField[];
  slots: Slot[];
  follow_up_slots: Slot[];
};

// The value of "not sure" in every slot (FACT-2). The web app finds that option by this value,
// never by its label, because the model writes the labels of follow-up questions.
export const NOT_SURE = "not_sure";

// The reason and the note of a "not sure" answer (INTAKE-6).
export type NotSure = { reason: "unclear" | "unknown"; note: string };

// An entry from official guidance, with its quotes and its source (RESP-5).
export type Example = {
  id: string;
  quotes: { heading: string; text: string }[];
  source: { id: string; title: string; body: string; link: string; checked: string; note: string | null };
};

// The entries that the model matched to one part of the user's text, with its line about that part
// (RESP-5).
export type Group = { line: string; entries: Example[] };

// A question about one fact: a follow-up question as the model or code wrote it, or the default
// question of a fact (RESP-6).
export type Asked = {
  slot: string;
  text: string;
  explanation: string;
  meaning: string;
  options: { value: string; label: string }[];
  examples: Group[];
  check: string;
};

// The follow-up question that waits for its answer, with its number.
export type Question = Asked & { type: "question"; number: number };

export type Step = Question | { type: "ready_to_confirm" };

// A unit that the result quotes or links: its citation, its link to EUR-Lex, and its quote, or
// null for a unit that is only linked (MEMO-7, MEMO-8).
export type Cited = { citation: string; link: string; quote: string | null };

// An open slot that a result depends on, with the result for its answers: of the gate itself, or,
// for a gate under another one, where the gate above applies (MEMO-6).
export type Condition = { slot: string; gate: string; cases: { values: string[]; result: string }[] };

// A row of a result: its unit quoted and linked, the date from which it applies with the unit that
// sets it, a condition of that date that the user decides with its title and its sentence, and what
// else it needed: the answer of a slot, or null while the slot is open, or the status of another gate
// (MEMO-5, MEMO-6).
export type Row = {
  id: string;
  label: string;
  status: "applies" | "conditional";
  unit: Cited;
  date: string;
  date_unit: Cited;
  condition: (Cited & { title: string; text: string }) | null;
  needs: { slot: string | null; value: string | null; gate: string | null; status: string | null } | null;
  drafting: boolean;
  category: "legal" | "technical" | "organisation";
};

// The result of one gate (GATE-2, GATE-4), with the regulation that it belongs to, and its rows.
export type Outcome = {
  gate: string;
  label: string;
  regulation: string;
  status: "applies" | "does_not_apply" | "conditional";
  result: "applies" | "does_not_apply" | "listed_use" | null;
  derogation: "always" | "unless" | null;
  answers: Record<string, string>;
  conditions: Condition[];
  quotes: Cited[];
  rows: Row[];
};

// What the clause of a row means for this product, and one action, as a model wrote them (MEMO-5).
export type Text = { meaning: string; action: string };

// The texts of the rows by row id, null for a row whose texts could not be written. The whole map is
// null when the service has no key, and empty until the texts are written.
export type Texts = Record<string, Text | null> | null;

export type Statement = { text: string; links: Cited[] };

// A regulation that the result groups its results under, and the gate that decides whether it
// applies, or null for a regulation that the result assumes to apply (MEMO-6).
export type Regulation = { id: string; name: string; gate: string | null };

export type Result = {
  assumptions: Statement[];
  regulations: Regulation[];
  gates: Outcome[];
  not_checked: Statement[];
};

export type Intake = {
  description: Record<string, string>;
  answers: Record<string, string>;
  open_slots: string[];
  not_sure: Record<string, NotSure>;
  // The last question asked about each relevant fact, or its default question (INTAKE-5).
  questions: Record<string, Asked>;
  step: Step;
  // True from the user's confirmation until the next change of an answer.
  confirmed: boolean;
  // Null until the answers are confirmed.
  result: Result | null;
  texts: Texts;
};
