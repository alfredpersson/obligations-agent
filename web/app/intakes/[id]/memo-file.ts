import { NOT_LEGAL_ADVICE } from "../../not-legal-advice";
import { REASONS } from "../../not-sure-reason";
import type { Cited, Intake, Outcome, Result, Row, Schema } from "../../service";
import {
  type Item,
  alsoRows,
  applying,
  ofCategory,
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

// The file of the export (#53): the memo as blocks, which the Markdown and the PDF both draw, so that
// the two files hold the same texts. It is built from the intake and the sentences of the result
// screen; the parts of the screen that work only in the tool (the way to the answers, the links to
// the screen of the answers, the dialog before EUR-Lex, the list of the results) stay out.

// A text in a line: plain, a link, or strong.
export type Span = string | { text: string; link: string } | { strong: string };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5; text: string }
  | { kind: "line"; spans: Span[] }
  | { kind: "quote"; text: string }
  | { kind: "list"; items: Span[][] };

export type Category = keyof typeof CATEGORY;

// The user's choices: the rows of one category or all, the quotes or only the links, the meanings or
// only the actions.
export type Choices = { category: Category | null; quotes: boolean; meanings: boolean };

export const TITLE = "Obligations memo";

// The official texts that the units link to, named as in docs/regulations/README.md, by the CELEX
// number in their links.
const TEXTS: [string, string][] = [
  ["32016R0679", "Regulation (EU) 2016/679 (General Data Protection Regulation), CELEX 32016R0679, as published in the Official Journal"],
  ["32024R1689", "Regulation (EU) 2024/1689 (Artificial Intelligence Act), CELEX 32024R1689, as published in the Official Journal"],
  ["32026R1744", "Regulation (EU) 2026/1744 (Digital Omnibus on AI), CELEX 32026R1744, as published in the Official Journal"],
  ["02024R1689-20260727", "The AI Act as amended by Regulation (EU) 2026/1744, in the consolidated text of 27 July 2026 (CELEX 02024R1689-20260727)"],
];

const EURLEX =
  "On a first visit, and again after some minutes, EUR-Lex checks the browser and then opens the page at the top, not at the article. Answer the cookie notice if it shows, then open the link again: it then opens at the article.";

// The day on which the file is made, in the user's time zone.
const TODAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

const line = (...spans: Span[]): Block => ({ kind: "line", spans });
const heading = (level: 1 | 2 | 3 | 4 | 5, text: string): Block => ({ kind: "heading", level, text });
const link = (unit: Cited): Span => ({ text: unit.citation, link: unit.link });

// Units as links in a sentence, such as "AI Act Article 6(2), AI Act Article 6(3)".
function links(units: Cited[]) {
  return units.flatMap((unit, index) => (index > 0 ? [", ", link(unit)] : [link(unit)]));
}

// A unit with its quote, or only its link.
function unit(cited: Cited, choices: Choices): Block[] {
  return choices.quotes && cited.quote ? [line(link(cited)), { kind: "quote", text: cited.quote }] : [line(link(cited))];
}

// The units that define a result (MEMO-7, MEMO-8).
function definition(quotes: Cited[], choices: Choices): Block[] {
  if (quotes.length === 0) return [];
  const lead = quotes.length === 1 ? "The article that defines it:" : "The articles that define it:";
  return choices.quotes ? [line(lead), ...quotes.flatMap((item) => unit(item, choices))] : [line(`${lead} `, ...links(quotes), ".")];
}

// The file name, with the day and the category, such as "obligations-memo-2026-11-06-legal.md".
export function fileName(made: Date, choices: Choices, extension: "md" | "pdf") {
  const day = [made.getFullYear(), made.getMonth() + 1, made.getDate()].map((part) => String(part).padStart(2, "0"));
  return `obligations-memo-${day.join("-")}${choices.category ? `-${choices.category}` : ""}.${extension}`;
}

