import { Fragment, type MouseEvent, useEffect, useId, useRef, useState } from "react";
import actions from "../../actions.module.css";
import loading from "../../loading-status.module.css";
import { REASONS } from "../../not-sure-reason";
import type { Cited, NotSure, Outcome, Regulation, Result, Row, Schema, Texts } from "../../service";
import styles from "./intake-result.module.css";
import { LISTED_USE, STATUS } from "./result-text";

// What each answer of a conditional result gives (GATE-2, VALID-2).
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
// A date of the regulations, such as "2 December 2027".
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

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

type Open = (event: MouseEvent<HTMLAnchorElement>, unit: Cited) => void;

function Links({ links, onOpen }: { links: Cited[]; onOpen: Open }) {
  return links.map((unit, index) => (
    <Fragment key={unit.citation}>
      {index > 0 && ", "}
      <a href={unit.link} target="_blank" rel="noreferrer" onClick={(event) => onOpen(event, unit)}>
        {unit.citation}
      </a>
    </Fragment>
  ));
}

// What the parts of the result need besides their own data.
type Context = {
  result: Result;
  notSure: Record<string, NotSure>;
  texts: Texts;
  labelOf: (slot: string) => string | undefined;
  valueOf: (slot: string, value: string) => string | undefined;
  onOpen: Open;
};

// A status as a label in the color of the status.
function Status({ status }: { status: keyof typeof STATUS }) {
  return <strong className={`${styles.status} ${styles[`badge_${status}`]}`}>{STATUS[status]}</strong>;
}

// A unit's citation as its link, and its quote folded under it (MEMO-7, MEMO-8). A folded quote stays
// on the page, one click away.
function Clause({ unit, onOpen }: { unit: Cited; onOpen: Open }) {
  return (
    <div className={styles.clause}>
      <p className={styles.citation}>
        <Links links={[unit]} onOpen={onOpen} />
      </p>
      <details>
        <summary>Show the quoted text</summary>
        <blockquote className={styles.quote}>{unit.quote}</blockquote>
      </details>
    </div>
  );
}

