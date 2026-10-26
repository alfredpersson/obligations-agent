// The JSON that the service returns. The plans on issues #7, #12 and #16 show each response.

type Value = { id: string; label: string };

type Slot = { id: string; label: string; question: string; values: Value[] };

type DescriptionField = { id: string; label: string; question: string; max_length: number };

export type Schema = {
  description: DescriptionField[];
  slots: Slot[];
  follow_up_slots: Slot[];
};

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
  step: Step;
};
