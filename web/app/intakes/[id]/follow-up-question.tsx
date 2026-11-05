"use client";

import { type SubmitEvent, useId, useState, useTransition } from "react";
import styles from "../../actions.module.css";
import LoadingStatus from "../../loading-status";
import NotSureReason from "../../not-sure-reason";
import { type Asked, NOT_SURE, type NotSure } from "../../service";
import GuidanceExamples from "./guidance-examples";

// One question about a fact with its options, and the button that sends the answer: a follow-up
// question (INTAKE-1), or the question of a fact on the screen of the answers, which opens with the
// current answer chosen (INTAKE-5). The explanation, the examples and the check line come first,
// then the question with what each answer means, directly above the options (RESP-6).
export default function FollowUpQuestion<T>({
  question,
  request,
  button,
  current,
  waiting,
  onSent,
}: {
  question: Asked;
  // Where the answer goes, and what its body holds besides the value and, for "not sure", the
  // reason and the note.
  request: { url: string; method: "POST" | "PUT"; body?: Record<string, unknown> };
  button: string;
  current?: { value: string; notSure?: NotSure };
  // The status while the answer is sent: a follow-up answer waits for the next question.
  waiting?: string;
  onSent: (response: T) => void;
}) {
  const [value, setValue] = useState<string | null>(current?.value ?? null);
  const [notSure, setNotSure] = useState<Partial<NotSure>>(current?.notSure ?? {});
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();
  const meaning = useId();

  function send(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    // The button stays disabled until the request fails or what follows is shown, so that a second
    // click sends nothing.
    startTransition(async () => {
      try {
        const response = await fetch(request.url, {
          method: request.method,
          // The service refuses a JSON body without this header.
          headers: { "Content-Type": "application/json" },
          // JSON.stringify leaves out a key whose value is undefined, so another answer is sent
          // without not_sure, which the service refuses with any value but not_sure.
          body: JSON.stringify({
            ...request.body,
            value,
            not_sure: value === NOT_SURE ? notSure : undefined,
          }),
        });
        if (!response.ok) throw new Error();
        const sent = (await response.json()) as T;
        startTransition(() => onSent(sent));
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
      <div className={styles.actions}>
        <button
          type="submit"
          disabled={value === null || (value === NOT_SURE && !notSure.reason) || sending}
        >
          {button}
        </button>
        <LoadingStatus message={sending ? (waiting ?? null) : null} />
      </div>
    </form>
  );
}
