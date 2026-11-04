// The JSON that the service returns. The plans on issues #7, #12, #16, #24, #32, #34 and #36 show
// each response.

type Value = { id: string; label: string };

type Slot = { id: string; label: string; question: string; values: Value[] };

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

export type Question = {
  type: "question";
  number: number;
  slot: string;
  text: string;
  explanation: string;
  meaning: string;
  options: { value: string; label: string }[];
  examples: Group[];
  check: string;
};

export type Step = Question | { type: "ready_to_confirm" };

export type Intake = {
  description: Record<string, string>;
  answers: Record<string, string>;
  open_slots: string[];
  not_sure: Record<string, NotSure>;
  step: Step;
};
