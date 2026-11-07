import Link from "next/link";
import { Fragment, type MouseEvent, useEffect, useId, useRef, useState } from "react";
import actions from "../../actions.module.css";
import loading from "../../loading-status.module.css";
import { REASONS } from "../../not-sure-reason";
import type { Asked, Cited, Intake, NotSure, Outcome, Regulation, Result, Row, Schema, Texts } from "../../service";
import styles from "./intake-result.module.css";
import MemoExport from "./memo-export";
import {
  type Item,
  type Labels,
  type Placed,
  alsoRows,
  applying,
  onSlot,
  parts,
  pointOf,
  profilingOf,
  quotedAbove,
  said,
  summary,
  titleOf,
} from "./result-parts";
import {
  ALSO_LINE,
  ALWAYS,
  AREAS,
  CATEGORY,
  DAY,
  IF_NO,
  IF_NOT_LISTED,
  LISTED_USE,
  NOT_WRITTEN,
  NOTHING_OPEN,
  PARTS,
  QUOTED_ABOVE,
  STATUS,
  alsoOn,
  answered,
  assumed,
  caseOf,
  counted,
  eachAlsoOn,
  ifListed,
  ifYes,
  needsFact,
  needsResult,
} from "./result-text";

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
type Context = Labels & {
  notSure: Record<string, NotSure>;
  questions: Record<string, Asked>;
  texts: Texts;
  labelOf: (slot: string) => string | undefined;
  valueOf: (slot: string, value: string) => string | undefined;
  onOpen: Open;
  // The address of the screen of the answers, where an open fact has an anchor by its id.
  answers: string;
};

// A status as a label in the color of the status.
function Status({ status }: { status: keyof typeof STATUS }) {
  return <strong className={`${styles.status} ${styles[`badge_${status}`]}`}>{STATUS[status]}</strong>;
}

// The units that define a result, folded behind a line that names them (MEMO-7, MEMO-8). A folded
// quote stays on the page, one click away.
function Definition({ quotes, onOpen }: { quotes: Cited[]; onOpen: Open }) {
  if (quotes.length === 0) return null;
  return (
    <details className={styles.definition}>
      <summary>
        {quotes.length === 1
          ? `Show the article that defines it: ${quotes[0].citation}`
          : `Show the ${quotes.length} articles that define it`}
      </summary>
      {quotes.map((unit) => (
        <Fragment key={unit.citation}>
          <p className={styles.citation}>
            <Links links={[unit]} onOpen={onOpen} />
          </p>
          <blockquote className={styles.quote}>{unit.quote}</blockquote>
        </Fragment>
      ))}
    </details>
  );
}

// What a result that the answers decide says, the answers that decided it, and the units that define
// it, folded (GATE-4).
function ResultHead({ outcome, ctx }: { outcome: Outcome; ctx: Context }) {
  const { labelOf, valueOf, onOpen } = ctx;
  const answers = Object.entries(outcome.answers);
  return (
    <>
      <p>
        <Status status={outcome.status} />
        {answers.length > 0 && ` ${answered(answers.map(([slot, value]) => `${labelOf(slot)}: ${valueOf(slot, value)}`))}`}
      </p>
      <Definition quotes={outcome.quotes} onOpen={onOpen} />
    </>
  );
}

// A row's category as a tag in the category's colour: who carries out its action (MEMO-5).
function Category({ category }: { category: Row["category"] }) {
  return <span className={`${styles.tag} ${styles[`tag_${category}`]}`}>{CATEGORY[category]}</span>;
}

// The date from which a row applies, with the unit that sets it.
function From({ row, ctx }: { row: Row; ctx: Context }) {
  return (
    <>
      From {DAY.format(new Date(row.date))} (<Links links={[row.date_unit]} onOpen={ctx.onOpen} />
      ).
    </>
  );
}

