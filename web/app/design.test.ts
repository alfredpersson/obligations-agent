import { globSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

const APP = import.meta.dirname;

// The colors of the design, from the variables in globals.css.
const colors: Record<string, string> = Object.fromEntries(
  [...readFileSync(`${APP}/globals.css`, "utf8").matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(
    ([, name, hex]) => [name, hex],
  ),
);

// The relative luminance and the contrast ratio of WCAG 2.2.
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(first: string, second: string) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

// Each color with a background that it stands on, and the minimum of WCAG 2.2: 4.5:1 for text
// (1.4.3), 3:1 for the borders of controls and for the focus outline (1.4.11). The accent is the
// color of the links, the focus outline and the button's fill.
test.each([
  // Text on the page, on a text field, on a quote and on the chosen option.
  ["text", "page", 4.5],
  ["text", "surface", 4.5],
  ["text", "quote", 4.5],
  ["text", "accent-soft", 4.5],
  ["muted", "page", 4.5],
  ["muted", "surface", 4.5],
  ["muted", "quote", 4.5],
  // Links.
  ["accent", "page", 4.5],
  ["accent", "surface", 4.5],
  ["accent", "quote", 4.5],
  // The text of the button, and of the disabled button.
  ["accent-text", "accent", 4.5],
  ["disabled-text", "disabled", 4.5],
  ["error", "page", 4.5],
  ["error", "surface", 4.5],
  // The status label of each result of a gate.
  ["applies-text", "applies", 4.5],
  ["does-not-apply-text", "does-not-apply", 4.5],
  ["conditional-text", "conditional", 4.5],
  // The tag of each category of a row (issue #52): the accent's light text on each fill.
  ["accent-text", "legal", 4.5],
  ["accent-text", "technical", 4.5],
  ["accent-text", "organisation", 4.5],
  ["border", "page", 3],
  ["border", "surface", 3],
  // The focus outline and the button's fill on the page and on a text field are links' colors
  // above. The tint of the chosen option is also the band of the start page, where the accent is
  // the text of the outlined choice, so it needs 4.5:1 there (the outline on the chosen option
  // needs 3:1), and the muted text needs 4.5:1.
  ["accent", "accent-soft", 4.5],
  ["muted", "accent-soft", 4.5],
])("--color-%s on --color-%s has a contrast of at least %s:1", (color, background, minimum) => {
  expect(colors[color], color).toMatch(/^#/);
  expect(colors[background], background).toMatch(/^#/);
  expect(contrast(colors[color], colors[background])).toBeGreaterThanOrEqual(minimum);
});

// The words of the declarations in a style sheet that name a color, such as "red", "#a34a2a" or
// "rgb(": a variable and the keywords that are not a color of their own are left out. The browser's
// own parser decides which word is a color.
function namedColors(css: string) {
  const probe = document.createElement("i").style;
  const values = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/[\w-]+\s*:\s*([^;{}]+);/g)].map(
    ([, value]) => value.replace(/var\([^)]*\)/g, ""),
  );
  return values.flatMap((value) => [
    ...(value.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/gi) ?? []),
    ...value.split(/[\s,()]+/).filter((word) => {
      if (/^(?:transparent|currentcolor|inherit|initial|unset|revert)$/i.test(word)) return false;
      probe.color = "";
      probe.color = word;
      return probe.color !== "";
    }),
  ]);
}

test("the check finds a color however it is written, and no color in a variable", () => {
  expect(
    namedColors(".a { color: red; border: 1px solid #a34a2a; background: rgb(0 0 0 / 50%); outline: 3px solid white; }"),
  ).toEqual(["red", "#a34a2a", "rgb(", "white"]);
  expect(
    namedColors(".a { color: var(--color-text); border: 1px solid var(--color-rule); background: transparent; }"),
  ).toEqual([]);
});

// Only globals.css names a color, so that the pairs above cover every color on the screens.
test("no CSS Module names a color", () => {
  const modules = globSync("**/*.module.css", { cwd: APP });
  expect(modules.length).toBeGreaterThan(0);
  for (const path of modules) {
    expect(namedColors(readFileSync(`${APP}/${path}`, "utf8")), path).toEqual([]);
  }
});
