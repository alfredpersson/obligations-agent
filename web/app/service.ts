// The JSON that the service returns. The plans on issues #7 and #12 show each response.

type Value = { id: string; label: string };

type Slot = { id: string; label: string; question: string; values: Value[] };

type DescriptionField = { id: string; label: string; question: string; max_length: number };

export type Schema = {
  description: DescriptionField[];
  slots: Slot[];
};

export type Intake = {
  description: Record<string, string>;
  answers: Record<string, string>;
  open_slots: string[];
};