// The action of a row, a placeholder until it is written, or a line that says that it could not be
// written, each after the row's tag; nothing without the key (MEMO-5).
function Action({ row, ctx }: { row: Row; ctx: Context }) {
  if (ctx.texts === null) return null;
  const text = ctx.texts[row.id];
  if (text)
    return (
      <p className={styles.action}>
        <Category category={row.category} /> {text.action}
      </p>
    );
  return text === null ? (
    <p className={`${loading.status} ${styles.writing}`}>
      <Category category={row.category} /> {NOT_WRITTEN}
    </p>
  ) : (
    <p className={`${loading.status} ${styles.writing}`}>
      <Category category={row.category} /> <span className={`${loading.spinner} ${styles.spinner}`} aria-hidden="true" />
      Writing what this means for your product, and an action.
    </p>
  );
}

// What a row shows once it is opened: what its clause means for the product, its clause quoted and
// linked, and what else it needed (MEMO-5, MEMO-7, MEMO-8).
function Details({ row, ctx }: { row: Row; ctx: Context }) {
  const { result, labelOf, valueOf, onOpen } = ctx;
  const text = ctx.texts?.[row.id];
  const needs = row.needs;
  const gate = needs?.gate ? result.gates.find((item) => item.gate === needs.gate) : undefined;
  // A row whose unit its result quotes links it, and the quote shows once, with the result (MEMO-8).
  const above = result.gates.some((outcome) => outcome.rows.includes(row) && quotedAbove(outcome, row));
  return (
    <>
      {text && (
        <p className={styles.meaning}>
          <strong>What it means:</strong> {text.meaning}
        </p>
      )}
      <p className={styles.citation}>
        <Links links={[row.unit]} onOpen={onOpen} />
        {above && QUOTED_ABOVE}
      </p>
      {!above && <blockquote className={styles.quote}>{row.unit.quote}</blockquote>}
      {needs?.slot && (
        <p className={styles.meta}>{needsFact(labelOf(needs.slot), needs.value ? valueOf(needs.slot, needs.value) : undefined)}</p>
      )}
      {gate && <p className={styles.meta}>{needsResult(gate.label, gate.status)}</p>}
    </>
  );
}

// A row: in the first part its label beside its action, with its details behind "Details"; in the
// third part only its label, which opens its action and its details. An opened row has the tint, so
// that its details read as part of it. Under the label: the other items that it depends on.
function Obligation({
  row,
  also,
  folded,
  ctx,
}: {
  row: Row;
  also: string[];
  folded: boolean;
  ctx: Context;
}) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen(!open);
  // The tag stands at the start of the action wherever the action shows; after the label without the
  // key, when the row has no action, and on a folded row of the third part, whose action is hidden.
  const tag = (ctx.texts === null || (folded && !open)) && (
    <>
      {" "}
      <Category category={row.category} />
    </>
  );
  const under = also.length > 0 && <span className={styles.dependsOn}>{alsoOn(also.map((item) => said(item, ctx)))}</span>;
  return (
    <li className={`${styles.row} ${styles[row.status]} ${folded ? "" : styles.todo} ${open ? styles.open : ""}`}>
      {folded ? (
        <button type="button" className={styles.labelButton} aria-expanded={open} onClick={toggle}>
          <span className={styles.rowLabel}>
            {row.label}
            {tag}
          </span>
          {under}
        </button>
      ) : (
        <>
          <div className={styles.head}>
            <p className={styles.rowLabel}>
              {row.label}
              {tag}
            </p>
            {under}
          </div>
          <div className={styles.todoAction}>
            <Action row={row} ctx={ctx} />
          </div>
          <button type="button" className={styles.detailsButton} aria-expanded={open} onClick={toggle}>
            Details
          </button>
        </>
      )}
      {open && (
        <div className={styles.opened}>
          {folded && <Action row={row} ctx={ctx} />}
          <Details row={row} ctx={ctx} />
        </div>
      )}
    </li>
  );
}

