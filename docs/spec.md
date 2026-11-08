# obligations-agent: specification

This specification describes how obligations-agent must behave. The application does not read this file when it runs. Developers turn its requirements into the fact schema, the gate tables, model instructions, tool code and tests.

It covers what a user does when the web app and the Python service run on the user's own computer: fill in a form, answer follow-up questions that a model chooses and writes, confirm the answers, and read the obligations memo.

## Terms

- **Unit**: one piece of regulation text that can be cited on its own (an article paragraph or point, a recital, or an annex point), with a fixed id such as `aia:art50(1)`.
- **Slot**: one fact about the product, with a fixed list of allowed values. The fact schema is the list of all slots. A slot answered "not sure" is called open.
- **Intake**: one run through the form, the follow-up questions and the confirmation, for one AI system.
- **Description**: the three texts that the user writes about the product on the form (FACT-4).
- **Gate**: a rule in code that reads slot values and decides whether one regulation, one role or one risk tier applies to the product. The same slot values always give the same answer, and no model takes part. Example: the provider gate decides whether the user is a provider under the AI Act.
- **Scope object**: the combined result of all gates: every regulation, role and risk tier that applies to the product, the slot values that decided each one, and the open slots.
- **Row**: one obligation in the memo. Each row belongs to exactly one unit.
- **Category**: who carries out the action of a row: legal, a legal representative (a contract, a policy, a privacy notice or a legal assessment); technical, the people who build the product (a change to the product, its data, its infrastructure or what it shows its users, or a document about the system); organisation, the company (a procedure, a role, a training, a record or a registration). Each row has one category.

## Where each part of the specification is implemented

| Part of the specification | Where it is implemented | Reason |
| --- | --- | --- |
| Which facts can be asked about and recorded (FACT) | `schema.yaml` | The list of facts that can be recorded is fixed in a data file. A model cannot add to it. |
| Examples from official guidance (FACT-6) | `guidance.yaml` and the stored copies in `docs/guidance/` | Each quote must be word for word and checked against its copy. A model cannot add or change one. |
| Which regulations, roles and risk tiers apply, and the rows of their obligations with their dates (GATE) | `gates.yaml` (the gates, the rows and the dates), the gate code and the stored copies in `docs/regulations/` | The same facts must always give the same result, and the text of the description must not be able to change it. |
| Follow-up questions (INTAKE, TOOL) | intake system prompt and the intake tool code | The model chooses the questions and writes them. Code enforces the limits and the allowed values. |
| Whether a clause applies (MEMO) | judge prompt | Deciding whether a clause applies to the given facts needs a model's judgment. |
| Memo content and text (MEMO, RESP) | `writer_prompt.md`, `writer.py` and the code that builds the memo | The model writes the meaning and the action. Code adds the citation and the quoted clause. |
| Validation of rows (VALID) | memo data and the web app | The user's decision is recorded. The system never guesses it. |
| Questions about the result and changes to the product (QA, TOOL-2 to TOOL-6) | `gates.py` for the changes of answers, `conversation_prompt.md`, `conversation.py` and `regulations.py` | The model chooses the tools, names the questions that a change may change, gives the change its label and writes the answer. Code computes each change and each planned change, checks each quote, links each citation and enforces the limits. |

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
- A memo that is shown in the web app, and that the user can download as a Markdown file or a PDF file (MEMO-10).

**SCOPE-2.** The system gives a result in these cases and does not refuse:

- A product that is not an AI system as defined in AI Act Article 3(1) gets no AI Act rows, and the memo states why. It still gets GDPR rows if it processes personal data.
- A product from a company that is not established in the EU, and that is not offered or used in the EU (AI Act Article 2, GDPR Article 3), gets a memo that says neither regulation applies, and why.
- A product that matches a prohibited practice (AI Act Article 5) gets exactly one AI Act row, which states the prohibition. GDPR rows are produced as usual.

**SCOPE-3.** The system does not cover:

