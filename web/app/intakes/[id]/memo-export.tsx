import { useId, useState } from "react";
import LoadingStatus from "../../loading-status";
import segments from "../../segments.module.css";
import type { Intake, Result, Schema } from "../../service";
import styles from "./memo-export.module.css";
import { type Category, fileName, markdown, memo } from "./memo-file";
import { CATEGORY } from "./result-text";

// The browser saves a file that the web app made; nothing is sent from the tool (#53).
function save(blob: Blob, name: string) {
  const address = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = address;
  link.download = name;
  link.click();
  URL.revokeObjectURL(address);
}

// An option of a choice: its key, its label and its description.
type Option = [key: string, label: string, description: string];

// Who each file of one category is for, from Terms, Category, in docs/spec.md.
const FOR: Record<Category, string> = {
  legal: "For a legal representative: contracts, policies, privacy notices and legal assessments.",
  technical: "For the people who build the product: changes to the product and its data, and documents about the system.",
  organisation: "For the company: procedures, roles, training, records and registrations.",
};

// One choice of the export: a list of options, each with its description under it, or a segmented
// control, with the description of the chosen option under it.
function Choice({
  legend,
  options,
  value,
  choose,
  segmented,
}: {
  legend: string;
  options: Option[];
  value: string;
  choose: (key: string) => void;
  segmented: boolean;
}) {
  const id = useId();
  if (segmented)
    return (
      <fieldset className={styles.group}>
        <legend>{legend}</legend>
        <div className={segments.segments}>
          {options.map(([key, label]) => (
            <label key={key} className={segments.segment}>
              <input
                type="radio"
                name={id}
                checked={key === value}
                onChange={() => choose(key)}
                aria-describedby={`${id}-description`}
              />
              {label}
            </label>
          ))}
        </div>
        <p id={`${id}-description`} className={styles.description}>
          {options.find(([key]) => key === value)?.[2]}
        </p>
      </fieldset>
    );
  return (
    <fieldset className={styles.group}>
      <legend>{legend}</legend>
      {options.map(([key, label, description]) => (
        <label key={key} className={styles.option}>
          <input
            type="radio"
            name={id}
            checked={key === value}
            onChange={() => choose(key)}
            aria-labelledby={`${id}-${key}`}
            aria-describedby={`${id}-${key}-description`}
          />
          <span>
            <span id={`${id}-${key}`}>{label}</span>
            <span id={`${id}-${key}-description`} className={styles.description}>
              {description}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

// The export as the content of its dialog, under the dialog's head: its three choices, and a footer
// with the two downloads, the result as a Markdown file and as a PDF file. The dialog stays open after
// a download. The PDF's library and fonts load only when the user downloads the PDF.
export default function MemoExport({ intake, schema }: { intake: Intake & { result: Result }; schema: Schema }) {
  const [category, setCategory] = useState<Category | null>(null);
  const [quotes, setQuotes] = useState(true);
  const [meanings, setMeanings] = useState(true);
  const [making, setMaking] = useState(false);
  const [failed, setFailed] = useState(false);
  const choices = { category, quotes, meanings };
  const rows = intake.result.gates.flatMap((outcome) => outcome.rows);
  const writing = intake.texts !== null && Object.keys(intake.texts).length === 0 && rows.length > 0;

  function made() {
    const day = new Date();
    return { day, blocks: memo(intake, schema, choices, day) };
  }

  function downloadMarkdown() {
    const { day, blocks } = made();
    save(new Blob([markdown(blocks)], { type: "text/markdown;charset=utf-8" }), fileName(day, choices, "md"));
  }

  async function downloadPdf() {
    setMaking(true);
    setFailed(false);
    try {
      const { pdf } = await import("./memo-pdf");
      const { day, blocks } = made();
      save(await pdf(blocks), fileName(day, choices, "pdf"));
    } catch {
      setFailed(true);
    } finally {
      setMaking(false);
    }
  }

  return (
    <>
      <div className={styles.body}>
        <Choice
          legend="Which obligations"
          segmented={false}
          value={category ?? "all"}
          choose={(key) => setCategory(key === "all" ? null : (key as Category))}
          options={[
            ["all", `All (${rows.length})`, "Every obligation of the result."],
            ...(Object.keys(CATEGORY) as Category[]).map((key): Option => [
              key,
              `${CATEGORY[key]} (${rows.filter((row) => row.category === key).length})`,
              FOR[key],
            ]),
          ]}
        />
        <Choice
          legend="The articles"
          segmented
          value={quotes ? "quoted" : "linked"}
          choose={(key) => setQuotes(key === "quoted")}
          options={[
            ["quoted", "Quoted", "The text of each article is in the file, under its link."],
            ["linked", "Only linked", "Each article is a link to its text on EUR-Lex, for a shorter file."],
          ]}
        />
        {intake.texts !== null && (
          <Choice
            legend="Each obligation"
            segmented
            value={meanings ? "both" : "action"}
            choose={(key) => setMeanings(key === "both")}
            options={[
              ["both", "Meaning and action", "What its article means for your product, and what to do."],
              ["action", "Action only", "What to do, without what the article means, for a shorter file."],
            ]}
          />
        )}
        {writing && (
          <p className={styles.note}>
            The meanings and the actions are still being written: a file made now has the obligations without them.
          </p>
        )}
        {failed && <p role="alert">The PDF could not be made. Try again.</p>}
      </div>
      <div className={styles.footer}>
        <LoadingStatus message={making ? "Making the PDF." : null} />
        <button type="button" onClick={downloadMarkdown}>
          Download Markdown
        </button>
        <button type="button" onClick={downloadPdf} disabled={making}>
          Download PDF
        </button>
      </div>
    </>
  );
}