// The rows of a result in their order, in runs of adjacent rows of one date: each run's date once above
// its rows, with the condition of that date that the user decides (Article 111(2) or 111(4)) folded
// under it, then the rows (MEMO-5, GATE-5). A date is its day, the article that sets it and its
// condition.
function Rows({ rows, folded, ctx }: { rows: { row: Row; also: string[] }[]; folded: boolean; ctx: Context }) {
  const runOf = (row: Row) => `${row.date} ${row.date_unit.citation} ${row.condition?.citation ?? ""}`;
  const runs: { row: Row; also: string[] }[][] = [];
  for (const entry of rows) {
    const last = runs.at(-1);
    if (last && runOf(last[0].row) === runOf(entry.row)) last.push(entry);
    else runs.push([entry]);
  }
  return (
    <>
      {runs.map((run) => {
        const first = run[0].row;
        const condition = first.condition;
        return (
          <Fragment key={first.id}>
            <p className={styles.dateLine}>
              <From row={first} ctx={ctx} />
            </p>
            {condition && (
              <details className={styles.definition}>
                <summary>{condition.title}</summary>
                <p>{condition.text}</p>
                <p className={styles.citation}>
                  <Links links={[condition]} onOpen={ctx.onOpen} />
                </p>
                <blockquote className={styles.quote}>{condition.quote}</blockquote>
              </details>
            )}
            <ul className={styles.rows}>
              {run.map(({ row, also }) => (
                <Obligation key={row.id} row={row} also={also} folded={folded} ctx={ctx} />
              ))}
            </ul>
          </Fragment>
        );
      })}
    </>
  );
}

// A regulation in the first part: the result that decides whether it applies, or the line that the
// result assumes it, then its results that the answers decide, each with its rows that apply.
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
      <h3 id={`regulation-${regulation.id}-title`}>{regulation.name}</h3>
      {head ? (
        <ResultHead outcome={head} ctx={ctx} />
      ) : (
        regulation.gate === null && (
          <p>
            <strong className={styles.status}>Assumed.</strong> {assumed(regulation.name)}
          </p>
        )
      )}
      {parts.map((outcome) => (
        <section
          key={outcome.gate}
          id={`result-${outcome.gate}`}
          aria-labelledby={`result-${outcome.gate}-title`}
          className={`${styles.result} ${styles[outcome.status]}`}
        >
          <h4 id={`result-${outcome.gate}-title`}>{outcome.label}</h4>
          <ResultHead outcome={outcome} ctx={ctx} />
          <Rows rows={applying(outcome).map((row) => ({ row, also: [] }))} folded={false} ctx={ctx} />
        </section>
      ))}
    </section>
  );
}

// A result that depends on an item, with its regulation, what each answer of the item gives for it,
// and its units folded (VALID-2, MEMO-7, MEMO-8).
function Gives({ outcome, slot, ctx }: { outcome: Outcome; slot: string; ctx: Context }) {
  const condition = outcome.conditions.find((item) => item.slot === slot);
  const regulation = ctx.result.regulations.find((item) => item.id === outcome.regulation);
  return (
    <div className={styles.gives}>
      <p>
        <strong>{outcome.label}</strong>
        {regulation && outcome.label !== regulation.name && ` (${regulation.name})`}
      </p>
      <ul>
        {condition?.cases.map((item) => (
          <li key={item.result}>
            {caseOf(
              item.result === "listed_use" ? AREAS : item.values.map((value) => ctx.valueOf(slot, value)).join(" or "),
              item.result,
            )}
          </li>
        ))}
      </ul>
      <Definition quotes={outcome.quotes} onOpen={ctx.onOpen} />
    </div>
  );
}

// The number of rows that depend on an item, as a link to the group of the third part that holds the
// first of them.
function Count({ item, where }: { item: Item; where: string | undefined }) {
  if (item.rows === 0) return <p className={styles.count}>{counted(0)}</p>;
  const words = counted(item.rows);
  return <p className={styles.count}>{where ? <a href={`#also-${where}`}>{words}</a> : words}.</p>;
}

