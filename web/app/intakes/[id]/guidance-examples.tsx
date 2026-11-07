import { Fragment, useId } from "react";
import type { Example, Group } from "../../service";
import styles from "./guidance-examples.module.css";

// The quotes of entries from official guidance with their sources, as guidance and not as law
// (RESP-5): the follow-up questions show them in groups, and the panel of questions about the
// result under each answer that a change may change (#44).
export function Entries({ entries }: { entries: Example[] }) {
  return entries
    .flatMap((entry) => entry.quotes.map((quote) => ({ quote, source: entry.source })))
    .map(({ quote, source }, index, rows) => (
      <Fragment key={index}>
        {/* A heading once for quotes in a row that share it and their source, also across
            entries. */}
        {(rows[index - 1]?.source.id !== source.id ||
          rows[index - 1].quote.heading !== quote.heading) && (
          <p className={styles.heading}>{quote.heading}</p>
        )}
        <blockquote>{quote.text}</blockquote>
        {/* The source once after the quotes of entries in a row from the same source. */}
        {rows[index + 1]?.source.id !== source.id && (
          <p className={styles.source}>
            <small>
              {source.body},{" "}
              <a href={source.link} target="_blank" rel="noreferrer">
                {source.title}
              </a>
              {source.note && ` (${source.note})`}, checked {source.checked}
            </small>
          </p>
        )}
      </Fragment>
    ));
}

// The examples from official guidance that the model matched to the user's text, in groups: each
// group's line about a part of the user's text, then the quotes and the sources of its entries,
// shown as guidance and not as law (RESP-5).
export default function GuidanceExamples({ examples }: { examples: Group[] }) {
  const heading = useId();
  return (
    <section className={styles.examples} aria-labelledby={heading}>
      <h2 id={heading}>Examples from official guidance (not law)</h2>
      {examples.map((group) => (
        <div key={group.entries[0].id} className={styles.group}>
          <h3>{group.line}</h3>
          <Entries entries={group.entries} />
        </div>
      ))}
    </section>
  );
}
