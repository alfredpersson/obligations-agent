"use client";

import { useParams } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import type { Intake, Schema } from "../../service";

// The recorded answers of one intake, with the labels from the schema (INTAKE-5).
export default function RecordedAnswers() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ intake: Intake; schema: Schema } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetch(`/api/intakes/${id}`), fetch("/api/schema")])
      .then(async ([intakeResponse, schemaResponse]) => {
        if (intakeResponse.status === 404) {
          setMessage("This intake was not found.");
          return;
        }
        if (!intakeResponse.ok || !schemaResponse.ok) throw new Error();
        const intake = (await intakeResponse.json()) as Intake;
        const schema = (await schemaResponse.json()) as Schema;
        setData({ intake, schema });
      })
      .catch(() => setMessage("The answers could not be loaded. Reload the page to try again."));
  }, [id]);

  if (data === null) {
    return message ? <p role="alert">{message}</p> : <p>Loading the answers.</p>;
  }

  const { intake, schema } = data;
  const open = schema.slots.filter((slot) => intake.open_slots.includes(slot.id));
  return (
    <>
      {schema.description.map((field) => (
        <Fragment key={field.id}>
          <h2>{field.label}</h2>
          <p>{intake.description[field.id]}</p>
        </Fragment>
      ))}
      <h2>Answers</h2>
      <dl>
        {schema.slots.map((slot) => (
          <div key={slot.id}>
            <dt>{slot.label}</dt>
            <dd>{slot.values.find((value) => value.id === intake.answers[slot.id])?.label}</dd>
          </div>
        ))}
      </dl>
      <h2>Open questions</h2>
      {open.length === 0 ? (
        <p>No open questions.</p>
      ) : (
        <ul>
          {open.map((slot) => (
            <li key={slot.id}>{slot.label}</li>
          ))}
        </ul>
      )}
    </>
  );
}
