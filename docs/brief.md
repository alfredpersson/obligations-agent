# obligations-agent: product brief

Status: draft, written before the first commit. The behavior specification for the parts that are built or being built is in [spec.md](spec.md). This brief describes who the product is for, what it must do for them, which assumptions the design is based on, and how each assumption is tested.

## What it is

An engineer describes one AI product by filling in a short form and answering a few follow-up questions. The system returns an obligations memo. The memo has one row for every obligation that applies to the product under the EU AI Act and the GDPR. Each row gives the clause the obligation comes from, a link that highlights that clause in the official text, what the clause means for this product, one concrete action, and a mark that the engineer sets to confirmed or disputed. The engineer provides the facts. The system provides the law and maps the facts to obligations. The engineer checks that mapping.

## Persona

An engineer who builds an AI product, alone or in a small team, with no legal or regulatory background and no lawyer to ask. They know their system in detail: what it does, who uses it and what data it handles. They do not know which articles apply, and the two regulations together are several hundred pages long. A technical product manager who knows the system at this level fits the same persona.

What they want: a concrete list of what they must do for their product, which they can check against the official text and which they get in one session. What they do not want: a course on the AI Act, a chatbot they have to question, or a general checklist that is the same for every product.

The persona is based on the author's own experience of building AI solutions. The assumptions behind it are listed below, each with the method that tests it.

## Goal

In about fifteen minutes, and without reading either regulation, the engineer gets a list of the obligations for their own product, with one action per row, that they can check against the official text.

Not goals for now: legal advice, regulations other than these two, answering questions about the memo, user accounts or saved history, and languages other than English.

## Journey

1. Open the page. Read what the tool does and the one line that says it maps obligations to clauses and is not legal advice. Load the example product or start with your own.
2. Fill in the form: eight to twelve questions, nearly all with fixed choices, and a description of two or three sentences. This takes about three to five minutes.
3. Answer the follow-up questions one at a time. There are at most eight, with fixed choices where possible, and "not sure" is always an allowed answer. This takes about two to four minutes.
4. Check all the facts on one screen. Correct anything that is wrong, and answer any open question you can.
5. Wait for the memo, which takes less than a minute.
6. Read the rows that matter to you, open the linked clause, and mark rows as confirmed or disputed.
7. Export the memo as markdown. Do the actions outside the tool.

## What exists and why this is different

Several tools already exist and work: the Future of Life Institute's AI Act chatbot, the AI Act Explorer and Compliance Checker at artificialintelligenceact.eu, and the European Commission's AI Act Service Desk tools. They answer questions about the AI Act or place a system in a risk tier. None of them takes the facts of one specific product and returns its obligations under the AI Act and the GDPR together, each with a citation, what it means for that product, and an action. That mapping is the product.

## Assumptions

The design is based on the assumptions below. Each one is written as a statement that can be tested, together with the method that will test it. Its status is updated when evidence arrives. Until then, the product is designed for the persona above and based on these assumptions, not together with users.

| ID | Assumption | Validation method | Status |
| --- | --- | --- | --- |
| A1 | Engineers want a list for their own product, not an explanation of the regulation. | The tool is used on a product the author built: the memo must contain the obligations already found by hand for that product, including the Article 50 disclosure and the data processing agreement. In addition, real questions from public engineering forums are collected and checked against what the memo would have answered. | Open |
| A2 | For this persona, a form with fixed choices works better than a chat. | Use of the tool by the author. As supporting evidence only: the share of started intakes that reach a memo on the live deployment. | Open |
| A3 | Engineers can answer the questions about their own system when the definition is shown in plain words. | Use of the tool by the author, the share of "not sure" answers per question counted over all intakes on the live deployment, and informal tests with two or three engineers when possible. | Open |
| A4 | A person who is not a lawyer can check a row with citation, quoted clause, meaning and action in one minute. | Use of the tool by the author, the share of rows marked as disputed on the live deployment, and hand labels of how good the written meaning and action are. | Open |
| A5 | Thirty to forty facts are enough to decide which obligations apply. | The benchmark (a set of test products with known correct answers): during labeling, every product that needed a fact outside the schema is recorded. If more than a few products needed one, the assumption is false. | Open |
| A6 | The existing tools do not provide this. | Three benchmark products are run by hand through the tools named above. The comparison covers how many of the obligations they find and how specific their answers are to the product. | Open |

A1, A5 and A6 can be tested without any users. For A2, A3 and A4, the first evidence comes from the author's own use, and more comes from the live deployment over time.

## Design summary

The design in five points:

1. A fact schema, written by hand from the regulation text, fixes which facts the system can ask about and which answers it can record. "Not sure" is always an allowed answer.
2. A form asks about the facts that are always relevant. After that, a model asks follow-up questions: the model chooses which fact to ask about and writes the question, and code enforces the limits and the allowed answers. The user confirms all answers before anything else runs.
3. Rules in code, not a model, decide which regulations, roles and risk tiers apply to the product. The same facts always give the same result. When a fact that a rule needs is open, the result of the rule is conditional, not "does not apply".
4. Within the regulations and roles that apply, a search step (retrieval) finds the clauses that may be relevant. A model checks each clause against the facts, and a model writes the meaning and the action for each row. Every row quotes its clause and links to it in the official text.
5. The memo is built in a fixed sequence of steps, because the task is predictable and must be reliable. A model is used only where judgment is needed: choosing questions, checking whether a clause applies, and writing the text.

## Risks

- **The judge may be unreliable for some conditions.** An obligation that depends on a condition, such as the requirement for a data protection impact assessment (DPIA), may be judged differently from run to run. If testing shows this, the condition becomes a rule in code, and the decision is recorded.
- **The official web pages may change.** The anchors and the text that the links use could change. For that reason, the import of the regulation text records which document version it used, every link also points to the paragraph, and every row quotes its clause word for word.
- **Too many open facts.** An unusual product could reach the limit for follow-up questions while many facts are still open, and get a memo where most rows are conditional. To prevent this, the user can answer open facts directly on the confirmation screen.