// What a result says, the answers that decided it, each open answer that it depends on with the
// result for each answer, and the units that define it, folded (GATE-4).
function ResultHead({ outcome, ctx }: { outcome: Outcome; ctx: Context }) {
  const { result, notSure, labelOf, valueOf, onOpen } = ctx;
  const answers = Object.entries(outcome.answers);
  return (
    <>
      <p>
        <Status status={outcome.status} />
        {outcome.result === "listed_use" && ` ${LISTED_USE}`}
        {outcome.derogation && ` ${DEROGATION[outcome.derogation]}`}
        {answers.length > 0 &&
          ` ${answers.length === 1 ? "Your answer" : "Your answers"}: ${answers
            .map(([slot, value]) => `${labelOf(slot)}: ${valueOf(slot, value)}`)
            .join("; ")}.`}
      </p>
      {outcome.conditions.map((condition) => {
        const entry = notSure[condition.slot];
        // A slot of another gate: the gate that decides whether a regulation applies is named by the
        // regulation, any other gate by its label.
        const head = result.regulations.find((regulation) => regulation.gate === condition.gate);
        const above = result.gates.find((gate) => gate.gate === condition.gate);
        return (
          <div key={condition.slot} className={styles.condition}>
            <p>
              This depends on the open answer about {labelOf(condition.slot)}
              {condition.gate !== outcome.gate &&
                (head ? `, as for the ${head.name} above` : `, on which ${above?.label} depends`)}
              :{" "}
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
      {outcome.quotes.length > 0 && (
        <details className={styles.definition}>
          <summary>
            {outcome.quotes.length === 1
              ? `Show the article that defines it: ${outcome.quotes[0].citation}`
              : `Show the ${outcome.quotes.length} articles that define it`}
          </summary>
          {outcome.quotes.map((unit) => (
            <Fragment key={unit.citation}>
              <p className={styles.citation}>
                <Links links={[unit]} onOpen={onOpen} />
              </p>
              <blockquote className={styles.quote}>{unit.quote}</blockquote>
            </Fragment>
          ))}
        </details>
      )}
    </>
  );
}

// A row's label, its status, what a conditional row depends on, the date from which it applies with
// the unit that sets it, what else it needed, and its unit (MEMO-5).
function Obligation({ row, outcome, ctx }: { row: Row; outcome: Outcome; ctx: Context }) {
  const { result, labelOf, valueOf, onOpen } = ctx;
  const needs = row.needs;
  const gate = needs?.gate ? result.gates.find((item) => item.gate === needs.gate) : undefined;
  const because = [
    outcome.status === "conditional" && "on the same as the result above",
    needs?.slot && needs.value !== "yes" && `on the open answer about ${labelOf(needs.slot)}`,
    gate?.status === "conditional" && `on what ${gate.label} depends on`,
  ].filter(Boolean);
  return (
    <th scope="row">
      <span className={styles.label}>{row.label}</span>
      <p className={styles.meta}>
        <Status status={row.status} />
        {because.length > 0 && ` Depends ${because.join(", and ")}.`} From {DAY.format(new Date(row.date))} (
        <Links links={[row.date_unit]} onOpen={onOpen} />
        ).
        {needs?.slot &&
          ` Needs ${labelOf(needs.slot)}: ${needs.value ? valueOf(needs.slot, needs.value) : "not asked before the intake ended"}.`}
        {gate && ` Needs ${gate.label}: ${STATUS[gate.status]}`}
      </p>
      <Clause unit={row.unit} onOpen={onOpen} />
    </th>
  );
}

// A row's meaning and action in their columns, a placeholder until they are written, or a line that
// says that they could not be written (MEMO-5).
function Written({ row, texts }: { row: Row; texts: NonNullable<Texts> }) {
  const text = texts[row.id];
  if (text) {
    return (
      <>
        <td data-label="What it means for your product">{text.meaning}</td>
        <td data-label="Action">{text.action}</td>
      </>
    );
  }
  return (
    <td colSpan={2}>
      {text === null ? (
        <p className={`${loading.status} ${styles.writing}`}>
          The meaning and the action of this row could not be written.
        </p>
      ) : (
        <p className={`${loading.status} ${styles.writing}`}>
          <span className={`${loading.spinner} ${styles.spinner}`} aria-hidden="true" />
          Writing what this means for your product, and an action.
        </p>
      )}
    </td>
  );
}

// A result with the condition of its rows' date, quoted once above them (Article 111(2) for high-risk
// under Annex III), and its rows in a table: the obligation, then, with the key, what it means and the
// action.
function ResultPart({ outcome, ctx }: { outcome: Outcome; ctx: Context }) {
  const { texts } = ctx;
  const dated = outcome.rows.find((row) => row.condition);
  return (
    <section
      id={`result-${outcome.gate}`}
      aria-labelledby={`result-${outcome.gate}-title`}
      className={`${styles.result} ${styles[outcome.status]}`}
    >
      <h3 id={`result-${outcome.gate}-title`}>{outcome.label}</h3>
      <ResultHead outcome={outcome} ctx={ctx} />
      {dated?.condition && (
        <div className={styles.condition}>
          <p>
            The rows below apply from {DAY.format(new Date(dated.date))}. For a system placed on the market or put
            into service before that date, they apply only if its design changes significantly from that date. A
            system intended to be used by public authorities must meet them by 2 August 2030 in any case. You decide
            this.
          </p>
          <Clause unit={dated.condition} onOpen={ctx.onOpen} />
        </div>
      )}
      {outcome.rows.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Obligation</th>
              {texts !== null && (
                <>
                  <th scope="col">What it means for your product</th>
                  <th scope="col">Action</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {outcome.rows.map((row) => (
              <tr key={row.id} className={styles[row.status]}>
                <Obligation row={row} outcome={outcome} ctx={ctx} />
                {texts !== null && <Written row={row} texts={texts} />}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// Each regulation with the result that decides whether it applies, and its other results, for the
// regulations that the result holds (MEMO-6).
function groups(result: Result) {
  return result.regulations
    .map((regulation) => ({
      regulation,
      head: result.gates.find((gate) => gate.gate === regulation.gate),
      parts: result.gates.filter((gate) => gate.regulation === regulation.id && gate.gate !== regulation.gate),
    }))
    .filter(({ head, parts }) => head || parts.length > 0);
}

function RegulationPart({
  regulation,
  head,
  parts,
  ctx,
}: {
  regulation: Regulation;
  head: Outcome | undefined;
  parts: Outcome[];
  ctx: Context;
}) {
  return (
    <section
      id={`regulation-${regulation.id}`}
      aria-labelledby={`regulation-${regulation.id}-title`}
      className={styles.regulation}
    >
      <h2 id={`regulation-${regulation.id}-title`}>{regulation.name}</h2>
      {head ? (
        <ResultHead outcome={head} ctx={ctx} />
      ) : (
        regulation.gate === null && (
          <p>
            <strong className={styles.status}>Assumed.</strong> No check decides yet whether the {regulation.name}{" "}
            applies to the product: the result assumes that it does, as said above.
          </p>
        )
      )}
      {parts.map((outcome) => (
        <ResultPart key={outcome.gate} outcome={outcome} ctx={ctx} />
      ))}
    </section>
  );
}

// The results by regulation, as links to their parts: in the page's side margin where it is wide
// enough, so that the tables keep the page's width, and else in one row above the results.
function ResultList({ list }: { list: ReturnType<typeof groups> }) {
  return (
    <>
      <nav aria-label="The results" className={styles.side}>
        <ul>
          {list.map(({ regulation, parts }) => (
            <li key={regulation.id} className={styles.regulationItem}>
              <a href={`#regulation-${regulation.id}`}>{regulation.name}</a>
              <ul>
                {parts.map((outcome) => (
                  <li key={outcome.gate}>
                    <span className={`${styles.square} ${styles[`mark_${outcome.status}`]}`} aria-hidden="true" />
                    <a href={`#result-${outcome.gate}`}>{outcome.label}</a>
                    {outcome.rows.length > 0 && <span className={styles.count}>{outcome.rows.length}</span>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
          <li className={styles.regulationItem}>
            <a href="#not-checked">Not checked yet</a>
          </li>
        </ul>
      </nav>
      <nav aria-label="The results, in short" className={styles.short}>
        {list.map(({ regulation, parts }) => (
          <span key={regulation.id}>
            <a href={`#regulation-${regulation.id}`}>{regulation.name}</a>
            {parts.map((outcome) => (
              <a key={outcome.gate} href={`#result-${outcome.gate}`}>
                {outcome.label}
                {outcome.rows.length > 0 && ` (${outcome.rows.length})`}
              </a>
            ))}
          </span>
        ))}
        <a href="#not-checked">Not checked yet</a>
      </nav>
    </>
  );
}

// The number of rows, of the results that have them, and how many apply or are conditional.
function summary(rows: Row[], results: number) {
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const conditional = rows.filter((row) => row.status === "conditional").length;
  const applies = rows.length - conditional;
  const which =
    conditional === 0
      ? rows.length === 1
        ? "it applies"
        : "all apply"
      : applies === 0
        ? rows.length === 1
          ? "it is conditional"
          : "all are conditional"
        : `${applies} ${applies === 1 ? "applies" : "apply"} and ${conditional} ${conditional === 1 ? "is" : "are"} conditional`;
  return `${count(rows.length, "obligation")} for your product under ${count(results, "result")}: ${which}.`;
}

// The result of the gates, grouped by regulation, with the answers that decided each one, its quotes
// and its rows (GATE-4, GATE-5, MEMO-5 to MEMO-8).
export default function IntakeResult({
  result,
  notSure,
  schema,
  texts,
}: {
  result: Result;
  notSure: Record<string, NotSure>;
  schema: Schema;
  texts: Texts;
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

  const ctx: Context = { result, notSure, texts, labelOf: (slot) => slotOf(slot)?.label, valueOf, onOpen: open };
  const rows = result.gates.flatMap((outcome) => outcome.rows);
  const list = groups(result);
  return (
    <>
      <h1>Result</h1>
      {rows.length > 0 && (
        <p className={styles.summary}>
          {summary(rows, result.gates.filter((outcome) => outcome.rows.length > 0).length)}
        </p>
      )}
      <p className={styles.assumes}>
        This result assumes:{" "}
        {result.assumptions.map((item, index) => (
          <Fragment key={item.text}>
            {index > 0 && " "}
            {item.text} (<Links links={item.links} onOpen={open} />)
          </Fragment>
        ))}
      </p>
      <ResultList list={list} />
      {list.map((group) => (
        <RegulationPart key={group.regulation.id} {...group} ctx={ctx} />
      ))}
      <section id="not-checked" aria-labelledby="not-checked-title">
        <h2 id="not-checked-title">Not checked yet</h2>
        <ul>
          {result.not_checked.map((item) => (
            <li key={item.text}>
              {item.text}: <Links links={item.links} onOpen={open} />
            </li>
          ))}
        </ul>
      </section>
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
              className={actions.button}
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
