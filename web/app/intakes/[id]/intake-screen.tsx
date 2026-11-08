"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import layout from "../../layout.module.css";
import LoadingStatus, { WRITING } from "../../loading-status";
import type { Intake, Step, Texts } from "../../service";
import FollowUpQuestion from "./follow-up-question";
import IntakeResult from "./intake-result";
import { useIntake } from "./use-intake";

// The message while the meaning and the action of each row are written.
const WRITING_TEXTS = "Writing what each row means for your product, and an action. This takes a few seconds.";

// Once the questions have ended, the result shows only for confirmed answers, and an intake whose
// answers are not confirmed goes to the screen of the answers (INTAKE-5).
function redirect(intake: Intake, id: string) {
  return intake.step.type !== "question" && !intake.confirmed ? `/intakes/${id}/answers` : null;
}

// The screen of one intake: the question that waits for its answer, in one column, or the result of
// the confirmed answers, at the page's width.
export default function IntakeScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, setData, message } = useIntake(id, redirect);

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
    // A response that ends after the page was hidden changes nothing: the page shown again sends its
    // own request.
    let current = true;
    fetch(`/api/intakes/${id}/texts`, { method: "POST" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return ((await response.json()) as { texts: Texts }).texts;
      })
      .catch(() => "failed" as const)
      .then((texts) => {
        if (!current) return;
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
        );
      });
    return () => {
      current = false;
    };
  }, [pending, id, setData]);

  // One status for the screen, first in each of its views, so that React keeps its element and
  // screen readers announce a change of its message, such as the writing of the texts.
  const status = (
    <LoadingStatus message={data === null && message === null ? "Loading the answers." : pending ? WRITING_TEXTS : null} />
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
      // After the last answer, the user checks the answers on their own screen.
      router.replace(`/intakes/${id}/answers`);
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
        <FollowUpQuestion
          key={step.number}
          question={step}
          request={{ url: `/api/intakes/${id}/answers`, method: "POST", body: { question: step.number } }}
          button="Next"
          waiting={WRITING}
          onSent={(sent: { step: Step }) => show(sent.step)}
        />
      </div>
    );
  }
  // The result of the confirmed answers, with the way back to the screen of the answers (GATE-4).
  return (
    <div className={layout.wide}>
      {status}
      {intake.result && (
        <IntakeResult
          intake={{ ...intake, result: intake.result }}
          schema={schema}
          answers={`/intakes/${id}/answers`}
          // The turn joins the intake as it is now, with texts that arrived while the question waited.
          onTurn={(turn) =>
            setData(
              (old) =>
                old && { ...old, intake: { ...old.intake, conversation: [...(old.intake.conversation ?? []), turn] } },
            )
          }
        />
      )}
    </div>
  );
}
