"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Intake, Schema, Step } from "../../service";
import FollowUpQuestion from "./follow-up-question";
import RecordedAnswers from "./recorded-answers";

// The screen of one intake: the question that waits for its answer, or the recorded answers.
export default function IntakeScreen() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ intake: Intake; schema: Schema } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
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

  useEffect(load, [load]);

  if (data === null) {
    return message ? <p role="alert">{message}</p> : <p>Loading the answers.</p>;
  }

  const { intake, schema } = data;

  function show(step: Step) {
    if (step.type === "question") {
      setData({ schema, intake: { ...intake, step } });
    } else {
      // The recorded answers need the new answers, so the intake is loaded again.
      setData(null);
      load();
    }
  }

  if (intake.step.type === "question") {
    // A key for each question, so that no choice of the previous question stays selected.
    return <FollowUpQuestion key={intake.step.number} id={id} question={intake.step} onStep={show} />;
  }
  return <RecordedAnswers intake={intake} schema={schema} />;
}
