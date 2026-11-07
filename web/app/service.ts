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

// A result in a what-if: its status, the labels of the open answers that it depends on, and what
// Article 6(3) gives for a listed use.
export type State = { status: Outcome["status"]; open: string[]; article_6_3: string | null };

// A row in a what-if, with the label of its result and its date in words.
type RowChange = {
  label: string;
  result: string;
  category: Row["category"];
  status: Row["status"];
  citation: string;
  date: string;
};

// What one or more changed answers would change in the whole result, as code computes it from the
// same gates and rows as the result, with no model (QA-1, QA-4): the answers applied, by their labels,
// and those that could not be applied; each result whose status, open answers or Article 6(3) outcome
// would change, null where it is not in the result; the rows that would be added, removed or change
// their status, a changed row with its status before; and the labels of the facts whose questions
// would become open or no longer be asked.
export type WhatIf = {
  changed: { fact: string; fact_id: string; value: string; now: string; to: string }[];
  refused: { fact: string; value: string; error: "unknown_fact" | "not_asked" | "unknown_value" | "same_answer" }[];
  results: { result: string; regulation: string; before: State | null; after: State | null }[];
  rows_added: RowChange[];
  rows_removed: RowChange[];
  rows_changed: (RowChange & { before: Row["status"] })[];
  now_open: string[];
  no_longer_asked: string[];
};

// A part of the text of an answer, with its link to EUR-Lex where it is a citation (MEMO-7).
export type Segment = { text: string; link: string | null };

// What code shows for a change to the product: each question whose answer the change may change,
// with the label of the answer now and of the value it may take, and the entries from official
// guidance that clarify it, and what those answers would change together (QA-4, FACT-6, RESP-5).
export type Scenario = {
  questions: { fact: string; fact_id: string; question: string; now: string; to: string; guidance: Example[] }[];
  changes: WhatIf;
};

// A question about the result or about a change to the product, with its answer: the text in
// paragraphs and lists, the quotes that occur word for word in a stored copy, and the entries from
// official guidance that it names (QA-3 to QA-6). A question that could not be answered has none of
// them (QA-8). for_earlier_answers is true once an answer of the intake changed after the question
// (QA-9).
export type Turn = {
  question: string;
  answered: boolean;
  blocks: (
    | { kind: "paragraph"; segments: Segment[] }
    | { kind: "list"; ordered: boolean; start: number; items: Segment[][] }
  )[];
  quotes: { citation: string; link: string; text: string }[];
  guidance: Example[];
  scenario: Scenario | null;
  for_earlier_answers: boolean;
};

export type Intake = {
  // The id in the addresses of the intake, also those of the panel's questions.
  id: string;
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
  // What each value of each open answer would change in the whole result, by slot and value, also
  // without the key (QA-1). Null until the answers are confirmed.
  open_changes: Record<string, Record<string, WhatIf>> | null;
  // The questions about the result, in order, each with its answer. Null without the key, and until
  // the answers are confirmed (QA-2, QA-9).
  conversation: Turn[] | null;
};