- Legal advice, and questions where the meaning of the law is disputed.
- Anything outside the two regulations: national law, other EU acts, the terms of platforms, and rules for specific sectors. Examples from official guidance appear only in questions (RESP-5), as guidance and not as law.
- Questions that are not about the result of an intake or a change to the product, under the two regulations (QA-1 to QA-9).
- Obligations of companies that provide a general-purpose AI model (AI Act Chapter V). The memo uses the fact that a product is built on such a model. It does not cover placing such a model on the market.

## 3. Facts and gates

**FACT-1.** The fact schema is one file, `schema.yaml`. Every slot has an id, a label, the allowed values, a condition that says when the slot is relevant (based on other slots), a default question text, and the unit that defines it.

**FACT-2.** Every slot has "not sure" as an allowed value.

**FACT-3.** The form shows the slots that are always relevant. Every other slot is asked as a follow-up question when it becomes relevant.

**FACT-4.** The description and the notes of "not sure" answers (INTAKE-6) are the only inputs where the user writes free text. The description has three fields, defined in `schema.yaml`: what the product does, who uses it, and what data it handles. Each can be at most 500 characters long.

**FACT-5.** The form can be sent only when every slot on it has an answer and every field of the description is filled in. "Not sure" counts as an answer.

**FACT-6.** Examples from official guidance are one file, `guidance.yaml`, next to `schema.yaml`. Each entry belongs to one slot and one source, and holds one or more quotes from that source, word for word, each with the heading, or the sentence that introduces a list, under which the source gives it. An entry is two-sided when its quotes show a case that the source counts under the slot's term and a case that it does not, or a party that decides and a party that does not. Every other entry is marked one-sided. The file holds one entry for each kind of data or situation: where sources give the same one, the entry that shows both sides, or else the one that states its condition. Each source has its title, the body that published it, a link, the date of the document where it has one, the date its quotes were last checked, its terms of reuse, and a text copy stored in the repository. Only sources whose terms allow such a copy are used.

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

**GATE-4.** When the user has confirmed the answers of an intake (INTAKE-5), the service computes the result of the gates for the facts that the intake asks from the confirmed answers, each time the intake is read, and the web app shows it with a link to the confirmation screen, in the parts of MEMO-6: each result that applies or does not apply in the first part, grouped by regulation: the GDPR, with the result of the gate that decides whether it applies as its head, then its roles; the AI Act, which the result assumes to apply, then its roles and risk tiers. For each gate whose slot is relevant, the result gives applies, does not apply or conditional (GATE-2), the answers that decided it, and the units that define it, each quoted (MEMO-8) and linked (MEMO-7). A conditional result shows in the second part under each open slot that it depends on, with the last question asked about the slot, the reason and the note of a "not sure" answer, the result for each answer, and a link to the slot on the confirmation screen (VALID-2). A result under a conditional gate is conditional on the same slots, unless its own answer gives "does not apply" (MEMO-6). For an area of Annex III, the high-risk result is conditional on whether the product's intended use is one of the uses listed under that point, which the user decides, and it says what Article 6(3) gives for the answer about profiling; the second part shows that question once, with the quoted point and without a link. The result states that it assumes an AI system as defined in AI Act Article 3(1) that is offered or used in the EU, and lists the gates of GATE-3 and the parts of them that the intake does not ask as not checked, each with a link. Before the web app opens a link to EUR-Lex, it shows a dialog that says that EUR-Lex checks the browser on a first visit and again after some minutes, and then opens at the top of the page, and the user opens the link from the dialog. The dialog does not show while less than five minutes have passed since the user last opened EUR-Lex from it.