// An open answer: the text of the last question asked about it, the reason and the note of its "not
// sure" answer, what each answer gives for each result and each row that depends on it, and the link
// to the fact on the screen of the answers (VALID-2, INTAKE-6).
function OpenAnswer({
  item,
  slot,
  placed,
  where,
  ctx,
}: {
  item: Item;
  slot: string;
  placed: Placed[];
  where: string | undefined;
  ctx: Context;
}) {
  const entry = ctx.notSure[slot];
  const { results, needs } = onSlot(ctx.result, placed, slot);
  return (
    <>
      <h3 id={`check-${slot}-title`}>{titleOf(item, ctx)}</h3>
      <p className={styles.question}>{ctx.questions[slot]?.text}</p>
      <p className={styles.reason}>
        {entry ? `Not sure · ${REASONS.find((reason) => reason.reason === entry.reason)?.label}` : "Not answered yet"}
      </p>
      {entry?.note && <p className={styles.note}>Note: {entry.note}</p>}
      {results.map((outcome) => (
        <Gives key={outcome.gate} outcome={outcome} slot={slot} ctx={ctx} />
      ))}
      {needs.map(({ row, outcome }) => (
        <div key={row.id} className={styles.gives}>
          <p>
            <strong>{row.label}</strong> ({outcome.label})
          </p>
          <ul>
            <li>{ifYes(outcome.status)}</li>
            <li>{IF_NO}</li>
          </ul>
        </div>
      ))}
      <Count item={item} where={where} />
      <p className={actions.actions}>
        <Link
          href={`${ctx.answers}#${slot}`}
          aria-label={`Answer ${ctx.labelOf(slot)} on the screen of the answers`}
          className={`${actions.button} ${actions.secondary}`}
        >
          Answer it on the screen of the answers
        </Link>
      </p>
    </>
  );
}

// Whether the intended use of a high-risk result is one of the uses listed under its point of Annex
// III: the point quoted and linked, what the result is for each answer with what Article 6(3) gives,
// the result's other units folded, and no link, since no answer of the intake holds it (GATE-4).
function ListedUse({ item, outcome, where, ctx }: { item: Item; outcome: Outcome; where: string | undefined; ctx: Context }) {
  const point = pointOf(outcome);
  const regulation = ctx.result.regulations.find((entry) => entry.id === outcome.regulation);
  const profiling = profilingOf(outcome);
  return (
    <>
      <h3 id={`check-${item.key}-title`}>{titleOf(item, ctx)}</h3>
      <p className={styles.question}>{LISTED_USE}</p>
      {point && (
        <>
          <p className={styles.citation}>
            <Links links={[point]} onOpen={ctx.onOpen} />
          </p>
          <blockquote className={styles.quote}>{point.quote}</blockquote>
        </>
      )}
      <div className={styles.gives}>
        <p>
          <strong>{outcome.label}</strong>
          {regulation && ` (${regulation.name})`}
        </p>
        <ul>
          <li>{ifListed(profiling && ctx.labelOf(profiling.slot), outcome.derogation)}</li>
          <li>{IF_NOT_LISTED}</li>
        </ul>
        {outcome.derogation === "always" && <p>{ALWAYS}</p>}
        <Definition quotes={outcome.quotes.filter((unit) => unit !== point)} onOpen={ctx.onOpen} />
      </div>
      <Count item={item} where={where} />
    </>
  );
}

