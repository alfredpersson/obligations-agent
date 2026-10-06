# obligations-agent: specification

This specification describes how obligations-agent must behave. The application does not read this file when it runs. Developers turn its requirements into the fact schema, the gate tables, model instructions, tool code and tests.

It covers what a user does when the web app and the Python service run on the user's own computer: fill in a form, answer follow-up questions that a model chooses and writes, confirm the answers, and read the obligations memo.

## Terms

- **Unit**: one piece of regulation text that can be cited on its own (an article paragraph or point, a recital, or an annex point), with a fixed id such as `aia:art50(1)`.
- **Slot**: one fact about the product, with a fixed list of allowed values. The fact schema is the list of all slots. A slot answered "not sure" is called open.
- **Intake**: one run through the form, the follow-up questions and the confirmation, for one AI system.
- **Gate**: a rule in code that reads slot values and decides whether one regulation, one role or one risk tier applies to the product. The same slot values always give the same answer, and no model takes part. Example: the provider gate decides whether the user is a provider under the AI Act.
- **Scope object**: the combined result of all gates: every regulation, role and risk tier that applies to the product, the slot values that decided each one, and the open slots.
- **Row**: one obligation in the memo. Each row belongs to exactly one unit.

## Where each part of the specification is implemented

| Part of the specification | Where it is implemented | Reason |
| --- | --- | --- |
| Which facts can be asked about and recorded (FACT) | `schema.yaml` | The list of facts that can be recorded is fixed in a data file. A model cannot add to it. |
| Which regulations, roles and risk tiers apply (GATE) | `gates.yaml` and the gate code | The same facts must always give the same result, and the text of the description must not be able to change it. |
| Follow-up questions (INTAKE, TOOL) | intake system prompt and the intake tool code | The model chooses the questions and writes them. Code enforces the limits and the allowed values. |
| Whether a clause applies (MEMO) | judge prompt | Deciding whether a clause applies to the given facts needs a model's judgment. |
| Memo content and text (MEMO, RESP) | writer prompt and the code that builds the memo | The model writes the meaning and the action. Code adds the citation and the quoted clause. |
| Validation of rows (VALID) | memo data and the web app | The user's decision is recorded. The system never guesses it. |

The prompts therefore implement only part of the specification. A prompt cannot fix which facts can be recorded, and it cannot decide a risk tier reliably.

## 1. Purpose

**PURPOSE-1.** obligations-agent turns a description of one AI product into an obligations memo. The memo has one row for every obligation that applies under the AI Act (Regulation (EU) 2024/1689) and the GDPR (Regulation (EU) 2016/679), given the roles the user has for the product. Each row gives the clause the obligation comes from, what the clause means for this product, one concrete action, and a validation mark.

**PURPOSE-2.** The user gives the facts about their product. The system provides the regulation text and maps the facts to obligations. The user checks that mapping. The system asks about anything only the user can know, marks anything uncertain, and never guesses.

**PURPOSE-3.** The intended user knows what the product is for and how it works technically, and has no legal or regulatory background. This is usually an engineer in a small team, and can be a technical product manager.

## 2. Scope

**SCOPE-1.** The system supports:

- One AI system per intake. A product with several AI features needs one intake per feature. Memos are not combined.
- Roles worked out from the facts, never picked from a list: provider and deployer under the AI Act, controller and processor under the GDPR. The system also records whether the product is built on another company's general-purpose AI model.
- The full text of both regulations: articles, recitals and annexes.
- Intake and memo in English.
- A memo that is shown in the web app.

**SCOPE-2.** The system gives a result in these cases and does not refuse:

- A product that is not an AI system as defined in AI Act Article 3(1) gets no AI Act rows, and the memo states why. It still gets GDPR rows if it processes personal data.
- A product from a company that is not established in the EU, and that is not offered or used in the EU (AI Act Article 2, GDPR Article 3), gets a memo that says neither regulation applies, and why.
- A product that matches a prohibited practice (AI Act Article 5) gets exactly one AI Act row, which states the prohibition. GDPR rows are produced as usual.

**SCOPE-3.** The system does not cover:

- Legal advice, and questions where the meaning of the law is disputed.
- Anything outside the two regulations: national law, other EU acts, the terms of platforms, and rules for specific sectors.
- Answering questions about the memo or the regulations.
- Obligations of companies that provide a general-purpose AI model (AI Act Chapter V). The memo uses the fact that a product is built on such a model. It does not cover placing such a model on the market.

## 3. Facts and gates

**FACT-1.** The fact schema is one file, `schema.yaml`. Every slot has an id, a label, the allowed values, a condition that says when the slot is relevant (based on other slots), a default question text, and the unit that defines it.

**FACT-2.** Every slot has "not sure" as an allowed value.

**FACT-3.** The form shows the slots that are always relevant. Every other slot is asked as a follow-up question when it becomes relevant.

**FACT-4.** The description is the only input where the user writes free text. It can be at most 1500 characters long.

