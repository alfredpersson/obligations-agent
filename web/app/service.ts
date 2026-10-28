// The JSON that the service returns. The plans on issues #7, #12, #16 and #24 show each response.

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

export type Question = {
  type: "question";
  number: number;
  text: string;
  options: { value: string; label: string }[];
};

export type Step = Question | { type: "ready_to_confirm" };

export type Intake = {
  description: Record<string, string>;
  answers: Record<string, string>;
  open_slots: string[];
  not_sure: Record<string, NotSure>;
  step: Step;
};