// The memo as blocks: the title and the day, the description and the answers, the three parts of
// the result as the screen shows them, "What the tool does not check yet", and the line on legal
// advice with the official texts and the note on EUR-Lex.
export function memo(intake: Intake & { result: Result }, schema: Schema, choices: Choices, made: Date): Block[] {
  const result = intake.result;
  const slots = [...schema.slots, ...schema.follow_up_slots];
  const slotOf = (id: string) => slots.find((slot) => slot.id === id);
  const labelOf = (id: string) => slotOf(id)?.label;
  const valueOf = (id: string, value: string) => slotOf(id)?.values.find((item) => item.id === value)?.label;
  const ctx = { result, labelOf };
  const { list, placed, items, also } = parts(result, intake.open_slots, slots);
  const texts = intake.texts;
  const kept = ofCategory(choices.category);

  // A result's status and the answers that decided it, then its units.
  function head(outcome: Outcome): Block[] {
    const answers = Object.entries(outcome.answers).map(([slot, value]) => `${labelOf(slot)}: ${valueOf(slot, value)}`);
    return [
      line({ strong: STATUS[outcome.status] }, ...(answers.length > 0 ? [` ${answered(answers)}`] : [])),
      ...definition(outcome.quotes, choices),
    ];
  }

  // One section for each row, which can be pasted as one ticket: its label as its heading, its
  // result, category, clause, date and status, what it depends on or needs, then the quote, the
  // meaning and the action (MEMO-5).
  function section(outcome: Outcome, row: Row, on: string[]): Block[] {
    const regulation = result.regulations.find((item) => item.id === outcome.regulation);
    const needs = row.needs;
    const gate = needs?.gate ? result.gates.find((item) => item.gate === needs.gate) : undefined;
    const text = texts?.[row.id];
    // The file quotes the row's unit with the result above when its result quotes it (MEMO-8).
    const above = choices.quotes && quotedAbove(outcome, row);
    return [
      heading(5, row.label),
      {
        kind: "list",
        items: [
          [`Result: ${outcome.label}${regulation && outcome.label !== regulation.name ? ` (${regulation.name})` : ""}`],
          [`Category: ${CATEGORY[row.category]}`],
          ["Clause: ", link(row.unit), ...(above ? [QUOTED_ABOVE] : [])],
          [`From ${DAY.format(new Date(row.date))} (`, link(row.date_unit), ")."],
          ...(row.condition ? [[`${row.condition.title}: ${row.condition.text} (`, link(row.condition), ")."]] : []),
          [`Status: ${STATUS[row.status]}`],
          ...(on.length > 0 ? [[`Depends on ${on.map((item) => said(item, ctx)).join(", and on ")}.`]] : []),
          ...(needs?.slot ? [[needsFact(labelOf(needs.slot), needs.value ? valueOf(needs.slot, needs.value) : undefined)]] : []),
          ...(gate ? [[needsResult(gate.label, gate.status)]] : []),
        ],
      },
      ...(choices.quotes && row.unit.quote && !above ? [{ kind: "quote" as const, text: row.unit.quote }] : []),
      ...(text && choices.meanings ? [line({ strong: "What it means:" }, ` ${text.meaning}`)] : []),
      ...(text ? [line({ strong: "Action:" }, ` ${text.action}`)] : []),
      ...(text === null ? [line(NOT_WRITTEN)] : []),
    ];
  }

  // A result that depends on an open item: what each answer gives, and its units.
  function gives(outcome: Outcome, slot: string): Block[] {
    const condition = outcome.conditions.find((item) => item.slot === slot);
    const regulation = result.regulations.find((item) => item.id === outcome.regulation);
    return [
      line({ strong: outcome.label }, regulation && outcome.label !== regulation.name ? ` (${regulation.name})` : ""),
      {
        kind: "list",
        items: (condition?.cases ?? []).map((item) => [
          caseOf(item.result === "listed_use" ? AREAS : item.values.map((value) => valueOf(slot, value)).join(" or "), item.result),
        ]),
      },
      ...definition(outcome.quotes, choices),
    ];
  }

  function openAnswer(item: Item, slot: string): Block[] {
    const entry = intake.not_sure[slot];
    const { results, needs } = onSlot(result, placed, slot);
    return [
      heading(3, titleOf(item, ctx) ?? slot),
      ...(intake.questions[slot] ? [line(intake.questions[slot].text)] : []),
      line(entry ? `Not sure · ${REASONS.find((reason) => reason.reason === entry.reason)?.label}` : "Not answered yet"),
      ...(entry?.note ? [line(`Note: ${entry.note}`)] : []),
      ...results.flatMap((outcome) => gives(outcome, slot)),
      ...needs.flatMap(({ row, outcome }): Block[] => [
        line({ strong: row.label }, ` (${outcome.label})`),
        { kind: "list", items: [[ifYes(outcome.status)], [IF_NO]] },
      ]),
      line(item.rows === 0 ? counted(0) : `${counted(item.rows)}.`),
    ];
  }

  function listedUse(item: Item, outcome: Outcome): Block[] {
    const point = pointOf(outcome);
    const regulation = result.regulations.find((entry) => entry.id === outcome.regulation);
    const profiling = profilingOf(outcome);
    return [
      heading(3, titleOf(item, ctx) ?? item.key),
      line(LISTED_USE),
      ...(point ? unit(point, choices) : []),
      line({ strong: outcome.label }, regulation ? ` (${regulation.name})` : ""),
      { kind: "list", items: [[ifListed(profiling && labelOf(profiling.slot), outcome.derogation)], [IF_NOT_LISTED]] },
      ...(outcome.derogation === "always" ? [line(ALWAYS)] : []),
      ...definition(
        outcome.quotes.filter((entry) => entry !== point),
        choices,
      ),
      line(item.rows === 0 ? counted(0) : `${counted(item.rows)}.`),
    ];
  }

  const rows = result.gates.flatMap((outcome) => outcome.rows);
  const relevant = slots.filter((slot) => slot.id in intake.answers || intake.open_slots.includes(slot.id));
  const third = also
    .map(({ item, rows: here }) => ({ item, here: here.filter(({ row }) => kept(row)) }))
    .filter(({ here }) => here.length > 0);

  const blocks: Block[] = [
    heading(1, TITLE),
    line(TODAY.format(made)),
    ...chosen(choices, rows),
    heading(2, "The product"),
    ...schema.description.map((field) => line({ strong: `${field.label}:` }, ` ${intake.description[field.id] ?? ""}`)),
    heading(2, "The answers"),
    {
      kind: "list",
      items: relevant.map((slot) => {
        const value = intake.answers[slot.id];
        return [`${slot.label}: ${value === undefined ? "Not answered yet" : valueOf(slot.id, value)}`];
      }),
    },
    heading(2, "Result"),
    ...(rows.length > 0 || items.length > 0 ? [line(summary(rows, items.length))] : []),
    line(
      "This result assumes: ",
      ...result.assumptions.flatMap((item, index) => [`${index > 0 ? " " : ""}${item.text} (`, ...links(item.links), ")"]),
    ),
    ...(items.length === 0 ? [line(NOTHING_OPEN)] : []),
    heading(2, PARTS[0]),
    ...list.flatMap(({ regulation, head: decides, parts: outcomes }) => [
      heading(3, regulation.name),
      ...(decides ? head(decides) : regulation.gate === null ? [line({ strong: "Assumed." }, ` ${assumed(regulation.name)}`)] : []),
      ...outcomes.flatMap((outcome) => [
        heading(4, outcome.label),
        ...head(outcome),
        ...applying(outcome)
          .filter(kept)
          .flatMap((row) => section(outcome, row, [])),
      ]),
    ]),
    ...(items.length > 0
      ? [
          heading(2, PARTS[1]),
          line("The result still depends on these. Check them outside the tool."),
          ...items.flatMap((item) => (item.outcome ? listedUse(item, item.outcome) : openAnswer(item, item.key))),
        ]
      : []),
    ...(third.length > 0
      ? [
          heading(2, PARTS[2]),
          line(ALSO_LINE),
          ...third.flatMap(({ item, here }) => [
            heading(3, titleOf(item, ctx) ?? item.key),
            ...result.gates
              .filter((outcome) => here.some((entry) => entry.outcome === outcome))
              .flatMap((outcome) => {
                const { shared } = alsoRows(here, outcome, item);
                return [
                  heading(4, outcome.label),
                  ...(shared.length > 0 ? [line(eachAlsoOn(shared.map((other) => said(other, ctx))))] : []),
                  ...here.filter((entry) => entry.outcome === outcome).flatMap(({ row, on }) => section(outcome, row, on)),
                ];
              }),
          ]),
        ]
      : []),
    heading(2, "What the tool does not check yet"),
    { kind: "list", items: result.not_checked.map((item) => [`${item.text}: `, ...links(item.links)]) },
  ];
  return [...blocks, ...end(blocks)];
}