**GATE-5.** When the answers are confirmed, the result shows the rows of the obligations from `gates.yaml` of each result that applies or is conditional, a row that applies under its result in the first part and a conditional row in the third part (MEMO-6), each with its label, the date from which it applies with a link to the article that sets it, once above each run of rows of a result that share it, and, inside the row when the user opens it, its unit quoted (MEMO-8) and linked (MEMO-7) and, for a row that also needs another result or the answer "yes" of a fact, that result or answer. A row whose unit is a unit that its result quotes links it, and the quote shows once, with the result (MEMO-8). Each row has one category (Terms), set by hand in `gates.yaml`, and a row that needs legal drafting is legal; the service does not start with a row without a category or with another value. A row is conditional when its result is conditional, or when the result or fact that it also needs is conditional, "not sure" or without an answer, and it is not shown when that result does not apply or that fact is "no" (MEMO-6). A row that holds only for some answers of the fact that decides its result, such as the conformity assessment of AI Act Article 43, which depends on the point of Annex III, is not shown for the other answers. A condition of a row's date that the user decides, such as AI Act Article 111(2) for high-risk under Annex III or Article 111(4) for the marking of generated content, is folded under that date, with a title and a sentence that say it in short, its unit quoted and linked. When the service has the key, a model writes what the clause of each row means for this product and one action (RESP-1, RESP-7), once for the confirmed answers, and every later read shows the same texts. A row in the first part shows its action beside its label and its meaning inside the row when the user opens it, and a row in the third part shows both when the user opens it. A change of an answer removes them, and the next confirmation writes them again for the rows of the new result. Until they are written, each row shows a placeholder in the place of its action, and a row whose texts could not be written says so. For the rows that a planned change adds (QA-12), the model also receives the text of the change and the answers that it changes as data in the user message, and writes the texts for the answers with the change, once for the confirmed answers; a change of an answer removes them, and the next confirmation writes them again. Without the key, the rows show neither. The category of each row shows as a tag in its own colour at the start of its action, also beside the placeholder and beside the line that its texts could not be written; where no action shows, on a folded row of the third part and on every row without the key, the tag stands after the label. The user's text is given to the model as data in the user message, never in the system prompt.

## 4. Intake

**INTAKE-1.** One step runs after the form is submitted and after every answer:

1. Code records the answer, checks which slots are now relevant, removes the answers of slots that are no longer relevant, and puts the relevant slots that have no answer in a queue.
2. Code ends the intake when the limit for the intake is reached or when no slot can be asked about (INTAKE-2).
3. Otherwise, the model receives the description, the answers so far and the slots that it may ask about, with the user's notes and the entries of `guidance.yaml` for those slots (FACT-6), as data, and ends the step by calling `ask`.
4. Code enforces the limits.

If the model does not make a valid `ask` call, code asks about the next slot in the queue with its default question text, or ends the intake if the queue is empty.

**INTAKE-2.** The model may ask only about slots that are relevant and that are either not asked yet or answered "not sure" because the user does not understand the question (INTAKE-6). It may ask about such a slot again, up to the limit per slot. A slot answered "not sure" because the user does not know the fact is not asked again and stays open.

**INTAKE-3.** The limits are two questions per slot, where the form's question is the first question about a slot on the form, and ten follow-up questions per intake. When the limit for the intake is reached, code finishes the intake. When an intake ends, relevant slots that still have no answer are treated as open.

**INTAKE-4.** The model chooses which slot to ask about and writes the question. It cannot add a slot or an allowed value. The user's text is given to the model as data in the user message, never as part of the system prompt.

**INTAKE-5.** The confirmation screen shows every recorded value with the labels from the schema, and lists the open slots first, each slot answered "not sure" with its reason and its note (INTAKE-6). The user may change any value, and may answer an open slot by choosing one of its allowed values, under the last question asked about the slot, or its default question when none was asked. Each change is recorded at once, as in INTAKE-1, with no model call and no new question (INTAKE-3). From the result, the user can return to this screen; a change ends the confirmation, and the result shows again when the user confirms. The memo is built only from the confirmed answers and the description.

**INTAKE-6.** When the user answers "not sure", on the form or to a follow-up question, the user chooses a reason, "I don't understand the question" or "I don't know this about the product", and may add a note of at most 500 characters. The web app sends the answer only with a reason. A "not sure" answer that reaches the service without a reason counts as "I don't know this about the product". The reason and the note belong to the slot, and a later answer about the slot replaces them. When the model may ask about the slot again, it receives the note as data in the user message (INTAKE-4).

### Intake tools

The tool changes only the intake state.

