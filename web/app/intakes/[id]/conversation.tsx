import { Fragment, useEffect, useId, useRef, useState } from "react";
import actions from "../../actions.module.css";
import LoadingStatus from "../../loading-status";
import { NOT_LEGAL_ADVICE } from "../../not-legal-advice";
import type { Example, Intake, Planned, Scenario, Segment, State, Turn, WhatIf } from "../../service";
import styles from "./conversation.module.css";
import { Entries } from "./guidance-examples";
import examples from "./guidance-examples.module.css";
import { Category, Links, type Open } from "./intake-result";
import result from "./intake-result.module.css";
import { CASE, NO_LONGER_APPLY, STATE, STATUS_WOULD_CHANGE, many } from "./result-text";

const ASKING = "Reading your result and the regulations. This takes a few seconds.";
const WHAT_IF = "What if…?";
const HINT = "Planning a change to your product? Ask what it would do to your answers and obligations.";
// The browser keeps that the user opened the panel or closed the hint, so that the hint shows once.
const HINT_SEEN = "hint:what-if";

function hintSeen() {
  try {
    return localStorage.getItem(HINT_SEEN) !== null;
  } catch {
    return false;
  }
}

function rememberHint() {
  try {
    localStorage.setItem(HINT_SEEN, "1");
  } catch {
    // The hint shows again on the next view.
  }
}

// The icon of a button that closes: a cross, also in the head of the result's dialogs (#62).
export function Cross() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// The button's icon: one path that forks in two, a change and what it would give.
function Fork() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="5" r="2" />
      <circle cx="12" cy="19" r="2" />
      <path d="M6 7v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 12v5" />
    </svg>
  );
}

type Block = Turn["blocks"][number];

// What changed answers would change, in a few words, one part for each kind of change; none when
// nothing changes.
function parts(change: WhatIf) {
  return [
    change.results.length > 0 && `changes ${many(change.results.length, "result")}`,
    change.rows_added.length > 0 && `adds ${many(change.rows_added.length, "obligation")}`,
    change.rows_removed.length > 0 && `removes ${many(change.rows_removed.length, "obligation")}`,
    change.rows_changed.length > 0 && `changes the status of ${many(change.rows_changed.length, "obligation")}`,
    change.now_open.length > 0 && `opens ${many(change.now_open.length, "question")}`,
    change.no_longer_asked.length > 0 && `removes ${many(change.no_longer_asked.length, "question")}`,
  ].filter(Boolean);
}

// The line of a fold under an open answer (QA-1).
export function changed(change: WhatIf) {
  return parts(change).join(", ") || "changes nothing";
}

// The label of a planned change beside each of its rows, so that they read apart from the result's
// own rows, also in a view of one category (#63).
export function PlannedTag({ label }: { label: string }) {
  return (
    <>
      {" "}
      <span className={result.plannedTag}>Planned: {label}</span>
    </>
  );
}

function StateOf({ state }: { state: State | null }) {
  if (state === null) return <strong>Not in the result</strong>;
  return <strong className={`${result.status} ${result[`badge_${state.status}`]}`}>{STATE[state.status]}</strong>;
}

