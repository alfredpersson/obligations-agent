import { Fragment, useId } from "react";
import type { Group } from "../../service";

// The examples from official guidance that the model matched to the user's text, in groups: each
// group's line about a part of the user's text, then the quotes and the sources of its entries,
// shown as guidance and not as law (RESP-5).
export default function GuidanceExamples({ examples }: { examples: Group[] }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading}>
      <h2 id={heading}>Examples from official guidance (not law)</h2>
      {examples.map((group) => (
        <Fragment key={group.entries[0].id}>
          <h3>{group.line}</h3>
          {group.entries
            .flatMap((entry) => entry.quotes.map((quote) => ({ quote, source: entry.source })))
            .map(({ quote, source }, index, rows) => (
              <Fragment key={index}>
                {/* A heading once for quotes in a row that share it and their source, also across
                    entries. */}
                {(rows[index - 1]?.source.id !== source.id ||
                  rows[index - 1].quote.heading !== quote.heading) && <p>{quote.heading}</p>}
                <blockquote>{quote.text}</blockquote>
                {/* The source once after the quotes of entries in a row from the same source. */}
                {rows[index + 1]?.source.id !== source.id && (
                  <p>
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
            ))}
        </Fragment>
      ))}
    </section>
  );
}
