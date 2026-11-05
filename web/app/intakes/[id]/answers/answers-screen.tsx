"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import actions from "../../../actions.module.css";
import layout from "../../../layout.module.css";
import LoadingStatus from "../../../loading-status";
import { REASONS } from "../../../not-sure-reason";
import type { Intake, Slot } from "../../../service";
import FollowUpQuestion from "../follow-up-question";
import { useIntake } from "../use-intake";
import styles from "./answers-screen.module.css";

// While a question waits, the intake's own address shows it.
function redirect(intake: Intake, id: string) {
  return intake.step.type === "question" ? `/intakes/${id}` : null;
}

// The screen of the answers (INTAKE-5): every relevant fact with its answer, the open facts first,
// each "not sure" with its reason and its note, and the button that confirms them. At
// ?change=<slot>, the fact's question as its own screen, as a follow-up question is shown; its
// answer is recorded at once, and the list shows again at the fact.
export default function AnswersScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const change = useSearchParams().get("change");
  const { data, setData, message, setMessage } = useIntake(id, redirect);
  const [confirming, startTransition] = useTransition();
  const screen = useRef<HTMLDivElement>(null);

  // Next.js scrolls to the fact in the address before the answers have loaded, so the screen
  // scrolls to it once they show, and when the list shows again after a fact's question. It looks
  // only inside this screen, since a page that Next.js keeps hidden can hold the same ids.
  const shown = data !== null;
  useEffect(() => {
    if (!shown || change !== null || location.hash.length < 2) return;
    screen.current?.querySelector(`#${CSS.escape(decodeURIComponent(location.hash.slice(1)))}`)?.scrollIntoView();
  }, [shown, change]);

  const status = <LoadingStatus message={data === null && message === null ? "Loading the answers." : null} />;

  if (data === null) {
    return (
      <div className={layout.column}>
        {status}
        {message && <p role="alert">{message}</p>}
      </div>
    );
  }

  const { intake, schema } = data;
  const slots = [...schema.slots, ...schema.follow_up_slots];

  // The fact's question under the fact's label as the heading (RESP-6), with the current answer
  // chosen. The list replaces this screen in the history, so that Back then leads to the page
  // before the list.
  const asked = slots.find((slot) => slot.id === change && slot.id in intake.questions);
  if (asked) {
    const value = intake.answers[asked.id];
    const back = `/intakes/${id}/answers#${asked.id}`;
    return (
      <div className={layout.column}>
        {status}
        <p className={styles.back}>
          <Link href={back} replace>
            Back to your answers
          </Link>
        </p>
        <h1>{asked.label}</h1>
        <FollowUpQuestion
          key={asked.id}
          question={intake.questions[asked.id]}
          request={{ url: `/api/intakes/${id}/answers/${asked.id}`, method: "PUT" }}
          button="Save the answer"
          current={value === undefined ? undefined : { value, notSure: intake.not_sure[asked.id] }}
          onSent={(sent: Intake) => {
            setData({ schema, intake: sent });
            router.replace(back);
          }}
        />
      </div>
    );
  }

  function confirm() {
    setMessage(null);
    // Confirm stays disabled until the request fails or the result shows.
    startTransition(async () => {
      try {
        const response = await fetch(`/api/intakes/${id}/confirm`, { method: "POST" });
        if (!response.ok) throw new Error();
        startTransition(() => router.push(`/intakes/${id}`));
      } catch {
        setMessage("The answers could not be confirmed. Try again.");
      }
    });
  }

  // A fact with the schema's label of its answer, the reason and the note of "not sure", and the
  // link to its question. Its id is the anchor that the result links to.
  function fact(slot: Slot, open: boolean) {
    const value = intake.answers[slot.id];
    const entry = intake.not_sure[slot.id];
    return (
      <div key={slot.id} id={slot.id} className={open ? styles.open : undefined}>
        <dt>{slot.label}</dt>
        <dd>
          {value === undefined ? "Not answered yet" : slot.values.find((item) => item.id === value)?.label}
          {entry && (
            <span className={styles.reason}>
              {" · "}
              {REASONS.find((reason) => reason.reason === entry.reason)?.label}
            </span>
          )}
        </dd>
        {entry?.note && <dd className={styles.note}>Note: {entry.note}</dd>}
        <dd className={styles.change}>
          <Link
            href={`/intakes/${id}/answers?change=${slot.id}`}
            aria-label={`${open ? "Answer" : "Change"} ${slot.label}`}
            className={`${actions.button} ${actions.secondary}`}
          >
            {open ? "Answer" : "Change"}
          </Link>
        </dd>
      </div>
    );
  }

  const open = slots.filter((slot) => intake.open_slots.includes(slot.id));
  const answered = slots.filter((slot) => slot.id in intake.answers && !intake.open_slots.includes(slot.id));
  return (
    <div ref={screen} className={layout.column}>
      {status}
      <h1>Check your answers</h1>
      <p className={styles.lead}>
        Change any answer that is wrong, and answer the open ones that you can. The result shows when you confirm.
      </p>
      <details className={styles.description}>
        <summary>Show your description</summary>
        <p className={styles.fixed}>The description cannot change. Start a new intake for another description.</p>
        <dl>
          {schema.description.map((field) => (
            <div key={field.id}>
              <dt>{field.label}</dt>
              <dd>{intake.description[field.id]}</dd>
            </div>
          ))}
        </dl>
      </details>
      {open.length > 0 && (
        <section aria-labelledby="open-answers">
          <h2 id="open-answers">Open answers</h2>
          <p className={styles.count}>
            {open.length === 1
              ? "1 answer is open. Each result that depends on it is conditional."
              : `${open.length} answers are open. Each result that depends on one of them is conditional.`}
          </p>
          <dl className={styles.facts}>{open.map((slot) => fact(slot, true))}</dl>
        </section>
      )}
      <section aria-labelledby="your-answers">
        <h2 id="your-answers">Your answers</h2>
        <dl className={styles.facts}>{answered.map((slot) => fact(slot, false))}</dl>
      </section>
      {message && <p role="alert">{message}</p>}
      <div className={actions.actions}>
        <button type="button" onClick={confirm} disabled={confirming}>
          Confirm and show the result
        </button>
      </div>
    </div>
  );
}
