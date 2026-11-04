import { Fragment, type MouseEvent, useEffect, useId, useRef, useState } from "react";
import actions from "../../actions.module.css";
import { REASONS } from "../../not-sure-reason";
import type { Cited, NotSure, Result, Schema } from "../../service";
import styles from "./intake-result.module.css";

// What a result says, and what each answer of a conditional result gives (GATE-2, VALID-2).
const STATUS = { applies: "Applies.", does_not_apply: "Does not apply.", conditional: "Conditional." };
const CASE: Record<string, string> = {
  applies: "applies",
  does_not_apply: "does not apply",
  conditional: "depends on the other open answer",
  listed_use: "high-risk if the product's intended use is one of the uses listed under that point",
  always: "a listed use is always high-risk",
  unless: "a listed use is high-risk unless one of the conditions of Article 6(3) applies",
};
const DEROGATION = {
  always:
    "Under Article 6(3), a use listed in Annex III is always high-risk when the product performs profiling.",
  unless:
    "Under Article 6(3), a use listed in Annex III is high-risk unless one of the conditions of that paragraph applies.",
};

// On a first visit, EUR-Lex checks the browser and loads the page again, which loses the place that
// a link opens. It lets the browser through for about five minutes, then checks it again. The
// session keeps the time when a link to a website was last opened from the dialog that says so, and
// a link opens the dialog unless that time is less than five minutes ago. Session storage can be
// blocked: then every link opens the dialog first.
const CHECKED_FOR = 5 * 60 * 1000;

function key(link: string) {
  return `checked:${new URL(link).host}`;
}

function checked(link: string) {
  try {
    return Date.now() - Number(sessionStorage.getItem(key(link))) < CHECKED_FOR;
  } catch {
    return false;
  }
}

function remember(link: string) {
  try {
    sessionStorage.setItem(key(link), String(Date.now()));
  } catch {
    // The next link opens the dialog again.
  }
}

function Links({
  links,
  onOpen,
}: {
  links: Cited[];
  onOpen: (event: MouseEvent<HTMLAnchorElement>, unit: Cited) => void;
}) {
  return links.map((unit, index) => (
    <Fragment key={unit.citation}>
      {index > 0 && ", "}
      <a href={unit.link} target="_blank" rel="noreferrer" onClick={(event) => onOpen(event, unit)}>
        {unit.citation}
      </a>
    </Fragment>
  ));
}

// The result of the gates, with the answers that decided each one and its quotes (GATE-4, MEMO-6
// to MEMO-8).
export default function IntakeResult({
  result,
  notSure,
  schema,
}: {
  result: Result;
  notSure: Record<string, NotSure>;
  schema: Schema;
}) {
  const slots = [...schema.slots, ...schema.follow_up_slots];
  const slotOf = (id: string) => slots.find((slot) => slot.id === id);
  const valueOf = (slot: string, value: string) =>
    slotOf(slot)?.values.find((item) => item.id === value)?.label;
  // The link that the dialog about a first visit opens, while it is shown (MEMO-7).
  const [opening, setOpening] = useState<Cited | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();

  useEffect(() => {
    if (opening !== null) dialog.current?.showModal();
  }, [opening]);

  function open(event: MouseEvent<HTMLAnchorElement>, unit: Cited) {
    if (checked(unit.link)) return;
    event.preventDefault();
    setOpening(unit);
  }

  return (
    <>
      <h1>Result</h1>
      <p>This result assumes:</p>
      <ul>
        {result.assumptions.map((item) => (
          <li key={item.text}>
            {item.text} <Links links={item.links} onOpen={open} />
          </li>
        ))}
      </ul>
      {result.gates.map((outcome) => (
        <div key={outcome.gate} className={`${styles.gate} ${styles[outcome.status]}`}>
          <h2>{outcome.label}</h2>
          <p>
            <strong className={styles.status}>{STATUS[outcome.status]}</strong>
            {outcome.result === "listed_use" &&
              " High-risk if the product's intended use is one of the uses listed under the point of Annex III quoted below. You decide this."}
            {outcome.derogation && ` ${DEROGATION[outcome.derogation]}`}
          </p>
          <dl>
            {Object.entries(outcome.answers).map(([slot, value]) => (
              <div key={slot}>
                <dt>{slotOf(slot)?.label}</dt>
                <dd>{valueOf(slot, value)}</dd>
              </div>
            ))}
          </dl>
          {outcome.conditions.map((condition) => {
            const entry = notSure[condition.slot];
            const above = result.gates.find((gate) => gate.gate === condition.gate);
            return (
              <div key={condition.slot} className={styles.condition}>
                <p>
                  This depends on the open answer about {slotOf(condition.slot)?.label}
                  {condition.gate !== outcome.gate && `, on which ${above?.label} depends`}:{" "}
                  {entry
                    ? `${REASONS.find((reason) => reason.reason === entry.reason)?.label}.`
                    : "not asked before the intake ended."}
                  {entry?.note && ` Note: ${entry.note}`}
                </p>
                <ul>
                  {condition.cases.map((item) => (
                    <li key={item.result}>
                      If{" "}
                      {item.result === "listed_use"
                        ? "one of the areas of Annex III quoted below"
                        : item.values.map((value) => valueOf(condition.slot, value)).join(" or ")}
                      : {CASE[item.result]}.
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {outcome.quotes.map((unit) => (
            <Fragment key={unit.citation}>
              <p className={styles.citation}>
                <Links links={[unit]} onOpen={open} />
              </p>
              <blockquote className={styles.quote}>{unit.quote}</blockquote>
            </Fragment>
          ))}
        </div>
      ))}
      <h2>Not checked yet</h2>
      <ul>
        {result.not_checked.map((item) => (
          <li key={item.text}>
            {item.text}: <Links links={item.links} onOpen={open} />
          </li>
        ))}
      </ul>
      <dialog ref={dialog} aria-labelledby={title} onClose={() => setOpening(null)} className={styles.dialog}>
        <h2 id={title}>Opening EUR-Lex</h2>
        <p>
          EUR-Lex checks the browser on a first visit, and again after some minutes. The page then opens
          at the top, not at the article. Answer the cookie notice if it shows, come back to this page and
          open the link again: it then opens at the article.
        </p>
        <div className={actions.actions}>
          {opening && (
            <a
              href={opening.link}
              target="_blank"
              rel="noreferrer"
              className={styles.open}
              onClick={() => {
                remember(opening.link);
                dialog.current?.close();
              }}
            >
              Open EUR-Lex
            </a>
          )}
          <button type="button" className={styles.cancel} onClick={() => dialog.current?.close()}>
            Cancel
          </button>
        </div>
      </dialog>
    </>
  );
}