// A line that says what the choices leave out, when they leave something out.
function chosen(choices: Choices, rows: Row[]): Block[] {
  const lines: string[] = [];
  if (choices.category) {
    const of = (status: Row["status"]) => rows.filter((row) => row.status === status);
    const count = (status: Row["status"]) =>
      `${of(status).filter((row) => row.category === choices.category).length} of the ${of(status).length}`;
    lines.push(
      `Only the ${CATEGORY[choices.category].toLowerCase()} obligations are in this file: ${count("applies")} that apply now, and ${count("conditional")} that may also apply.`,
    );
  }
  if (!choices.quotes) lines.push("The articles are linked, not quoted.");
  if (!choices.meanings) lines.push("Each obligation has its action, without what it means for the product.");
  return lines.length > 0 ? [line(lines.join(" "))] : [];
}

// The end of the file: the line on legal advice, the official texts that its quotes and links come
// from, and the note on EUR-Lex.
function end(blocks: Block[]): Block[] {
  const used = new Set(
    blocks.flatMap((block) =>
      block.kind === "line" ? block.spans : block.kind === "list" ? block.items.flat() : [],
    ).flatMap((span) => (typeof span === "object" && "link" in span ? [span.link] : [])),
  );
  const texts = TEXTS.filter(([celex]) => [...used].some((address) => address.includes(`CELEX:${celex}`)));
  return [
    heading(2, "About this memo"),
    line(NOT_LEGAL_ADVICE),
    line("The quotes and links come from these official texts:"),
    {
      kind: "list",
      items: texts.map(([celex, name]) => [{ text: name, link: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${celex}` }]),
    },
    line(EURLEX),
  ];
}

// The file as Markdown. Text that Markdown would read as markup is escaped.
export function markdown(blocks: Block[]) {
  return `${blocks.map(block).join("\n\n")}\n`;
}

function block(item: Block) {
  switch (item.kind) {
    case "heading":
      return `${"#".repeat(item.level)} ${escape(item.text)}`;
    case "line":
      return start(spans(item.spans));
    case "quote":
      return item.text
        .split("\n")
        .map((text) => `> ${start(escape(text))}`)
        .join("\n>\n");
    case "list":
      return item.items.map((entry) => `- ${start(spans(entry))}`).join("\n");
  }
}

function spans(items: Span[]) {
  return items
    .map((span) =>
      typeof span === "string" ? escape(span) : "link" in span ? `[${escape(span.text)}](${span.link})` : `**${escape(span.strong)}**`,
    )
    .join("");
}

const escape = (text: string) => text.replace(/[\\`*_[\]<>]/g, "\\$&");
// A line that starts like a heading, a list item or a quote.
const start = (text: string) => text.replace(/^([#+-])/, "\\$1").replace(/^(\d+)([.)])/, "$1\\$2");
