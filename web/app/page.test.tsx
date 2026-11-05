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

test("the excerpt shows the three gates that the example's form answers decide, and quotes the stored text word for word", () => {
  render(<Home />);

  // jsdom's accessible names do not come from a figcaption, so the test reads the caption itself.
  const excerpt = screen.getByRole("figure");
  expect(excerpt.querySelector("figcaption")?.textContent).toBe("From the result for the example product");
  expect(within(excerpt).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "GDPR Applies.",
    "Provider Applies.",
    "High-risk under Annex III Conditional.",
  ]);
  // The lead-in and point (a) of the quote, each a line of the stored quote; the last line marks
  // what is left out.
  const lines = (excerpt.querySelector("blockquote")?.textContent ?? "").split("\n");
  expect(lines.at(-1)).toBe("…");
  expect(lines.slice(0, -1)).toHaveLength(2);
  for (const line of lines.slice(0, -1)) expect(GATES).toContain(`\n      ${line}\n`);
});

test("the start page names the rows of each result, with their dates, meanings and actions, among what the user gets", () => {
  render(<Home />);

  const step = screen.getByRole("heading", { level: 3, name: "Read the result" });
  expect(step.nextElementSibling?.textContent).toBe(
    "Which parts apply and the main obligations of each, with the date, what each means for your product and one action.",
  );
  expect(
    screen.getByText(
      "Under each check that applies or depends on your answers, the result lists its main obligations, each with the date from which it applies, the clause quoted and linked, what it means for your product, and one action.",
    ),
  ).toBeTruthy();
});
