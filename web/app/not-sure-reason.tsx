"use client";

import { useId } from "react";
import type { NotSure } from "./service";

// The two reasons of INTAKE-6, each with its label and the label of its note.
export const REASONS = [
  {
    reason: "unclear",
    label: "I don't understand the question",
    note: "What is unclear about the question? (optional)",
  },
  {
    reason: "unknown",
    label: "I don't know this about the product",
    note: "What do you need to check? (optional)",
  },
] as const;

// The reason for a "not sure" answer, and a note once a reason is chosen (INTAKE-6). The form and
// the question screen show it below the options while "not sure" is chosen.
export default function NotSureReason({
  value,
  onChange,
}: {
  value: Partial<NotSure>;
  onChange: (value: Partial<NotSure>) => void;
}) {
  // A name of its own for each group of reasons, so that the reasons of two slots on the form are
  // two groups of radio buttons.
  const name = useId();
  const chosen = REASONS.find((reason) => reason.reason === value.reason);
  return (
    <fieldset>
      <legend>Why are you not sure?</legend>
      {REASONS.map((reason) => (
        <label key={reason.reason}>
          <input
            type="radio"
            name={name}
            checked={value.reason === reason.reason}
            onChange={() => onChange({ ...value, reason: reason.reason })}
          />
          {reason.label}
        </label>
      ))}
      {chosen && (
        <label>
          {chosen.note}
          {/* The limit of INTAKE-6, which GET /schema does not return. */}
          <textarea
            value={value.note ?? ""}
            maxLength={500}
            onChange={(event) => onChange({ ...value, note: event.target.value })}
          />
        </label>
      )}
    </fieldset>
  );
}
