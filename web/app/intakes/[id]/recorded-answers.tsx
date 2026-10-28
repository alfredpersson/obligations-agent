import { Fragment } from "react";
import { REASONS } from "../../not-sure-reason";
import type { Intake, Schema } from "../../service";

// The recorded answers of one intake, with the labels from the schema (INTAKE-5).
export default function RecordedAnswers({ intake, schema }: { intake: Intake; schema: Schema }) {
  const slots = [...schema.slots, ...schema.follow_up_slots];
  // A follow-up slot that was not asked has no answer, so it is not in the list of answers.
  const answered = slots.filter((slot) => slot.id in intake.answers);
  const open = slots.filter((slot) => intake.open_slots.includes(slot.id));
  return (
    <>
      <h1>Recorded answers</h1>
      {schema.description.map((field) => (
        <Fragment key={field.id}>
          <h2>{field.label}</h2>
          <p>{intake.description[field.id]}</p>
        </Fragment>
      ))}
      <h2>Answers</h2>
      <dl>
        {answered.map((slot) => (
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
          {open.map((slot) => {
            // An open slot that was answered "not sure" has a reason and a note (INTAKE-6); a
            // relevant slot that was never asked has none.
            const entry = intake.not_sure[slot.id];
            return (
              <li key={slot.id}>
                {slot.label}
                {entry && <div>{REASONS.find((reason) => reason.reason === entry.reason)?.label}</div>}
                {entry?.note && <div>Note: {entry.note}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