// The three parts as links, in the page's side margin where it is wide enough, so that the rows keep
// the page's width, and else in one row above the results: the regulations and the results that the
// answers decide, the items to check, and the results of the third part.
function ResultList({
  list,
  items,
  also,
  ctx,
}: {
  list: ReturnType<typeof parts>["list"];
  items: Item[];
  also: { item: Item; rows: Placed[] }[];
  ctx: Context;
}) {
  // The results of the third part, each once, in the page's order, linked to the first group that
  // holds one of its rows, with its number of rows there.
  const results = [...new Set(also.flatMap(({ rows }) => rows.map((entry) => entry.outcome)))].map((outcome) => ({
    outcome,
    where: also.find(({ rows }) => rows.some((entry) => entry.outcome === outcome))?.item.key,
    count: also.flatMap(({ rows }) => rows).filter((entry) => entry.outcome === outcome).length,
  }));
  return (
    <>
      <nav aria-label="The results" className={styles.side}>
        <ul>
          <li className={styles.partItem}>
            <a href="#applies">{PARTS[0]}</a>
            <ul>
              {list.map(({ regulation, parts }) => (
                <li key={regulation.id} className={styles.regulationItem}>
                  <a href={`#regulation-${regulation.id}`}>{regulation.name}</a>
                  <ul>
                    {parts.map((outcome) => (
                      <li key={outcome.gate}>
                        <span className={`${styles.square} ${styles[`mark_${outcome.status}`]}`} aria-hidden="true" />
                        <a href={`#result-${outcome.gate}`}>{outcome.label}</a>
                        {applying(outcome).length > 0 && <span className={styles.count}>{applying(outcome).length}</span>}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </li>
          {items.length > 0 && (
            <li className={styles.partItem}>
              <a href="#check">{PARTS[1]}</a>
              <ul>
                {items.map((item) => (
                  <li key={item.key}>
                    <span className={`${styles.square} ${styles.mark_conditional}`} aria-hidden="true" />
                    <a href={`#check-${item.key}`}>{titleOf(item, ctx)}</a>
                    {item.rows > 0 && <span className={styles.count}>{item.rows}</span>}
                  </li>
                ))}
              </ul>
            </li>
          )}
          {results.length > 0 && (
            <li className={styles.partItem}>
              <a href="#also">{PARTS[2]}</a>
              <ul>
                {results.map(({ outcome, where, count }) => (
                  <li key={outcome.gate}>
                    <span className={`${styles.square} ${styles.mark_conditional}`} aria-hidden="true" />
                    <a href={`#also-${where}-${outcome.gate}`}>{outcome.label}</a>
                    <span className={styles.count}>{count}</span>
                  </li>
                ))}
              </ul>
            </li>
          )}
          <li className={styles.partItem}>
            <a href="#not-checked">Not checked yet</a>
          </li>
        </ul>
      </nav>
      <nav aria-label="The results, in short" className={styles.short}>
        <span>
          <a href="#applies">{PARTS[0]}</a>
          {list.map(({ regulation, parts }) => (
            <Fragment key={regulation.id}>
              <a href={`#regulation-${regulation.id}`}>{regulation.name}</a>
              {parts.map((outcome) => (
                <a key={outcome.gate} href={`#result-${outcome.gate}`}>
                  {outcome.label}
                  {applying(outcome).length > 0 && ` (${applying(outcome).length})`}
                </a>
              ))}
            </Fragment>
          ))}
        </span>
        {items.length > 0 && (
          <span>
            <a href="#check">{PARTS[1]}</a>
            {items.map((item) => (
              <a key={item.key} href={`#check-${item.key}`}>
                {titleOf(item, ctx)}
                {item.rows > 0 && ` (${item.rows})`}
              </a>
            ))}
          </span>
        )}
        {results.length > 0 && (
          <span>
            <a href="#also">{PARTS[2]}</a>
          </span>
        )}
        <a href="#not-checked">Not checked yet</a>
      </nav>
    </>
  );
}

// The result of the gates in three parts: what the answers decide, the answers to check, and the
// obligations that depend on them (GATE-4, GATE-5, MEMO-5 to MEMO-9).
export default function IntakeResult({
  intake,
  schema,
  answers,
}: {
  intake: Intake & { result: Result };
  schema: Schema;
  answers: string;
}) {
  const { result, not_sure: notSure, questions, open_slots: openSlots, texts } = intake;
  // Whether the choices and the controls of the export show (#53).
  const [exporting, setExporting] = useState(false);
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

  const ctx: Context = {
    result,
    notSure,
    questions,
    texts,
    labelOf: (slot) => slotOf(slot)?.label,
    valueOf,
    onOpen: open,
    answers,
  };
  const rows = result.gates.flatMap((outcome) => outcome.rows);
  const { list, placed, items, also } = parts(result, openSlots, slots);
  const where = (item: Item) => also.find((group) => group.rows.some(({ on }) => on.includes(item.key)))?.item.key;
  return (
    <>
      <h1>Result</h1>
      {(rows.length > 0 || items.length > 0) && <p className={styles.summary}>{summary(rows, items.length)}</p>}
      {/* The way back to the answers, in place of the recorded answers (INTAKE-5). */}
      <p className={actions.actions}>
        <Link href={answers} className={`${actions.button} ${actions.secondary}`}>
          Check or change the answers
        </Link>
        <button
          type="button"
          className={`${actions.button} ${actions.secondary} ${styles.exportButton}`}
          aria-expanded={exporting}
          onClick={() => setExporting(!exporting)}
        >
          Download the result
        </button>
      </p>
      {exporting && (
        <section aria-label="Download the result" className={styles.exportPanel}>
          <MemoExport intake={intake} schema={schema} />
        </section>
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
      {items.length === 0 && (
        <p className={styles.nothing}>{NOTHING_OPEN}</p>
      )}
      <ResultList list={list} items={items} also={also} ctx={ctx} />
      <section id="applies" aria-labelledby="applies-title" className={styles.part}>
        <h2 id="applies-title">{PARTS[0]}</h2>
        {list.map((group) => (
          <RegulationPart key={group.regulation.id} {...group} ctx={ctx} />
        ))}
      </section>
      {items.length > 0 && (
        <section id="check" aria-labelledby="check-title" className={styles.part}>
          <h2 id="check-title">{PARTS[1]}</h2>
          <p>
            The result still depends on these. Check them outside the tool, then answer the open ones on the screen of
            the answers.
          </p>
          {items.map((item) => (
            <section key={item.key} id={`check-${item.key}`} aria-labelledby={`check-${item.key}-title`} className={styles.item}>
              {item.outcome ? (
                <ListedUse item={item} outcome={item.outcome} where={where(item)} ctx={ctx} />
              ) : (
                <OpenAnswer item={item} slot={item.key} placed={placed} where={where(item)} ctx={ctx} />
              )}
            </section>
          ))}
        </section>
      )}
      {also.length > 0 && (
        <section id="also" aria-labelledby="also-title" className={styles.part}>
          <h2 id="also-title">{PARTS[2]}</h2>
          <p>{ALSO_LINE}</p>
          {also.map(({ item, rows: here }) => (
            <section
              key={item.key}
              id={`also-${item.key}`}
              aria-labelledby={`also-${item.key}-title`}
              className={styles.regulation}
            >
              <h3 id={`also-${item.key}-title`}>{titleOf(item, ctx)}</h3>
              {result.gates
                .filter((outcome) => here.some((entry) => entry.outcome === outcome))
                .map((outcome) => {
                  // The other items that every row of the result depends on are named once above them.
                  const { entries, shared } = alsoRows(here, outcome, item);
                  return (
                    <section
                      key={outcome.gate}
                      id={`also-${item.key}-${outcome.gate}`}
                      aria-labelledby={`also-${item.key}-${outcome.gate}-title`}
                      className={`${styles.result} ${styles.conditional}`}
                    >
                      <h4 id={`also-${item.key}-${outcome.gate}-title`}>{outcome.label}</h4>
                      {shared.length > 0 && <p className={styles.alsoLine}>{eachAlsoOn(shared.map((other) => said(other, ctx)))}</p>}
                      <Rows rows={entries} folded ctx={ctx} />
                    </section>
                  );
                })}
            </section>
          ))}
        </section>
      )}
      <section id="not-checked" aria-labelledby="not-checked-title" className={styles.part}>
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
