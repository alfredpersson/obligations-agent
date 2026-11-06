import { useState } from "react";
import actions from "../../actions.module.css";
import LoadingStatus from "../../loading-status";
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

// The choices of the export and its two controls: the result as a Markdown file and as a PDF file.
// The PDF's library and fonts load only when the user downloads the PDF.
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

  const option = (name: string, label: string, checked: boolean, choose: () => void) => (
    <label key={label}>
      <input type="radio" name={name} checked={checked} onChange={choose} />
      {label}
    </label>
  );
  return (
    <div className={styles.export}>
      <div className={styles.choices}>
        <fieldset>
          <legend>Which obligations</legend>
          {option("rows", `All (${rows.length})`, category === null, () => setCategory(null))}
          {(Object.keys(CATEGORY) as Category[]).map((key) =>
            option("rows", `${CATEGORY[key]} (${rows.filter((row) => row.category === key).length})`, category === key, () =>
              setCategory(key),
            ),
          )}
        </fieldset>
        <fieldset>
          <legend>The articles</legend>
          {option("quotes", "Quoted", quotes, () => setQuotes(true))}
          {option("quotes", "Only linked", !quotes, () => setQuotes(false))}
        </fieldset>
        {intake.texts !== null && (
          <fieldset>
            <legend>Each obligation</legend>
            {option("meanings", "Its meaning and its action", meanings, () => setMeanings(true))}
            {option("meanings", "Only its action", !meanings, () => setMeanings(false))}
          </fieldset>
        )}
      </div>
      {writing && (
        <p className={styles.note}>
          The meanings and the actions are still being written: a file made now has the obligations without them.
        </p>
      )}
      <div className={actions.actions}>
        <button type="button" onClick={downloadMarkdown}>
          Download Markdown
        </button>
        <button type="button" onClick={downloadPdf} disabled={making}>
          Download PDF
        </button>
        <LoadingStatus message={making ? "Making the PDF." : null} />
      </div>
      {failed && <p role="alert">The PDF could not be made. Try again.</p>}
    </div>
  );
}
