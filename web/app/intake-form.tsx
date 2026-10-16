"use client";

import { useRouter } from "next/navigation";
import { type SubmitEvent, useEffect, useState, useTransition } from "react";
import type { Schema } from "./service";

// The form: one group of choices for each slot in the schema, and the description (FACT-3 to FACT-5).
export default function IntakeForm() {
  const router = useRouter();
  const [schema, setSchema] = useState<Schema | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [sending, startTransition] = useTransition();

  useEffect(() => {
    fetch("/api/schema")
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<Schema>;
      })
      .then(setSchema)
      .catch(() => setMessage("The form could not be loaded. Reload the page to try again."));
  }, []);

  if (schema === null) {
    return message ? <p role="alert">{message}</p> : <p>Loading the form.</p>;
  }

  // "Not sure" counts as an answer.
  const complete = schema.slots.every((slot) => slot.id in answers) && description.trim() !== "";

  function send(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    // Send stays disabled until the request fails or the next page is shown, so that a second
    // click cannot store a second intake.
    startTransition(async () => {
      try {
        const response = await fetch("/api/intakes", {
          method: "POST",
          // The service refuses a JSON body without this header.
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers, description }),
        });
        if (!response.ok) throw new Error();
        const { id } = (await response.json()) as { id: string };
        startTransition(() => router.push(`/intakes/${id}`));
      } catch {
        setMessage("The answers could not be sent. Try again.");
      }
    });
  }

  return (
    <form onSubmit={send}>
      <label>
        {schema.description.question}
        <textarea
          value={description}
          maxLength={schema.description.max_length}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      {schema.slots.map((slot) => (
        <fieldset key={slot.id}>
          <legend>{slot.question}</legend>
          {slot.values.map((value) => (
            <label key={value.id}>
              <input
                type="radio"
                name={slot.id}
                checked={answers[slot.id] === value.id}
                onChange={() => setAnswers({ ...answers, [slot.id]: value.id })}
              />
              {value.label}
            </label>
          ))}
        </fieldset>
      ))}
      {message && <p role="alert">{message}</p>}
      <button type="submit" disabled={!complete || sending}>
        Send
      </button>
    </form>
  );
}
