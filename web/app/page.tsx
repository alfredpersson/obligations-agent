import Link from "next/link";
import actions from "./actions.module.css";
import result from "./intakes/[id]/intake-result.module.css";
import { LISTED_USE, PARTS, STATUS } from "./intakes/[id]/result-text";
import layout from "./layout.module.css";
import { NOT_LEGAL_ADVICE } from "./not-legal-advice";
import styles from "./page.module.css";

// The steps of an intake, each with its title and what it asks. The counts of the fields and of the
// questions are written here once.
const STEPS = [
  ["Describe the product", "Three short fields: what it does, who uses it, and what data it handles."],
  ["Answer the form", "Four questions with fixed answers. “Not sure” is always one of them."],
  [
    "Answer follow-up questions",
    "At most ten, one at a time. A model chooses each question from your answers so far and writes it for your product. Some questions show examples from official guidance.",
  ],
  [
    "Check your answers",
    "All your answers on one screen: change any of them, and answer the open ones that you can. You can come back to it from the result.",
  ],
  [
    "Read the result",
    "What applies, with the main obligations, their dates, what each means for your product and one action. Then the answers left to check, and what they may add.",
  ],
];

// The icon of each step, in the order of the steps, drawn in the page as the X of the dialogs is: a
// pencil, options with one chosen, a speech bubble with a question mark, two checked lines, and a
// folded map.
const ICONS = [
  <>
    <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
    <path d="M14.5 7.5l3 3" />
  </>,
  <>
    <circle cx="6" cy="6.5" r="2" />
    <path d="M11 6.5h9" />
    <circle cx="6" cy="12" r="2" fill="currentColor" />
    <path d="M11 12h9" />
    <circle cx="6" cy="17.5" r="2" />
    <path d="M11 17.5h9" />
  </>,
  <>
    <path d="M4 5.5h16v10.5H10l-4.5 3.5V16H4z" />
    <path d="M10 9.3a2 2 0 1 1 2.9 1.8c-.6.3-.9.7-.9 1.3" />
    <path d="M12 14.2h.01" />
  </>,
  <>
    <path d="M4 7.5l2 2 3.5-3.5" />
    <path d="M13 8h7" />
    <path d="M4 15.5l2 2 3.5-3.5" />
    <path d="M13 16h7" />
  </>,
  <>
    <path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z" />
    <path d="M9 4v13.5" />
    <path d="M15 6.5V20" />
  </>,
];

// The gates of the result (gates.yaml), each with the units that define it.
const CHECKS = [
  ["GDPR", "GDPR Article 2(1)"],
  ["Controller", "GDPR Article 4(7)"],
  ["Processor", "GDPR Article 4(8)"],
  ["Provider", "AI Act Article 3(3)"],
  ["High-risk under Annex III", "AI Act Article 6(2) and Annex III"],
  ["Transparency: people interact with the product", "AI Act Article 50(1)"],
  ["Transparency: the product generates content", "AI Act Article 50(2)"],
  ["Deployer", "AI Act Article 3(4)"],
];

// The four gates that the form answers of the example product decide, whatever the follow-up
// answers are, by the part of the result where each shows: the GDPR, the provider and the deployer
// apply, the question of the listed use is left to check, and high-risk under Annex III may also
// apply. The lead-in and point (a) of the unit that the high-risk result quotes.
const APPLIES = ["GDPR", "Provider", "Deployer"];
const QUOTE = [
  "Employment, workers’ management and access to self-employment:",
  "(a) AI systems intended to be used for the recruitment or selection of natural persons, in particular to place targeted job advertisements, to analyse and filter job applications, and to evaluate candidates;",
];

function Choices() {
  return (
    <div className={`${actions.actions} ${styles.choices}`}>
      <Link href="/new" className={actions.button}>
        Start with your own product
      </Link>
      <Link href="/example" className={`${actions.button} ${actions.secondary}`}>
        Use the example product
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
              Your own product starts with an empty form. The example product is a candidate-matching tool
              for recruiters. Its form opens filled in, and you can change any field or answer before you
              send it.
            </p>
            <p className={styles.note}>{NOT_LEGAL_ADVICE}</p>
          </div>
          <figure className={styles.excerpt}>
            <figcaption>From the result for the example product</figcaption>
            {/* The labels take the result screen's classes, the squares this page's. */}
            <p className={styles.partName}>{PARTS[0]}</p>
            <ul>
              {APPLIES.map((gate) => (
                <li key={gate} className={styles.applies}>
                  <span>{gate}</span>{" "}
                  <strong className={`${result.status} ${result.badge_applies}`}>{STATUS.applies}</strong>
                </li>
              ))}
            </ul>
            <p className={styles.partName}>{PARTS[1]}</p>
            <p>
              <strong>Intended use listed under AI Act Annex III, point 4.</strong> {LISTED_USE}
            </p>
            <blockquote className={result.quote}>{[...QUOTE, "…"].join("\n")}</blockquote>
            <p className={styles.partName}>{PARTS[2]}</p>
            <ul>
              <li className={styles.conditional}>
                <span>High-risk under Annex III</span>{" "}
                <strong className={`${result.status} ${result.badge_conditional}`}>{STATUS.conditional}</strong>
              </li>
            </ul>
          </figure>
        </section>
      </div>
      <div className={`${layout.wide} ${styles.sections}`}>
        <section id="how-it-works">
          <h2>How it works</h2>
          <ol className={styles.steps}>
            {STEPS.map(([title, text], index) => (
              <li key={title}>
                <span className={styles.icon} aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    width="22"
                    height="22"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {ICONS[index]}
                  </svg>
                </span>
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
                The result has three parts. {PARTS[0]}: each check that your answers decide, “Applies” or “Does
                not apply”, with the answers that decided it and the articles that define it, quoted and linked
                to EUR-Lex, and under each check that applies its main obligations, each with the date from which
                it applies, the clause quoted and linked, what it means for your product, and one action. A tag
                on each obligation says who carries out its action: a legal representative, the people who build
                the product, or the company.
              </p>
              <p>
                {PARTS[1]}: each answer that the result still depends on, with its question, your reason and
                note, and what each answer would give, the one that decides the most obligations first.{" "}
                {PARTS[2]}: the obligations that depend on those answers, under the answer that they depend on.
              </p>
              <p>
                Download it as a Markdown or a PDF file, all of it or the obligations of one category, such as the
                legal ones for a legal representative.
              </p>
              <p>
                Under each open answer, what each of its answers would change in the whole result. Beside the result,
                ask about a change to your product, such as a new feature: the answer names which of your answers it
                may change, with the examples that show what each question covers, and shows what the rules would then
                add.
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
          <p>Describe your own product, or follow the example product from the form to the result.</p>
          <Choices />
        </section>
      </div>
    </>
  );
}