**GATE-1.** Each gate is a decision table in `gates.yaml` and names the unit that defines it.

**GATE-2.** A gate has three possible results: applies, does not apply, or conditional. If the result of a gate depends on an open slot, the result is conditional and names that slot. A gate never gives the result "does not apply" because information is missing.

**GATE-3.** The gates are:

- AI Act applies (Article 2, Article 3(1))
- provider (Article 3(3))
- deployer (Article 3(4))
- prohibited practice (Article 5)
- high-risk (Article 6 with Annex I and Annex III, except where the exception in Article 6(3) applies)
- one gate for each case that requires transparency under Article 50: interaction with natural persons, synthetic content, emotion recognition and biometric categorisation, deepfakes
- GDPR applies (Articles 2 and 3)
- controller (Article 4(7))
- processor (Article 4(8))

## 4. Intake

**INTAKE-1.** One step runs after the form is submitted and after every answer:

1. Code records the answer, checks which slots are now relevant, and puts the relevant slots that have no answer in a queue.
2. The model receives the description, the answers so far and the queue as data, and ends the step by calling `ask` or `finish`.
3. Code enforces the limits.

If the model does not make a valid `ask` or `finish` call, code asks about the next slot in the queue with its default question text, or finishes the intake if the queue is empty.

**INTAKE-2.** The model may ask only about slots that are relevant and that are either not asked yet or open. It may ask about the same slot more than once, up to the limit per slot.

**INTAKE-3.** The limits are two questions per slot and eight follow-up questions per intake. When the limit for the intake is reached, code finishes the intake. When an intake ends, relevant slots that still have no answer are treated as open.

**INTAKE-4.** The model chooses which slot to ask about and writes the question. It cannot add a slot or an allowed value. The user's text is given to the model as data in the user message, never as part of the system prompt.

**INTAKE-5.** The confirmation screen shows every recorded value with the labels from the schema, and lists the open slots. The user may change any value, and may answer an open slot by choosing one of its allowed values. After the user confirms, the answers can no longer be changed. The memo is built only from the confirmed answers and the description.

### Intake tools

Both tools change only the intake state.

| ID | Tool | Inputs | On success | On failure |
| --- | --- | --- | --- | --- |
| TOOL-1 | `ask` | slot id, question text, options each linked to an allowed value | The question is recorded and shown to the user, and the step ends. | `invalid_slot` if the slot does not exist; `not_askable` if the slot is not relevant or has an answer other than "not sure"; `invalid_option` if an option is not linked to an allowed value; `limit_reached` if the limit for the slot or for the intake is reached. |
| TOOL-2 | `finish` | none | The intake ends and moves to confirmation. | None. `finish` always succeeds. |

## 5. Memo

**MEMO-1.** The memo is built in five steps:

1. Gates: code decides which regulations, roles and risk tiers apply.
2. Retrieval: code finds the units that may apply.
3. Judge: a model decides for each unit whether it applies.
4. Writer: a model writes the meaning and the action for each row.
5. Assembly: code builds the memo from the rows.

**MEMO-2.** Retrieval may return only units from the chapters that apply to the product according to the scope object.

**MEMO-3.** The judge gives one of three results for a unit: applies, conditional, or does not apply. Conditional means that the answer depends on an open slot. The judge names that slot.

**MEMO-4.** The judge never receives text written by the user. It reads only slot values and regulation text.

**MEMO-5.** A row contains:

- a short label
- the citation and the link (MEMO-7)
- the quoted clause (MEMO-8)
- the date from which the obligation applies
- the status: definite, or conditional on a named open slot (VALID-2)
- what the clause means for this product
- one action
- the judge's reason
- the slot values that decided it
- the validation mark (VALID-1), which is empty at first

**MEMO-6.** Rows are grouped by regulation, then by role, then by chapter. In each group, definite rows come before conditional rows. If the result of a gate is conditional, every row that depends on that gate is conditional on the same slot.

**MEMO-7.** Every row links to the official text on EUR-Lex. The link opens at the right paragraph and highlights the text of the unit.

**MEMO-8.** Every row quotes the unit's text word for word from the stored regulation text, so the user can check the row even if the link does not work.

**MEMO-9.** Besides the rows, every memo shows the open slots, the list in SCOPE-3 of what the system does not cover, and one line that says the memo maps obligations to clauses and is not legal advice.

## 6. Validation

**VALID-1.** Each row has a validation mark: empty, confirmed or disputed. Only the user sets or changes it.

**VALID-2.** The system never answers an open question itself, and there is no handover to a human. It shows the question to the user as an open slot or a conditional row. A conditional row states the question, the result for yes, and the result for no.

## 7. Response requirements

**RESP-1.** The action is one task that an engineer can start on, and it refers to the facts the user gave. It does not repeat the clause in other words.

**RESP-2.** When a question uses a term that the regulation defines, it shows the definition from the regulation.

**RESP-3.** The memo and the questions use direct language without filler words. They use the regulation's own terms where the exact term matters, and plain words elsewhere.
