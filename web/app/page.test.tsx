import { readFileSync } from "node:fs";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import Home from "./page";

afterEach(cleanup);

// The stored text of the regulations that the service quotes (MEMO-8).
const GATES = readFileSync(`${import.meta.dirname}/../../api/src/obligations_agent/gates.yaml`, "utf8");

test("the start page says what the tool does, how to use it, what the user gets, and that the result is not legal advice", () => {
  render(<Home />);

  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "Which parts of the AI Act and the GDPR apply to your AI product?",
  );
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
    "How it works",
    "What you get",
  ]);
  expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
    "Describe the product",
    "Answer the form",
    "Answer follow-up questions",
    "Check your answers",
    "Read the result",
  ]);
  expect(
    within(screen.getByRole("list", { name: "The checks" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([
    "GDPR GDPR Article 2(1)",
    "Controller GDPR Article 4(7)",
    "Processor GDPR Article 4(8)",
    "Provider AI Act Article 3(3)",
    "High-risk under Annex III AI Act Article 6(2) and Annex III",
    "Transparency: people interact with the product AI Act Article 50(1)",
  ]);
  expect(
    screen.getByText("The result maps your answers to articles of the AI Act and the GDPR. It is not legal advice."),
  ).toBeTruthy();
});

test("the first choice opens the form with the example product, and the other one the empty form", () => {
  render(<Home />);

  const links = screen.getAllByRole("link");
  expect(links[0].textContent).toBe("Use the example product");
  for (const link of screen.getAllByRole("link", { name: "Use the example product" })) {
    expect(link.getAttribute("href")).toBe("/example");
  }
  for (const link of screen.getAllByRole("link", { name: "Start with your own product" })) {
    expect(link.getAttribute("href")).toBe("/new");
  }
});

test("the excerpt shows the three gates that the example's form answers decide in the parts of the result, and quotes the stored text word for word", () => {
  render(<Home />);

  // jsdom's accessible names do not come from a figcaption, so the test reads the caption itself.
  const excerpt = screen.getByRole("figure");
  expect(excerpt.querySelector("figcaption")?.textContent).toBe("From the result for the example product");
  expect(within(excerpt).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "GDPR Applies.",
    "Provider Applies.",
    "High-risk under Annex III Conditional.",
  ]);
  // The names of the three parts (issue #51), each before what stands in it, and the listed use as
  // the second part asks it.
  const names = ["What applies", "Answers to check", "What may also apply"].map((name) => within(excerpt).getByText(name));
  const [gdpr, , highRisk] = within(excerpt).getAllByRole("listitem");
  const listed = within(excerpt).getByText(/^Intended use listed under AI Act Annex III, point 4/);
  for (const [name, next] of [
    [names[0], gdpr],
    [names[1], listed],
    [names[2], highRisk],
  ]) {
    expect(name.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(listed.closest("p")?.textContent).toBe(
    "Intended use listed under AI Act Annex III, point 4. Is the product's intended use one of the uses listed under this point? You decide this: no answer of the intake holds it.",
  );
  // The lead-in and point (a) of the quote, each a line of the stored quote; the last line marks
  // what is left out.
  const lines = (excerpt.querySelector("blockquote")?.textContent ?? "").split("\n");
  expect(lines.at(-1)).toBe("…");
  expect(lines.slice(0, -1)).toHaveLength(2);
  for (const line of lines.slice(0, -1)) expect(GATES).toContain(`\n      ${line}\n`);
});

test("the start page names the three parts of the result, with the rows, their dates, meanings and actions, among what the user gets", () => {
  render(<Home />);

  const step = screen.getByRole("heading", { level: 3, name: "Read the result" });
  expect(step.nextElementSibling?.textContent).toBe(
    "What applies, with the main obligations, their dates, what each means for your product and one action. Then the answers left to check, and what they may add.",
  );
  const get = screen.getByRole("heading", { level: 2, name: "What you get" }).parentElement as HTMLElement;
  expect(within(get).getByText(/^The result has three parts\./).textContent).toBe(
    "The result has three parts. What applies: each check that your answers decide, “Applies” or “Does not apply”, with the answers that decided it and the articles that define it, quoted and linked to EUR-Lex, and under each check that applies its main obligations, each with the date from which it applies, the clause quoted and linked, what it means for your product, and one action. A tag on each obligation says who carries out its action: a legal representative, the people who build the product, or the company.",
  );
  expect(within(get).getByText(/^Answers to check:/).textContent).toBe(
    "Answers to check: each answer that the result still depends on, with its question, your reason and note, and what each answer would give, the one that decides the most obligations first. What may also apply: the obligations that depend on those answers, under the answer that they depend on.",
  );
});

test("the start page names the check of the answers among the steps, with the way back from the result", () => {
  render(<Home />);

  const step = screen.getByRole("heading", { level: 3, name: "Check your answers" });
  expect(step.nextElementSibling?.textContent).toBe(
    "All your answers on one screen: change any of them, and answer the open ones that you can. You can come back to it from the result.",
  );
});