| ID | Tool | Inputs | On success | On failure |
| --- | --- | --- | --- | --- |
| TOOL-1 | `ask` | slot id, the question as three texts (an explanation, the question and what each answer means), options each linked to an allowed value, the entries of the slot's guidance that are about the user's text in groups, each group with a line that names the parts of the user's text that its entries are about, and a check line (RESP-5) | The question is recorded with the groups, their entries and the entries' quotes and sources, and shown to the user, and the step ends. | `invalid_slot` if the slot does not exist; `not_askable` if the slot is not relevant, has an answer other than "not sure", or was answered "not sure" because the user does not know the fact; `invalid_option` if the options do not link each allowed value of the slot exactly once; `limit_reached` if the limit for the slot or for the intake is reached. |

Code leaves out an entry id that is not an entry of the slot and an entry named a second time, and a group without a line or without an entry left, and records the question with the other groups and entries. It keeps the check line only for a slot with entries, and the explanation only for a slot that had a question before.

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
- the category (Terms)
- the citation and the link (MEMO-7)
- the quoted clause (MEMO-8)
- the date from which the obligation applies
- the status: definite, or conditional on a named open slot (VALID-2)
- what the clause means for this product
- one action
- the judge's reason
- the slot values that decided it
- the validation mark (VALID-1), which is empty at first

**MEMO-6.** The memo has three parts, in this order: the obligations that apply, the answers to check, and the obligations that may also apply. The first part holds the results that the answers decide, grouped by regulation, then by role, then by chapter, with the rows of each result that applies. The second part shows each open slot once and, for a high-risk result for a point of Annex III, whether the product's intended use is one of the uses listed under that point, in the order of the number of conditional rows that depend on each, most first; in a tie, the listed use comes first, then the slots in schema order. The third part shows each conditional row once, under the first item of the second part that it depends on, and names any other item that it depends on. When nothing is open, the memo has only the first part, with a line that nothing is left to check. The planned changes follow the three parts, in a part of their own (QA-12). If the result of a gate is conditional, every row that depends on that gate is conditional on the same slot.

**MEMO-7.** Every row links to the official text on EUR-Lex. The link opens at the right paragraph and highlights the text of the unit.

**MEMO-8.** Every row quotes the unit's text word for word from the stored regulation text, so the user can check the row even if the link does not work. A row whose unit is a unit that its result quotes, such as AI Act Article 50(2) for the marking of generated content, links it, and the quote shows once, with the result.

**MEMO-9.** Besides the rows, every memo shows the open slots, in its second part (MEMO-6), the list in SCOPE-3 of what the system does not cover, and one line that says the memo maps obligations to clauses and is not legal advice.

**MEMO-10.** The user can download the memo as a Markdown file and as a PDF file. The web app makes both from the result and the sentences of the screen, so that the files and the screen say the same; nothing is sent from the tool, and no file is stored. The user chooses the rows, all or those of one category, also of the planned changes, the quotes or only the links, and the meanings or only the actions; every result and every answer to check stays. The choices and the two downloads open in a dialog over the result, which stays open after a download. A file starts with the title "Obligations memo", the day on which it is made, the description and the answers. Then follow the three parts of MEMO-6, each row as a section of its own, with its label as its heading, its result, category, citation as a link, date, status and what it depends on, the quote, the meaning and the action; then the planned changes (QA-12), each under its label, with its rows as such sections, each starting with the label of its change, and the rows whose status would change and those that would no longer apply, each with the label; and then "What the tool does not check yet". It ends with the line on legal advice (MEMO-9), the official texts that its quotes and links come from, and a note that EUR-Lex may open at the top of the page on a first visit. Without the texts of the rows, or without the key, a file has the rows without meanings and actions.

**MEMO-11.** The result screen has a bar that stays in view while the page scrolls, with All, Legal, Technical and Organisation. All is chosen when the result opens, and the choice is not stored. A category shows in each part only the rows of that category, by the rule of a file of one category (MEMO-10): every result and every answer to check stays, and a result that has rows, none of them of the category, says so in place of its rows. A line in the bar and the counts in the list of results count only the rows that show; the summary under the title keeps the totals. The part of the planned changes shows their rows of the category, each with the label of its change; the line in the bar counts only the result's rows, and the line of a planned change with its numbers keeps its totals.

