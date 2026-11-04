"use client";

import { type SubmitEvent, useId, useState, useTransition } from "react";
import NotSureReason from "../../not-sure-reason";
import { NOT_SURE, type NotSure, type Question, type Step } from "../../service";
import GuidanceExamples from "./guidance-examples";

// One follow-up question with the options of its step, and the button that sends the answer
// (INTAKE-1). The explanation, the examples and the check line come first, then the question
// with what each answer means, directly above the options (RESP-6).
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
  const [notSure, setNotSure] = useState<Partial<NotSure>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  const meaning = useId();

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
          // JSON.stringify leaves out a key whose value is undefined, so another answer is sent
          // without not_sure, which the service refuses with any value but not_sure.
          body: JSON.stringify({
            question: question.number,
            value,
            not_sure: value === NOT_SURE ? notSure : undefined,
          }),
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
      {question.explanation && <p>{question.explanation}</p>}
      {question.examples.length > 0 && <GuidanceExamples examples={question.examples} />}
      {question.check && <p>{question.check}</p>}
      <fieldset aria-describedby={question.meaning ? meaning : undefined}>
        <legend>{question.text}</legend>
        {question.meaning && <p id={meaning}>{question.meaning}</p>}
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
        {value === NOT_SURE && <NotSureReason value={notSure} onChange={setNotSure} />}
      </fieldset>
      {message && <p role="alert">{message}</p>}
      <button
        type="submit"
        disabled={value === null || (value === NOT_SURE && !notSure.reason) || sending}
      >
        Next
      </button>
    </form>
  );
}
