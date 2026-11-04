import { Fragment, useId } from "react";
import type { Example } from "../../service";

// The examples from official guidance that the model matched to the user's text, each with its
// line, its quotes and its source, shown as guidance and not as law (RESP-5).
export default function GuidanceExamples({ examples }: { examples: Example[] }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading}>
      <h2 id={heading}>Examples from official guidance (not law)</h2>
      {examples.map((example) => (
        <Fragment key={example.id}>
          <h3>{example.line}</h3>
          {example.quotes.map((quote, index) => (
            <Fragment key={index}>
              {/* A heading once for quotes in a row that share it. */}
              {(index === 0 || quote.heading !== example.quotes[index - 1].heading) && (
                <p>{quote.heading}</p>
              )}
              <blockquote>{quote.text}</blockquote>
            </Fragment>
          ))}
          <p>
            <small>
              {example.source.body},{" "}
              <a href={example.source.link} target="_blank" rel="noreferrer">
                {example.source.title}
              </a>
              {example.source.note && ` (${example.source.note})`}, checked {example.source.checked}
            </small>
          </p>
        </Fragment>
      ))}
    </section>
  );
}