## 6. Validation

**VALID-1.** Each row has a validation mark: empty, confirmed or disputed. Only the user sets or changes it.

**VALID-2.** The system never answers an open question itself, and there is no handover to a human. It shows the question to the user as an open slot or a conditional row. A conditional row states the question, the result for yes, and the result for no.

## 7. Response requirements

**RESP-1.** The action is one task that an engineer can start on, and it refers to the facts the user gave. It is a task of its row's category (Terms), and for a legal row whose obligation needs no legal drafting, a legal assessment. It does not repeat the clause in other words. It states nothing about the product that the description, the answers or the notes do not state. When the obligation needs legal drafting, such as a contract or a policy, the action says so.

**RESP-2.** When a question uses a term that the regulation defines, it shows the definition from the regulation.

**RESP-3.** The memo and the questions use direct language without filler words. They use the regulation's own terms where the exact term matters, and plain words elsewhere.

**RESP-4.** A question that the model writes asks about the same fact as its default question and keeps each of its conditions. It states nothing about the product that the description or the user's notes do not state, and it does not suggest which answer applies. It is easier for this user to answer than the default question: it names the product's own parties and data where the default question uses general terms, or it says what an answer means for this product.

**RESP-5.** A question that the model writes about a fact with entries in `guidance.yaml` (FACT-6) shows each of those entries that is about data or a situation that the description or the user's notes name, and no other entry. The model gives these entries in groups, one group for each part of the user's text, or one group for several parts when the same entries are about them, with each entry in one group and no two groups about the same part, and writes one line for each group that names its parts. The screen shows the line once, above the quotes of the group's entries. The model may add one check line: it names data or a situation in the user's text that no shown entry covers, or a detail that decides and that the user's text does not give, and says what to check. Code adds the quotes and the source of each entry, so the model writes no quote. RESP-4 applies to the question and to these lines, not to the quotes: a line presents its entries as cases from the guidance, never as the user's case or as the answer. The quotes are shown as guidance, not as law, and the user chooses the answer.

**RESP-6.** A question is shown under the label of its fact as its heading, in this order: the explanation, the examples and the check line (RESP-5), then the question and what each answer means, directly above the options. The model writes the explanation, the question and what each answer means as three texts, which together are the question of RESP-4. The explanation and what each answer means may be empty, and a default question has neither.

**RESP-7.** The meaning says in plain words what the clause requires of this product, with its parties and data where the clause uses general terms. It keeps each condition of the clause and decides none of them for the user, and it states nothing about the product that the description, the answers or the notes do not state. For a conditional row, it is written for the case in which the row applies and does not state the answer to what the row depends on.

**RESP-8.** An answer in the conversation (QA-3) answers the question that was asked, for this product: it names the product's parties, data and answers where the law uses general terms, and gives what the result does not show by itself. It states nothing about the product that the description, the answers, the notes or the user's questions do not state.

## 8. Questions about the result

**QA-1.** For each open answer in the second part (MEMO-6), the result shows, for each of the answer's values, what the whole result would be with that value: each result whose status would change, the rows that would be added, removed or change their status, and the questions that would become open or no longer be asked. Code computes them from the same gates and rows, with the value recorded as a change on the confirmation screen records it (INTAKE-1, INTAKE-3), with no model, also without the key.

**QA-2.** When the service has the key, a panel to ask a question stays available beside the result, with the conversation so far, each question with its answer, in order, and the line of MEMO-9 above its field. A question has at most 500 characters, and an intake at most 20 questions. Without the key, no panel shows.

**QA-3.** A model answers each question from the description, the answers, the notes, the result and its rows with their texts, the earlier questions and answers, and what the tools return. The tools only read, and no question changes an answer or the result. The user's text is given to the model only as data in user messages (INTAKE-4).

