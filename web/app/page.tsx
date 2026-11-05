import Link from "next/link";
import actions from "./actions.module.css";
import result from "./intakes/[id]/intake-result.module.css";
import { LISTED_USE, STATUS } from "./intakes/[id]/result-text";
import layout from "./layout.module.css";
import { NOT_LEGAL_ADVICE } from "./not-legal-advice";
import styles from "./page.module.css";

// The steps of an intake, each with its title and what it asks. The counts of the fields and of the
// questions are written here once.
const STEPS = [
  ["Describe the product", "Three short fields: what it does, who uses it, and what data it handles."],
  ["Answer the form", "Three questions with fixed answers. “Not sure” is always one of them."],
  [
    "Answer follow-up questions",
    "At most eight, one at a time. A model chooses each question from your answers so far and writes it for your product. Some questions show examples from official guidance.",
  ],
  [
    "Read the result",
    "Which parts apply and the main obligations of each, with the date, what each means for your product and one action.",
  ],
];

// The gates of the result (gates.yaml), each with the units that define it.
const CHECKS = [
  ["GDPR", "GDPR Article 2(1)"],
  ["Controller", "GDPR Article 4(7)"],
  ["Processor", "GDPR Article 4(8)"],
  ["Provider", "AI Act Article 3(3)"],
  ["High-risk under Annex III", "AI Act Article 6(2) and Annex III"],
  ["Transparency: people interact with the product", "AI Act Article 50(1)"],
];

// The three gates that the form answers of the example product decide, whatever the follow-up
// answers are, and the lead-in and point (a) of the unit that its high-risk result quotes.
const EXCERPT = [
  ["GDPR", "applies"],
  ["Provider", "applies"],
  ["High-risk under Annex III", "conditional"],
] as const;
const QUOTE = [
  "Employment, workers’ management and access to self-employment:",
  "(a) AI systems intended to be used for the recruitment or selection of natural persons, in particular to place targeted job advertisements, to analyse and filter job applications, and to evaluate candidates;",
];

function Choices() {
  return (
    <div className={`${actions.actions} ${styles.choices}`}>
      <Link href="/example" className={actions.button}>
        Use the example product
      </Link>
      <Link href="/new" className={`${actions.button} ${actions.secondary}`}>
        Start with your own product
      </Link>
    </div>
  );
}

// The start page: what the tool does, the two choices and the line on legal advice beside an
// excerpt of the example's result, then how to use the tool, what the user gets, and the choices
// again.
export default function Home() {
  return (
    <>
      <div className={styles.band}>
        <section className={`${layout.wide} ${styles.top}`}>
          <div>
            <h1 className={styles.title}>Which parts of the AI Act and the GDPR apply to your AI product?</h1>
            <p className={styles.lead}>
              Describe one AI product and answer questions about it. The result shows whether the GDPR applies
              to the product, which roles you have under the GDPR and the AI Act, and whether the product is
              high-risk under the AI Act. Each result quotes the articles that define it from the official
              text, and lists its main obligations, with the date, what each means for your product and one
              action.
            </p>
            <Choices />
            <p className={styles.note}>
              The example product is a candidate-matching tool for recruiters. Its form opens filled in, and
              you can change any field or answer before you send it. Your own product starts with an empty
              form.
            </p>
            <p className={styles.note}>{NOT_LEGAL_ADVICE}</p>
          </div>
          <figure className={styles.excerpt}>
            <figcaption>From the result for the example product</figcaption>
            <ul>
              {/* The label takes the result screen's classes, the square this page's. */}
              {EXCERPT.map(([gate, status]) => (
                <li key={gate} className={styles[status]}>
                  <span>{gate}</span>{" "}
                  <strong className={`${result.status} ${result[`badge_${status}`]}`}>{STATUS[status]}</strong>
                </li>
              ))}
            </ul>
            <p>{LISTED_USE}</p>
            <p className={result.citation}>AI Act Annex III, point 4</p>
            <blockquote className={result.quote}>{[...QUOTE, "…"].join("\n")}</blockquote>
          </figure>
        </section>
      </div>
      <div className={`${layout.wide} ${styles.sections}`}>
        <section id="how-it-works">
          <h2>How it works</h2>
          <ol className={styles.steps}>
            {STEPS.map(([title, text]) => (
              <li key={title}>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h2>What you get</h2>
          <div className={styles.split}>
            <div>
              <p>
                For each check, the result says “Applies”, “Does not apply” or “Conditional”, with the answers
                that decided it and the articles that define it, quoted and linked to EUR-Lex. A conditional
                result says what it depends on and what each answer would give.
              </p>
              <p>
                Under each check that applies or depends on your answers, the result lists its main obligations,
                each with the date from which it applies, the clause quoted and linked, what it means for your
                product, and one action.
              </p>
              <p>
                The result assumes that the product is an AI system as the AI Act defines it, offered or used
                in the EU, and it lists what the tool does not check yet.
              </p>
            </div>
            <ul className={styles.checks} aria-label="The checks">
              {CHECKS.map(([check, units]) => (
                <li key={check}>
                  <span>{check}</span> <span className={styles.units}>{units}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className={styles.again}>
          <p>See the whole flow with the example product, from the form to the result.</p>
          <Choices />
        </section>
      </div>
    </>
  );
}
