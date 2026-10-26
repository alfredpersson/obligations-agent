"use client";

import { type SubmitEvent, useState, useTransition } from "react";
import type { Question, Step } from "../../service";

// One follow-up question with the options of its step, and the button that sends the answer
// (INTAKE-1).
export default function FollowUpQuestion({
  id,
  question,
  onStep,
}: {
  id: string;
  question: Question;
  onStep: (step: Step) => void;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();

  function send(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    // Next stays disabled until the request fails or the next step is shown, so that a second
    // click sends nothing.
    startTransition(async () => {
      try {
        const response = await fetch(`/api/intakes/${id}/answers`, {
          method: "POST",
          // The service refuses a JSON body without this header.
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: question.number, value }),
        });
        if (!response.ok) throw new Error();
        const { step } = (await response.json()) as { step: Step };
        startTransition(() => onStep(step));
      } catch {
        setMessage("The answer could not be sent. Try again.");
      }
    });
  }

  return (
    <form onSubmit={send}>
      <h1>Question {question.number}</h1>
      <fieldset>
        <legend>{question.text}</legend>
        {question.options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name="answer"
              checked={value === option.value}
              onChange={() => setValue(option.value)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      {message && <p role="alert">{message}</p>}
      <button type="submit" disabled={value === null || sending}>
        Next
      </button>
    </form>
  );
}