// The obligations that changed answers would add or remove, by result, each with its category, its
// citation linked to EUR-Lex through the dialog (MEMO-7) and the date from which it applies; in a
// planned change, each with the change's label (#63).
export function Obligations({
  title,
  rows,
  onOpen,
  planned,
}: {
  title: string;
  rows: WhatIf["rows_added"];
  onOpen: Open;
  planned?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <>
      <p className={styles.changesTitle}>{title}</p>
      {[...new Set(rows.map((row) => row.result))].map((name) => (
        <div key={name} className={styles.group}>
          <p className={styles.groupName}>{name}</p>
          <ul className={styles.obligations}>
            {rows
              .filter((row) => row.result === name)
              .map((row) => (
                <li key={row.id}>
                  <Category category={row.category} /> {row.label}
                  {planned && <PlannedTag label={planned} />}
                  <span className={result.meta}>
                    {" "}
                    <Links links={[{ citation: row.citation, link: row.link, quote: null }]} onOpen={onOpen} />, from {row.date}
                    {row.status === "conditional" && ", conditional"}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </>
  );
}

// The obligations whose status changed answers would change, each with its status now and then and
// its citation linked to EUR-Lex through the dialog (MEMO-7); in a planned change, each with the
// change's label (#63).
export function ChangedRows({ rows, onOpen, planned }: { rows: WhatIf["rows_changed"]; onOpen: Open; planned?: string }) {
  if (rows.length === 0) return null;
  return (
    <>
      <p className={styles.changesTitle}>{STATUS_WOULD_CHANGE}</p>
      <ul className={styles.obligations}>
        {rows.map((row) => (
          <li key={row.id}>
            {row.label}: {STATE[row.before]} to {STATE[row.status]}
            <span className={result.meta}>
              {" "}
              ({row.result}, <Links links={[{ citation: row.citation, link: row.link, quote: null }]} onOpen={onOpen} />)
            </span>
            {planned && <PlannedTag label={planned} />}
          </li>
        ))}
      </ul>
    </>
  );
}

// What changed answers would change in the whole result, as the rules in code compute it with no
// model: the obligations that would be added, removed or change their status, the results whose
// status would change, and the questions that would become open or no longer be asked (QA-1, QA-4).
export function Changes({ change, onOpen }: { change: WhatIf; onOpen: Open }) {
  return (
    <div className={styles.changes}>
      {parts(change).length === 0 && <p className={styles.quiet}>Nothing in the result would change.</p>}
      <Obligations title="Obligations this would add" rows={change.rows_added} onOpen={onOpen} />
      <Obligations title={NO_LONGER_APPLY} rows={change.rows_removed} onOpen={onOpen} />
      <ChangedRows rows={change.rows_changed} onOpen={onOpen} />
      {change.results.length > 0 && (
        <>
          <p className={styles.changesTitle}>Results that would change</p>
          <ul className={styles.obligations}>
            {change.results.map((item) => (
              <li key={item.result}>
                <strong>{item.result}</strong>
                {item.regulation !== item.result && ` (${item.regulation})`}:{" "}
                {item.before?.status === item.after?.status ? (
                  <>
                    stays <StateOf state={item.after} />
                  </>
                ) : (
                  <>
                    <StateOf state={item.before} /> to <StateOf state={item.after} />
                  </>
                )}
                {/* A listed use whose outcome under Article 6(3) changes, as the result says it (GATE-4). */}
                {item.after?.article_6_3 && item.after.article_6_3 !== item.before?.article_6_3 && (
                  <span className={result.meta}> Then {CASE[item.after.article_6_3]}.</span>
                )}
                {item.after && item.after.open.length > 0 && (
                  <span className={result.meta}> Still depends on {item.after.open.join(", ")}.</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {change.now_open.length > 0 && (
        <p className={styles.quiet}>Questions that would become open: {change.now_open.join(", ")}.</p>
      )}
      {change.no_longer_asked.length > 0 && (
        <p className={styles.quiet}>Questions that would no longer be asked: {change.no_longer_asked.join(", ")}.</p>
      )}
    </div>
  );
}

function Text({ segments, onOpen }: { segments: Segment[]; onOpen: Open }) {
  return segments.map((segment, index) =>
    segment.link ? (
      <a
        key={index}
        href={segment.link}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => onOpen(event, { citation: segment.text, link: segment.link ?? "", quote: null })}
      >
        {segment.text}
      </a>
    ) : (
      <Fragment key={index}>{segment.text}</Fragment>
    ),
  );
}

function Blocks({ blocks, onOpen }: { blocks: Block[]; onOpen: Open }) {
  return blocks.map((block, index) => {
    if (block.kind === "paragraph") {
      return (
        <p key={index}>
          <Text segments={block.segments} onOpen={onOpen} />
        </p>
      );
    }
    const items = block.items.map((item, at) => (
      <li key={at}>
        <Text segments={item} onOpen={onOpen} />
      </li>
    ));
    return block.ordered ? (
      <ol key={index} start={block.start}>
        {items}
      </ol>
    ) : (
      <ul key={index}>{items}</ul>
    );
  });
}

// Entries from official guidance, folded behind a line with their number, so that the answer stays
// short (RESP-5).
function Examples({ entries }: { entries: Example[] }) {
  return (
    <details className={`${result.definition} ${styles.examples}`}>
      <summary>{many(entries.length, "example")} from official guidance (not law)</summary>
      <div className={examples.group}>
        <Entries entries={entries} />
      </div>
    </details>
  );
}

// The line above the answer to a change: the answers that it may change and the obligations that the
// rules would then add or remove.
function summary(scenario: Scenario) {
  const { rows_added: added, rows_removed: removed } = scenario.changes;
  const line = [`may change ${scenario.questions.length} of your answers`];
  if (added.length > 0) line.push(`add ${many(added.length, "obligation")}`);
  if (removed.length > 0) line.push(`remove ${many(removed.length, "obligation")}`);
  return `This change ${line.join(", ")}.`;
}

// The answer to one question: for a change, the line with its numbers, then its text, each answer
// that it may change with its question and its examples, and what the rules would then change; then
// the quotes and the other examples (QA-4 to QA-6, QA-9).
function Answer({
  turn,
  onOpen,
  planned,
  onAdd,
}: {
  turn: Turn;
  onOpen: Open;
  // The planned change of this question, once it is added (#63).
  planned: Planned | undefined;
  onAdd: (facts: string[]) => Promise<void>;
}) {
  const [ticked, setTicked] = useState<string[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!turn.answered) return <p className={styles.failed}>This question could not be answered. Ask it again.</p>;
  const scenario = turn.scenario !== null && turn.scenario.questions.length > 0 ? turn.scenario : null;
  // Every answer that the change may change is ticked until the user unticks it; once the change is
  // added, the answers that it holds, also one that can no longer be applied.
  const held = planned && [
    ...planned.changes.changed.map((item) => item.fact_id),
    ...planned.changes.refused.map((item) => item.fact),
  ];
  const chosen = held ?? ticked ?? scenario?.questions.map((question) => question.fact_id) ?? [];
  async function add() {
    setAdding(true);
    setFailed(false);
    try {
      await onAdd(chosen);
    } catch {
      setFailed(true);
    } finally {
      setAdding(false);
    }
  }
  // An entry that the answer names for an answer that may change shows under that answer.
  const placed = new Set(scenario?.questions.flatMap((question) => question.guidance.map((entry) => entry.id)));
  const others = turn.guidance.filter((entry) => !placed.has(entry.id));
  return (
    <>
      {turn.for_earlier_answers && <p className={styles.earlier}>Answered for your earlier answers.</p>}
      {scenario && <p className={styles.strong}>{summary(scenario)}</p>}
      <Blocks blocks={turn.blocks} onOpen={onOpen} />
      {scenario && (
        <div className={styles.scenario}>
          <p className={styles.changesTitle}>Answers this change may change</p>
          {scenario.questions.map((question) => (
            <div key={question.fact_id} className={styles.question}>
              <label className={styles.tick}>
                <input
                  type="checkbox"
                  checked={chosen.includes(question.fact_id)}
                  disabled={planned !== undefined || adding}
                  onChange={(event) =>
                    setTicked(
                      event.target.checked
                        ? [...chosen, question.fact_id]
                        : chosen.filter((fact) => fact !== question.fact_id),
                    )
                  }
                />
                <span>
                  <strong>{question.fact}</strong>: now {question.now}, may become {question.to}
                </span>
              </label>
              <p className={styles.questionText}>{question.question}</p>
              {question.guidance.length > 0 && <Examples entries={question.guidance} />}
            </div>
          ))}
          <Changes change={scenario.changes} onOpen={onOpen} />
          {/* The change goes into the result as a planned change, with the ticked answers; the recorded
              answers stay as they are (#63). */}
          <div className={`${actions.actions} ${styles.add}`}>
            {planned ? (
              <p className={styles.added}>
                Added to the result as <a href={`#planned-${planned.turn}`}>{planned.label}</a>.
              </p>
            ) : (
              <>
                <button type="button" className={actions.secondary} disabled={adding || chosen.length === 0} onClick={() => void add()}>
                  Add to the result as “{turn.label}”
                </button>
                <LoadingStatus message={adding ? "Adding the change to the result." : null} />
              </>
            )}
          </div>
          {failed && <p role="alert">The change could not be added. Try again.</p>}
        </div>
      )}
      {turn.quotes.map((quote) => (
        <Fragment key={quote.text}>
          <p className={result.citation}>
            <a
              href={quote.link}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => onOpen(event, { citation: quote.citation, link: quote.link, quote: quote.text })}
            >
              {quote.citation}
            </a>
          </p>
          <blockquote className={result.quote}>{quote.text}</blockquote>
        </Fragment>
      ))}
      {others.length > 0 && <Examples entries={others} />}
    </>
  );
}

// The panel beside the result, a fallback to the form (QA-2): a button at the bottom right of the
// screen, with a hint above it on the first view, opens it over the result, with the questions and
// their answers in order, the line on legal advice, and the field, which stays at the bottom, as in a
// chat widget. A question that could not be answered stays in the field. On a narrow screen the
// button shows only its icon, and the panel covers the whole screen.
export default function Conversation({
  intake,
  onOpen,
  onTurn,
  onIntake,
}: {
  intake: Intake & { conversation: Turn[] };
  onOpen: Open;
  // A new turn, which the screen adds to the intake as it is when the answer arrives.
  onTurn: (turn: Turn) => void;
  // The intake with a planned change added (#63).
  onIntake: (intake: Intake) => void;
}) {
  const turns = intake.conversation;
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(() => !hintSeen());
  const [text, setText] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = useId();
  // Opening the panel moves the focus to its field, and closing it moves the focus back to the button.
  const field = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) field.current?.focus();
    else if (wasOpen.current) opener.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // The conversation scrolls between the panel's head and its field. A new answer, and the panel
  // when it opens, show the last question at the top.
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const last = body.current?.querySelector("ol > li:last-child");
    if (last instanceof HTMLElement && body.current) body.current.scrollTop = last.offsetTop - body.current.offsetTop;
  }, [turns.length, open]);

  async function ask() {
    const question = text.trim();
    if (!question || asking) return;
    setAsking(true);
    setError(null);
    try {
      const response = await fetch(`/api/intakes/${intake.id}/questions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: question }),
      });
      if (response.status === 409) {
        const { error: refused } = (await response.json()) as { error: { code: string } };
        if (refused.code === "limit_reached") {
          setError("This intake has reached its limit of questions.");
          return;
        }
      }
      if (!response.ok) throw new Error(String(response.status));
      const { turn } = (await response.json()) as { turn: Turn };
      onTurn(turn);
      if (turn.answered) setText("");
    } catch {
      setError("The question could not be sent. Ask it again.");
    } finally {
      setAsking(false);
    }
  }

  function show() {
    setOpen(true);
    setHint(false);
    rememberHint();
  }

  if (!open) {
    return (
      <div className={styles.launcher}>
        {hint && (
          <div className={styles.hint}>
            <div className={styles.head}>
              <p>{HINT}</p>
              <button
                type="button"
                className={styles.close}
                aria-label="Close the hint"
                onClick={() => {
                  setHint(false);
                  rememberHint();
                }}
              >
                <Cross />
              </button>
            </div>
            <button type="button" onClick={show}>
              Try it
            </button>
          </div>
        )}
        <button
          ref={opener}
          type="button"
          className={styles.opener}
          aria-label={turns.length > 0 ? `${WHAT_IF} ${many(turns.length, "question")}` : WHAT_IF}
          onClick={show}
        >
          <Fork />
          <span className={styles.label}>{WHAT_IF}</span>
          {turns.length > 0 && <span className={styles.count}>{turns.length}</span>}
        </button>
      </div>
    );
  }
  return (
    <aside aria-labelledby={title} className={styles.panel}>
      <div className={`${styles.head} ${styles.panelHead}`}>
        <div>
          <h2 id={title}>{WHAT_IF}</h2>
          <p className={result.meta}>Check what a change to your product would do.</p>
        </div>
        <button type="button" className={styles.close} aria-label="Close" onClick={() => setOpen(false)}>
          <Cross />
        </button>
      </div>
      <div className={styles.panelBody} ref={body}>
        <p className={result.meta}>
          Describe a change to your product, such as a new feature, to see which of your answers it may change and what
          the rules would then add. You can also ask about an article or a result. Your answers stay as they are: you
          change them on the screen of the answers.
        </p>
        {turns.length > 0 && (
          <ol className={styles.turns}>
            {turns.map((turn, index) => (
              <li key={index} className={styles.turn}>
                <div className={styles.asked}>
                  <p className={styles.askedLabel}>You asked</p>
                  <p>{turn.question}</p>
                </div>
                <div className={styles.answer}>
                  <Answer
                    turn={turn}
                    onOpen={onOpen}
                    planned={intake.planned?.find((item) => item.turn === index + 1)}
                    onAdd={async (facts) => {
                      const response = await fetch(`/api/intakes/${intake.id}/planned`, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ turn: index + 1, facts }),
                      });
                      if (!response.ok) throw new Error(String(response.status));
                      onIntake((await response.json()) as Intake);
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className={styles.panelFoot}>
        <p className={`${result.meta} ${styles.line}`}>{NOT_LEGAL_ADVICE}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void ask();
          }}
        >
          <textarea
            ref={field}
            aria-label="Your question"
            className={styles.input}
            value={text}
            maxLength={500}
            rows={2}
            placeholder="What if we add a feature that ..."
            onChange={(event) => setText(event.target.value)}
            // Enter sends the question, and Shift and Enter start a new line.
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask();
              }
            }}
            disabled={asking}
          />
          <div className={actions.actions}>
            <button type="submit" disabled={asking || !text.trim()}>
              Ask
            </button>
            <LoadingStatus message={asking ? ASKING : null} />
          </div>
          {error && <p role="alert">{error}</p>}
        </form>
      </div>
    </aside>
  );
}
