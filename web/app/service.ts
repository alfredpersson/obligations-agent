// The JSON that the service returns. The plan on issue #7 shows each response.

type Value = { id: string; label: string };

type Slot = { id: string; label: string; question: string; values: Value[] };

export type Schema = {
  description: { label: string; question: string; max_length: number };
  slots: Slot[];
};

export type Intake = {
  description: string;
  answers: Record<string, string>;
  open_slots: string[];
};
