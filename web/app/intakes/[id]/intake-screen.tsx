"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import layout from "../../layout.module.css";
import LoadingStatus from "../../loading-status";
import type { Intake, Schema, Step, Texts } from "../../service";
import FollowUpQuestion from "./follow-up-question";
import IntakeResult from "./intake-result";
import RecordedAnswers from "./recorded-answers";

// The message while the meaning and the action of each row are written.
const WRITING_TEXTS = "Writing what each row means for your product, and an action. This takes a few seconds.";

// The screen of one intake: the question that waits for its answer, in one column, or the result
// and the recorded answers, at the page's width.
export default function IntakeScreen() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ intake: Intake; schema: Schema } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState("Loading the answers.");

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

  // Once the result shows with rows and no texts yet, the screen asks the service to write them. The
  // service writes them once and returns the stored texts to a repeated request, so an effect that
  // runs again, as on a page that Next.js shows again, writes nothing more (MEMO-1).
  const pending =
    data !== null &&
    data.intake.texts !== null &&
    Object.keys(data.intake.texts).length === 0 &&
    (data.intake.result?.gates.some((outcome) => outcome.rows.length > 0) ?? false);
  useEffect(() => {
    if (!pending) return;
    fetch(`/api/intakes/${id}/texts`, { method: "POST" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return ((await response.json()) as { texts: Texts }).texts;
      })
      .catch(() => "failed" as const)
      .then((texts) =>
        setData(
          (old) =>
            old && {
              ...old,
              intake: {
                ...old.intake,
                // A failed request leaves each row without its texts, with a line that says so.
                texts:
                  texts === "failed"
                    ? Object.fromEntries(
                        (old.intake.result?.gates ?? []).flatMap((outcome) => outcome.rows.map((row) => [row.id, null])),
                      )
                    : texts,
              },
            },
        ),
      );
  }, [pending, id]);

  // One status for the screen, first in each of its views, so that React keeps its element and
  // screen readers announce the message after the last answer.
  const status = (
    <LoadingStatus message={data === null && message === null ? loading : pending ? WRITING_TEXTS : null} />
  );

  if (data === null) {
    return (
      <div className={layout.column}>
        {status}
        {message && <p role="alert">{message}</p>}
      </div>
    );
  }

  const { intake, schema } = data;

  function show(step: Step) {
    if (step.type === "question") {
      setData({ schema, intake: { ...intake, step } });
    } else {
      // The recorded answers need the new answers, so the intake is loaded again.
      setLoading("Loading the result.");
      setData(null);
      load();
    }
  }

  if (intake.step.type === "question") {
    const step = intake.step;
    // The heading is the label of the fact that the question asks about (RESP-6).
    const slot = [...schema.slots, ...schema.follow_up_slots].find((slot) => slot.id === step.slot);
    return (
      <div className={layout.column}>
        {status}
        <h1>{slot?.label}</h1>
        {/* A key for each question, so that no choice of the previous question stays selected. */}
        <FollowUpQuestion key={step.number} id={id} question={step} onStep={show} />
      </div>
    );
  }
  // The result first, then the recorded answers (GATE-4).
  return (
    <div className={layout.wide}>
      {status}
      {intake.result && (
        <IntakeResult result={intake.result} notSure={intake.not_sure} schema={schema} texts={intake.texts} />
      )}
      <RecordedAnswers intake={intake} schema={schema} />
    </div>
  );
}