**QA-4.** For a described change to the product, the answer names each question whose answer the change may change, with the value that it may take and the guidance entries that clarify it (FACT-6, RESP-5), and gives no answer in the user's place (VALID-2). The panel shows each such question's text with its entries, and the changes of those answers together as code computes them for QA-1, with each row that would be added or removed, its result, its category and its date. When the change touches a part that the result lists as not checked, the answer names that part with its link and does not decide it.

**QA-5.** The model never decides an open answer, the listed use, or a condition of Article 6(3), of a date or of a quoted article (VALID-2). A change that another answer would make is shown only as code computed it.

**QA-6.** Each citation in an answer is a link to EUR-Lex (MEMO-7). A quote is shown only when it occurs word for word in the stored copy of its article or annex, or in the point of Regulation (EU) 2026/1744 that changes or inserts it (MEMO-8). For an AI Act article that 2026/1744 changed or inserted, `article` gives the changed text, and the answer follows it. A guidance entry shows with its quotes and its source, as guidance and not as law (RESP-5).

**QA-7.** A question that asks for legal advice, about law outside the two regulations, or about a meaning of the law that is disputed gets the answer that the tool does not cover it, and what it can answer instead (SCOPE-3).

**QA-8.** A question gets at most 6 tool calls, no retry, a timeout for each call, and no new call after 60 seconds. When the model ends without `answer`, code reminds it once. When a limit ends the loop, the call fails or times out, or the model ends without `answer` after the reminder, the panel says that the question could not be answered, the question stays in the field, and the user can ask again. One log line for each question names the tools called and the reason the loop ended, and holds no text of the user.

**QA-9.** The conversation is stored with the intake. After a change of an answer it stays, and each earlier answer says that it was given for the earlier answers and shows the changes for the answers at the time of its question.

**QA-10.** From the answer to a described change, the user can add the change to the result as a planned change, with all the answers that it may change or those that the user ticks. A planned change never changes the recorded answers, which change only on the confirmation screen (INTAKE-5). Planned changes are not combined: each is computed for the recorded answers with its own answers, and a question that builds on an earlier change is one change.

**QA-11.** A planned change has a label, the change named in the user's words, which the model gives with its answer (TOOL-6); code uses the start of the question when the label is empty or longer than 60 characters. The user can rename a planned change, to 1 to 60 characters, or remove it.

**QA-12.** The result shows the planned changes in a part after the third part (MEMO-6), each under its label: the number of obligations that it would add and remove, the rows that it would add with their meanings and actions (GATE-5), the rows whose status would change and those that would no longer apply, each row with the label. Code computes each planned change as for QA-1, each time the intake is read, so a change of an answer computes it again; an answer of the change that can no longer be applied is named in its section.

### Conversation tools

Each tool only reads. The intake is the one of the address, never one that the model names.

| ID | Tool | Inputs | On success | On failure |
| --- | --- | --- | --- | --- |
| TOOL-2 | `contents` | `ai_act` or `gdpr` | each chapter, section, article and annex with its title; for the AI Act, which parts 2026/1744 changed or inserted | |
| TOOL-3 | `article` | regulation (`ai_act`, `gdpr`, `amending`), `article` or `annex`, a number ("26", "4a", "III"; a paragraph such as "3(3)" is ignored) | the text with its title, chapter and section; for a changed AI Act part, the text of each point that changes it; for an inserted part, its text from the point that inserts it | `not_found` |
| TOOL-4 | `guidance` | a fact id | the fact's entries with their ids, quotes and sources (FACT-6) | `unknown_fact` |
| TOOL-5 | `what_if` | one or more answers, each a fact id or label and a value id | each result whose status, open answers or Article 6(3) outcome changes, each row added, removed or with another status, the questions that become open or are no longer asked, and their counts (QA-1) | for each answer that cannot be applied: `unknown_fact`, `not_asked` (not relevant once the earlier answers are applied), `unknown_value` or `same_answer` |
| TOOL-6 | `answer` | the text, with each citation in square brackets; quotes, each with its regulation, kind and number; the ids of guidance entries; the answers that a change may change, each a fact id or label and a value id; the label of a change, at most 60 characters (QA-11) | ends the loop; code checks each quote, leaves out an unknown entry, and shows the rest | |
