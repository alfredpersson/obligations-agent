import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Intake, Result } from "../../service";
import { testIntake, testSchema } from "../../testing";
import IntakeResult from "./intake-result";
import { markdown, memo } from "./memo-file";
import { pdf } from "./memo-pdf";

// The PDF's library does not run in jsdom: memo-pdf.test.ts tests the PDF itself.
vi.mock("./memo-pdf", () => ({ pdf: vi.fn() }));

// The files that the browser would save, by their names, from the link that the export clicks.
let saved: { name: string; blob: Blob }[];

beforeEach(() => {
  saved = [];
  const blobs = new Map<string, Blob>();
  Object.assign(URL, {
    createObjectURL: (blob: Blob) => {
      const address = `blob:${blobs.size}`;
      blobs.set(address, blob);
      return address;
    },
    revokeObjectURL: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, blob: blobs.get(this.getAttribute("href") ?? "") as Blob });
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 6, 15, 0));
  // jsdom has no modal dialog, so the tests give the dialog element the two methods that the screen
  // calls: showModal opens it, and close closes it and sends its close event.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(pdf).mockReset();
  vi.useRealTimers();
});

// Opens the export's dialog with its control, and gives the dialog.
function show(intake: Intake & { result: Result } = testIntake) {
  render(<IntakeResult intake={intake} schema={testSchema} answers="/intakes/x/answers" onTurn={() => {}} onIntake={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Download the result" }));
  return screen.getByRole("dialog", { name: "Download the result" }) as HTMLDialogElement;
}

// The options of each choice of the export, by their names, with the description that each option
// has: under each option of a list, and under a segmented control for its chosen option.
const ROWS = [
  ["All (2)", "Every obligation of the result."],
  ["Legal (1)", "For a legal representative: contracts, policies, privacy notices and legal assessments."],
  [
    "Technical (0)",
    "For the people who build the product: changes to the product and its data, and documents about the system.",
  ],
  ["Organisation (1)", "For the company: procedures, roles, training, records and registrations."],
];
const SEGMENTS = [
  [
    "The articles",
    [
      ["Quoted", "The text of each article is in the file, under its link."],
      ["Only linked", "Each article is a link to its text on EUR-Lex, for a shorter file."],
    ],
  ],
  [
    "Each obligation",
    [
      ["Meaning and action", "What its article means for your product, and what to do."],
      ["Action only", "What to do, without what the article means, for a shorter file."],
    ],
  ],
] as const;

test("Download the result opens the export's three choices and its two downloads in a dialog over the result, in place of the fold", () => {
  render(<IntakeResult intake={testIntake} schema={testSchema} answers="/intakes/x/answers" onTurn={() => {}} onIntake={() => {}} />);
  const control = screen.getByRole("button", { name: "Download the result" });
  expect(control.hasAttribute("aria-expanded")).toBe(false);
  expect(screen.queryByRole("dialog", { name: "Download the result" })).toBeNull();

  fireEvent.click(control);

  const panel = screen.getByRole("dialog", { name: "Download the result" }) as HTMLDialogElement;
  expect(panel.open).toBe(true);
  expect(screen.queryByRole("region", { name: "Download the result" })).toBeNull();
  // Which obligations: a list, each option with its count and its description under it.
  const rows = within(within(panel).getByRole("group", { name: "Which obligations" }));
  expect(rows.getAllByRole("radio")).toEqual(ROWS.map(([name, description]) => rows.getByRole("radio", { name, description })));
  expect(rows.getByRole("radio", { checked: true })).toBe(rows.getByRole("radio", { name: "All (2)" }));
  // A choice between two: a segmented control, the first option chosen, with the description of the
  // chosen option, which follows the choice.
  for (const [choice, options] of SEGMENTS) {
    const group = within(within(panel).getByRole("group", { name: choice }));
    expect(group.getAllByRole("radio")).toEqual(options.map(([name]) => group.getByRole("radio", { name })));
    for (const [name, description] of options.toReversed()) {
      fireEvent.click(group.getByRole("radio", { name }));
      expect(group.getByRole("radio", { checked: true })).toBe(group.getByRole("radio", { name, description }));
      expect(group.getByText(description)).toBeTruthy();
    }
  }
  expect(within(panel).getByRole("button", { name: "Download Markdown" })).toBeTruthy();
  expect(within(panel).getByRole("button", { name: "Download PDF" })).toBeTruthy();
});

// A click on the page around a modal dialog lands on the dialog element itself; in jsdom the test
// clicks it.
test("the X and a click on the page around the export's dialog close it, a click inside does not, and the choices stay as they were", () => {
  const panel = show();
  fireEvent.click(within(panel).getByRole("radio", { name: "Legal (1)" }));

  fireEvent.click(within(panel).getByRole("heading", { name: "Download the result" }));
  fireEvent.click(within(panel).getByRole("group", { name: "The articles" }));
  expect(panel.open).toBe(true);
  fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
  expect(panel.open).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Download the result" }));
  expect(panel.open).toBe(true);
  expect((within(panel).getByRole("radio", { name: "Legal (1)" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(panel);
  expect(panel.open).toBe(false);
});

test("Download Markdown saves the Markdown file of the choices made, and the dialog stays open", async () => {
  const panel = show();
  fireEvent.click(within(panel).getByRole("radio", { name: "Legal (1)" }));
  fireEvent.click(within(panel).getByRole("radio", { name: "Only linked" }));
  fireEvent.click(within(panel).getByRole("radio", { name: "Action only" }));

  fireEvent.click(within(panel).getByRole("button", { name: "Download Markdown" }));

  expect(saved.map(({ name }) => name)).toEqual(["obligations-memo-2026-11-06-legal.md"]);
  const choices = { category: "legal" as const, quotes: false, meanings: false };
  expect(await saved[0].blob.text()).toBe(
    markdown(memo(testIntake, testSchema, choices, new Date(2026, 10, 6, 15, 0))),
  );
  expect(saved[0].blob.type).toBe("text/markdown;charset=utf-8");
  expect(panel.open).toBe(true);
});

test("Download PDF saves the PDF made from the blocks of the choices, and says so while it is made", async () => {
  let done: (blob: Blob) => void = () => {};
  vi.mocked(pdf).mockImplementation(() => new Promise((resolve) => (done = resolve)));
  const panel = show();
  fireEvent.click(within(panel).getByRole("radio", { name: "Organisation (1)" }));
  const button = within(panel).getByRole("button", { name: "Download PDF" });

  fireEvent.click(button);

  await waitFor(() => expect(pdf).toHaveBeenCalledTimes(1));
  expect(vi.mocked(pdf).mock.calls[0][0]).toEqual(
    memo(testIntake, testSchema, { category: "organisation", quotes: true, meanings: true }, new Date(2026, 10, 6, 15, 0)),
  );
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(within(panel).getByRole("status").textContent).toBe("Making the PDF.");

  done(new Blob(["%PDF"], { type: "application/pdf" }));

  await waitFor(() => expect(saved.map(({ name }) => name)).toEqual(["obligations-memo-2026-11-06-organisation.pdf"]));
  expect((button as HTMLButtonElement).disabled).toBe(false);
  expect(within(panel).getByRole("status").textContent).toBe("");
});

test("when the PDF cannot be made, a line says so, and the control works again", async () => {
  vi.mocked(pdf).mockRejectedValueOnce(new Error("A font could not be loaded."));
  const panel = show();
  const button = within(panel).getByRole("button", { name: "Download PDF" });

  fireEvent.click(button);

  expect((await within(panel).findByRole("alert")).textContent).toBe("The PDF could not be made. Try again.");
  expect((button as HTMLButtonElement).disabled).toBe(false);
  expect(saved).toEqual([]);
});

test("without the key, the export has no choice of the meanings", () => {
  const panel = show({ ...testIntake, texts: null });

  expect(within(panel).queryByRole("group", { name: "Each obligation" })).toBeNull();
  expect(within(panel).queryByText(/still being written/)).toBeNull();
});

test("while the texts are written, the export says that a file made now has the obligations without them", () => {
  const panel = show({ ...testIntake, texts: {} });

  expect(
    within(panel).getByText(
      "The meanings and the actions are still being written: a file made now has the obligations without them.",
    ),
  ).toBeTruthy();
});
