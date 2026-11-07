// @vitest-environment node
import pdfmake from "pdfmake";
import type { DynamicContent } from "pdfmake/interfaces";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, test } from "vitest";
import { testIntake, testSchema } from "../../testing";
import { type Block, type Choices, memo } from "./memo-file";
import { type Colors, definition, fonts } from "./memo-pdf";

// The PDF as the browser makes it, here with pdfmake's build for Node and the font files of the web
// app, read back with PDF.js.
const FONTS = `${import.meta.dirname}/../../../public/fonts`;
pdfmake.setFonts(fonts((file) => `${FONTS}/${file}`));
pdfmake.setLocalAccessPolicy((path) => path.startsWith(FONTS));
const COLORS: Colors = { text: "#000000", muted: "#000000", accent: "#000000", quote: "#ffffff", rule: "#000000" };

// The text of the blocks, which the Markdown file and the PDF are both drawn from.
function text(blocks: Block[]) {
  const spans = (items: Extract<Block, { kind: "line" }>["spans"]) =>
    items.map((span) => (typeof span === "string" ? span : "link" in span ? span.text : span.strong)).join("");
  return blocks
    .map((block) =>
      block.kind === "heading" || block.kind === "quote"
        ? block.text
        : block.kind === "line"
          ? spans(block.spans)
          : block.items.map(spans).join(""),
    )
    .join("");
}

function links(blocks: Block[]) {
  return new Set(
    blocks
      .flatMap((block) => (block.kind === "line" ? block.spans : block.kind === "list" ? block.items.flat() : []))
      .flatMap((span) => (typeof span === "object" && "link" in span ? [span.link] : [])),
  );
}

// The text of the PDF's pages without the page numbers at their foot, its links and its title.
async function read(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes }).promise;
  let words = "";
  const found = new Set<string>();
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    words += content.items.map((item) => ("str" in item && item.transform[5] > 40 ? item.str : "")).join("");
    for (const note of await page.getAnnotations()) if (note.subtype === "Link") found.add(note.url);
  }
  const { info } = await pdf.getMetadata();
  return { words, links: found, title: (info as { Title?: string }).Title };
}

// A PDF holds lines and no spaces of its own between them, so the texts are compared without their
// whitespace.
const bare = (value: string) => value.replace(/\s+/g, "");

test.each<[string, Choices]>([
  ["the whole memo", { category: null, quotes: true, meanings: true }],
  ["only the legal rows, with only the links", { category: "legal", quotes: false, meanings: true }],
  ["only the actions", { category: null, quotes: true, meanings: false }],
])("the PDF of %s holds the texts and the links of the Markdown file, in the fonts of the web app", async (_, choices) => {
  const blocks = memo(testIntake, testSchema, choices, new Date(2026, 10, 6));
  const bytes = await pdfmake.createPdf(definition(blocks, COLORS)).getBuffer();
  const pdf = await read(new Uint8Array(bytes));

  expect(bare(pdf.words)).toBe(bare(text(blocks)));
  expect(pdf.links).toEqual(links(blocks));
  expect(pdf.title).toBe("Obligations memo");
  const raw = Buffer.from(bytes).toString("latin1");
  for (const font of ["SourceSerif4-Regular", "SourceSerif4-Bold", "Inter-Regular", "Inter-SemiBold"]) expect(raw).toContain(font);
  expect(raw).not.toContain("JetBrainsMono");
});

test("the PDF's headings are in the serif font, and all its other text is in the sans-serif font", () => {
  const blocks = memo(testIntake, testSchema, { category: null, quotes: true, meanings: true }, new Date(2026, 10, 6));
  const document = definition(blocks, COLORS);
  // The document's nodes as plain data: each heading has its level.
  const nodes: { font?: string; headlineLevel?: number }[] = JSON.parse(JSON.stringify(document.content));
  const footer = (document.footer as DynamicContent)(1, 1, { width: 595.28, height: 841.89, orientation: "portrait" });

  expect(document.defaultStyle).toHaveProperty("font", "Sans");
  expect(nodes.filter((node) => node.headlineLevel !== undefined)).toHaveLength(
    blocks.filter((block) => block.kind === "heading").length,
  );
  for (const node of nodes) expect(node.font).toBe(node.headlineLevel === undefined ? undefined : "Serif");
  expect(footer).not.toHaveProperty("font");
});
