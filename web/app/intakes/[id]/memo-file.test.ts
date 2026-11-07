import { readFileSync } from "node:fs";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { NOT_LEGAL_ADVICE } from "../../not-legal-advice";
import type { Cited, Intake, Result, Row } from "../../service";
import { testIntake, testRows, testSchema } from "../../testing";
import IntakeResult from "./intake-result";
import { type Choices, fileName, markdown, memo } from "./memo-file";

afterEach(cleanup);

// The day on which the files of the tests are made, in the time zone of the test.
const MADE = new Date(2026, 10, 6, 15, 0);
const ALL: Choices = { category: null, quotes: true, meanings: true };

function file(choices: Choices = ALL, intake: Intake & { result: Result } = testIntake, made = MADE) {
  return markdown(memo(intake, testSchema, choices, made));
}

// The intake with other rows in the storage role.
function withRows(rows: typeof testRows, texts: Intake["texts"] = testIntake.texts) {
  return {
    ...testIntake,
    texts,
    result: {
      ...testIntake.result,
      gates: testIntake.result.gates.map((outcome) => (outcome.gate === "storage" ? { ...outcome, rows } : outcome)),
    },
  };
}

// The headings of a Markdown file, with their levels.
function headings(text: string) {
  return [...text.matchAll(/^(#{1,5}) (.*)$/gm)].map(([, marks, title]) => ({ level: marks.length, title }));
}

// The section of a row: from its heading to the next heading.
function section(text: string, label: string) {
  const start = text.indexOf(`##### ${label}\n`);
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf("\n#", start + 1);
  return text.slice(start, end);
}

test("a file starts with the title, the day on which it is made, the description and the answers", () => {
  expect(file().split("\n\n").slice(0, 8)).toEqual([
    "# Obligations memo",
    "6 November 2026",
    "## The product",
    "**Purpose:** Counts \\*visitors\\* at \\[the\\] door.",
    "**People:** Staff watch the screens.",
    "## The answers",
    "- Camera: Yes\n- Audience: Not sure\n- Video storage: Not answered yet\n- Video sharing: Not answered yet",
    "## Result",
  ]);
});

test("a file ends with the line on legal advice, the official texts that its quotes and links come from, named as in docs/regulations/README.md, and the note on EUR-Lex", () => {
  const celex = (number: string, unit: Cited): Cited => ({
    ...unit,
    link: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${number}#006.001`,
  });
  const text = file(
    ALL,
    withRows([
      { ...testRows[0], unit: celex("32016R0679", testRows[0].unit), date_unit: celex("02024R1689-20260727", testRows[0].date_unit) },
      testRows[1],
    ]),
  );

  const end = text.slice(text.indexOf("## About this memo"));
  expect(end.split("\n\n")).toEqual([
    "## About this memo",
    NOT_LEGAL_ADVICE,
    "The quotes and links come from these official texts:",
    [
      "- [Regulation (EU) 2016/679 (General Data Protection Regulation), CELEX 32016R0679, as published in the Official Journal](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679)",
      "- [The AI Act as amended by Regulation (EU) 2026/1744, in the consolidated text of 27 July 2026 (CELEX 02024R1689-20260727)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02024R1689-20260727)",
    ].join("\n"),
    "On a first visit, and again after some minutes, EUR-Lex checks the browser and then opens the page at the top, not at the article. Answer the cookie notice if it shows, then open the link again: it then opens at the article.\n",
  ]);
  // Each of the four texts, as docs/regulations/README.md names it.
  const readme = readFileSync(`${import.meta.dirname}/../../../../docs/regulations/README.md`, "utf8").toLowerCase();
  const all = file(
    ALL,
    withRows([
      { ...testRows[0], unit: celex("32016R0679", testRows[0].unit), date_unit: celex("02024R1689-20260727", testRows[0].date_unit) },
      { ...testRows[1], unit: celex("32024R1689", testRows[1].unit), date_unit: celex("32026R1744", testRows[1].date_unit) },
    ]),
  );
  const names = [...all.slice(all.indexOf("## About this memo")).matchAll(/^- \[(.*)\]\(/gm)].map(([, name]) => name);
  expect(names).toHaveLength(4);
  for (const name of names) expect(readme).toContain(name.replace(/^The /, "").toLowerCase());
});

test("between them, a file holds the three parts as the screen shows them: the same headings in the same order, and one section for each row of the screen, in the same order", () => {
  render(createElement(IntakeResult, { intake: testIntake, schema: testSchema, answers: "/intakes/x/answers" }));
  const shown = screen
    .getAllByRole("heading")
    .filter((heading) => ["H2", "H3", "H4"].includes(heading.tagName))
    .map((heading) => heading.textContent);

  const text = file();
  const all = headings(text);
  const parts = all.slice(
    all.findIndex(({ title }) => title === "What applies"),
    all.findIndex(({ title }) => title === "About this memo"),
  );
  expect(parts.filter(({ level }) => level <= 4).map(({ title }) => title)).toEqual(shown);
  expect(shown).toEqual([
    "What applies",
    "Camera Law",
    "Storage role",
    "Listing Law",
    "Answers to check",
    "Video sharing",
    "Intended use listed under Listing Rule Annex III, point 2",
    "Audience",
    "Video storage",
    "What may also apply",
    "Video sharing",
    "Storage role",
    "Not checked yet",
  ]);
  // The rows' sections, in the order of the rows on the screen.
  const rows = parts.filter(({ level }) => level === 5).map(({ title }) => title);
  expect(rows).toEqual(["Delete old video", "A notice at the door"]);
  const [first, second] = rows.map((label) => screen.getByText(label, { exact: false, selector: "p, span" }));
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("each row is a section with its label as its heading, then its result, category, clause, date and status, what it depends on and what it needs, then its quote, its meaning and its action", () => {
  const text = file();

  expect(section(text, "Delete old video")).toBe(
    [
      "##### Delete old video",
      [
        "- Result: Storage role (Camera Law)",
        "- Category: Organisation",
        `- Clause: [Rule 5(1)](${testRows[0].unit.link})`,
        `- From 25 May 2018 ([Rule 99(2)](${testRows[0].date_unit.link})).`,
        "- Status: Applies.",
      ].join("\n"),
      "> Video is deleted after a month.",
      "**What it means:** You must delete video after a month.",
      "**Action:** Add a job that deletes old video.",
    ].join("\n\n") + "\n",
  );
  // A row of the third part says what it depends on, and what else it needs.
  expect(section(text, "A notice at the door")).toBe(
    [
      "##### A notice at the door",
      [
        "- Result: Storage role (Camera Law)",
        "- Category: Legal",
        `- Clause: [Rule 6(1)](${testRows[1].unit.link})`,
        `- From 2 December 2027 ([Rule 113](${testRows[1].date_unit.link})).`,
        "- Status: Conditional.",
        "- Depends on the open answer about Video sharing.",
        "- Needs Video sharing: not answered yet.",
      ].join("\n"),
      "> A notice is shown at each door.",
      "**What it means:** If you share video, show a notice.",
      "**Action:** Draft the notice.",
    ].join("\n\n") + "\n",
  );
});

test("a row under a condition of its date that the user decides has one line with the condition's title, its sentence and its link, and not its quote", () => {
  const condition: NonNullable<Row["condition"]> = {
    citation: "Rule 111(2)",
    link: "https://eur-lex.europa.eu/rule#111.002",
    quote: "Old systems are covered only after a change.",
    title: "For a camera already in use before that date",
    text: "An older camera must meet it only after a change. You decide this.",
  };
  const text = file(ALL, withRows([{ ...testRows[0], condition }, testRows[1]]));

  expect(section(text, "Delete old video")).toContain(
    `- For a camera already in use before that date: An older camera must meet it only after a change. You decide this. ([Rule 111(2)](${condition.link})).`,
  );
  expect(text).not.toContain("Old systems are covered");
});

test("a row whose unit its result quotes links it with quoted above, and the file quotes it once, with the result", () => {
  const intake = withRows([testRows[0], testRows[1]]);
  const quoted = {
    ...intake,
    result: {
      ...intake.result,
      gates: intake.result.gates.map((outcome) => (outcome.gate === "storage" ? { ...outcome, quotes: [testRows[0].unit] } : outcome)),
    },
  };
  const text = file(ALL, quoted);

  expect(text.split("> Video is deleted after a month.")).toHaveLength(2);
  const old = section(text, "Delete old video");
  expect(old).toContain(`- Clause: [Rule 5(1)](${testRows[0].unit.link}), quoted above as the article that defines the result`);
  expect(old).not.toContain("> Video is deleted after a month.");
});

test("with the links only, a row whose unit its result quotes has its link without quoted above, since the file quotes nothing", () => {
  const intake = withRows([testRows[0], testRows[1]]);
  const quoted = {
    ...intake,
    result: {
      ...intake.result,
      gates: intake.result.gates.map((outcome) => (outcome.gate === "storage" ? { ...outcome, quotes: [testRows[0].unit] } : outcome)),
    },
  };
  const old = section(file({ ...ALL, quotes: false }, quoted), "Delete old video");

  expect(old).toContain(`- Clause: [Rule 5(1)](${testRows[0].unit.link})\n`);
  expect(old).not.toContain("quoted above");
});

test("with one category, a file leaves out the rows of the other categories, keeps every result and every answer to check, and says so at its start", () => {
  const text = file({ ...ALL, category: "legal" });

  expect(text).not.toContain("##### Delete old video");
  expect(text).toContain("##### A notice at the door");
  expect(headings(text).filter(({ level }) => level <= 4)).toEqual(headings(file()).filter(({ level }) => level <= 4));
  expect(text.split("\n\n")[2]).toBe(
    "Only the legal obligations are in this file: 0 of the 1 that apply now, and 1 of the 1 that may also apply.",
  );
});

test("with a category that no row of the third part has, a file has no third part", () => {
  const text = file({ ...ALL, category: "organisation" });

  expect(text).toContain("##### Delete old video");
  expect(text).not.toContain("## What may also apply");
  expect(text).not.toContain("##### A notice at the door");
  // The answer to check about sharing video still names the row that needs it.
  expect(text).toContain("## Answers to check");
  expect(text).toContain("**A notice at the door** (Storage role)");
  expect(text.split("\n\n")[2]).toBe(
    "Only the organisation obligations are in this file: 1 of the 1 that apply now, and 0 of the 1 that may also apply.",
  );
});

test("with only the links, each row has its citation as a link and nothing is quoted; otherwise each quote is in the file word for word", () => {
  const quoted = file();
  for (const quote of ["> Video is deleted after a month.", "> This law covers cameras.", "> Door cameras:\n>\n> (a) cameras at a main door;", "> Staff cameras are covered:\n>\n> (a) door cameras;"]) {
    expect(quoted).toContain(quote);
  }

  const linked = file({ ...ALL, quotes: false });
  expect(linked).not.toMatch(/^>/m);
  expect(section(linked, "Delete old video")).toContain(`- Clause: [Rule 5(1)](${testRows[0].unit.link})`);
  expect(linked).toContain(
    `**Applies.** Your answer: Camera: Yes.\n\nThe article that defines it: [Rule 1(1)](${testIntake.result.gates[3].quotes[0].link}).`,
  );
  expect(linked).toContain("[Listing Rule Annex III, point 2](https://eur-lex.europa.eu/rule#anx_III.002)");
  expect(linked.split("\n\n")[2]).toBe("The articles are linked, not quoted.");
});

test("with only the actions, each row has its action and not its meaning", () => {
  const text = file({ ...ALL, meanings: false });

  expect(section(text, "Delete old video")).toContain("**Action:** Add a job that deletes old video.");
  expect(text).not.toContain("What it means:");
  expect(text.split("\n\n")[2]).toBe("Each obligation has its action, without what it means for the product.");
});

test.each([
  ["the texts are not written yet", {}],
  ["the service has no key", null],
])("when %s, the rows have no meanings and no actions", (_, texts) => {
  const text = file(ALL, { ...testIntake, texts });

  expect(text).toContain("##### Delete old video");
  expect(text).not.toContain("What it means:");
  expect(text).not.toContain("Action:");
});

test("a row whose texts could not be written says so, and the other rows have theirs", () => {
  const text = file(ALL, { ...testIntake, texts: { ...testIntake.texts, "storage:rule:art5(1)": null } });

  expect(section(text, "Delete old video")).toContain("The meaning and the action of this row could not be written.");
  expect(section(text, "A notice at the door")).toContain("**Action:** Draft the notice.");
});

test("the user's text and the quotes are escaped where Markdown would read them as markup", () => {
  const text = file(
    ALL,
    withRows([{ ...testRows[0], unit: { ...testRows[0].unit, quote: "1. Providers shall keep logs.\n# of logs: 2" } }, testRows[1]]),
  );

  expect(text).toContain("**Purpose:** Counts \\*visitors\\* at \\[the\\] door.");
  expect(text).toContain("> 1\\. Providers shall keep logs.\n>\n> \\# of logs: 2");
});

test("the file's name has the day on which it is made, and the category when one is chosen", () => {
  expect(fileName(MADE, ALL, "md")).toBe("obligations-memo-2026-11-06.md");
  expect(fileName(MADE, { ...ALL, category: "legal" }, "pdf")).toBe("obligations-memo-2026-11-06-legal.pdf");
});

test("the day of a file is the user's day, also just after midnight", () => {
  const night = new Date(2026, 10, 7, 0, 30);

  expect(fileName(night, ALL, "md")).toBe("obligations-memo-2026-11-07.md");
  expect(file(ALL, testIntake, night).split("\n\n")[1]).toBe("7 November 2026");
});
