import type { Content, TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";
import { type Block, type Span, TITLE } from "./memo-file";

// The PDF of the export (#53): the blocks of the memo laid out by pdfmake, in the fonts and the
// colors of the web app. The library and the fonts load only when the user downloads the PDF.

// The colors of the design that the PDF uses, read from globals.css on the page.
export type Colors = Record<"text" | "muted" | "accent" | "quote" | "rule", string>;

// The static fonts of the two families that the web app shows, in public/fonts/ with their licenses
// (SIL Open Font License 1.1), as their authors publish them: Source Serif 4 from the TTF folder of
// github.com/adobe-fonts/source-serif, and JetBrains Mono from the fonts/ttf folder of
// github.com/JetBrains/JetBrainsMono. The web app's own files are variable fonts in WOFF2, which
// pdfmake cannot embed.
export const FONTS = {
  Serif: { normal: "SourceSerif4-Regular.ttf", bold: "SourceSerif4-Bold.ttf" },
  Mono: { normal: "JetBrainsMono-SemiBold.ttf", bold: "JetBrainsMono-SemiBold.ttf" },
};

// The fonts by their address, with the same file for italics, which the PDF does not use.
export function fonts(address: (file: string) => string): TFontDictionary {
  return Object.fromEntries(
    Object.entries(FONTS).map(([name, files]) => [
      name,
      {
        normal: address(files.normal),
        bold: address(files.bold),
        italics: address(files.normal),
        bolditalics: address(files.bold),
      },
    ]),
  );
}

function spans(items: Span[], colors: Colors): Content[] {
  return items.map((span) =>
    typeof span === "string"
      ? span
      : "link" in span
        ? { text: span.text, link: span.link, color: colors.accent, decoration: "underline" }
        : { text: span.strong, bold: true },
  );
}

const SIZE = { 1: 22, 2: 9, 3: 7.5, 4: 12.5, 5: 11 } as const;

function content(block: Block, colors: Colors): Content {
  switch (block.kind) {
    case "heading":
      // The parts and their items are labels in the monospace font, as on the screen; the results
      // and the rows are serif headings.
      return block.level === 2 || block.level === 3
        ? {
            text: block.text,
            font: "Mono",
            fontSize: SIZE[block.level],
            characterSpacing: 0.5,
            color: block.level === 3 ? colors.muted : colors.text,
            margin: block.level === 2 ? [0, 16, 0, 6] : [0, 10, 0, 4],
            headlineLevel: block.level,
          }
        : {
            text: block.text,
            fontSize: SIZE[block.level],
            bold: true,
            margin: block.level === 1 ? [0, 0, 0, 2] : [0, 8, 0, 3],
            headlineLevel: block.level,
          };
    case "line":
      return { text: spans(block.spans, colors), margin: [0, 0, 0, 5] };
    case "quote":
      // A quote on the quote's tint with a rule on its left, as on the screen; its lines stay.
      return {
        table: { widths: ["*"], body: [[{ text: block.text, fillColor: colors.quote, fontSize: 9.5 }]] },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: (index) => (index === 0 ? 2.5 : 0),
          vLineColor: () => colors.rule,
          paddingLeft: () => 9,
          paddingRight: () => 9,
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
        margin: [0, 0, 0, 6],
      };
    case "list":
      return { ul: block.items.map((item) => ({ text: spans(item, colors) })), margin: [0, 0, 0, 5] };
  }
}

// The document: A4, the text in the serif, a heading never last on its page, and the page numbers
// in the footer.
export function definition(blocks: Block[], colors: Colors): TDocumentDefinitions {
  return {
    info: { title: TITLE },
    pageSize: "A4",
    pageMargins: [56, 52, 56, 56],
    defaultStyle: { font: "Serif", fontSize: 10, lineHeight: 1.3, color: colors.text },
    content: blocks.map((block) => content(block, colors)),
    pageBreakBefore: (node, nodes) => node.headlineLevel !== undefined && nodes.getFollowingNodesOnPage().length === 0,
    footer: (page, pages) => ({
      text: `${page} / ${pages}`,
      font: "Mono",
      fontSize: 7.5,
      color: colors.muted,
      alignment: "right",
      margin: [56, 20, 56, 0],
    }),
  };
}

// The PDF as a file to download, made in the browser.
export async function pdf(blocks: Block[]) {
  const { default: pdfMake } = await import("pdfmake/build/pdfmake");
  const style = getComputedStyle(document.documentElement);
  const color = (name: string) => style.getPropertyValue(`--color-${name}`).trim();
  pdfMake.setFonts(fonts((file) => new URL(`/fonts/${file}`, location.origin).href));
  const colors = { text: color("text"), muted: color("muted"), accent: color("accent"), quote: color("quote"), rule: color("rule") };
  return pdfMake.createPdf(definition(blocks, colors)).getBlob();
}
