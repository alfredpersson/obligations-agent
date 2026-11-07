# obligations-agent

obligations-agent turns a description of one AI product into an obligations memo. An engineer fills in a short form and answers a few follow-up questions. The memo has one row for every obligation that applies to the product under the EU AI Act and the GDPR. Each row gives the clause the obligation comes from, a link that highlights that clause in the official text, what the clause means for this product, and one concrete action. The engineer checks each row and marks it as confirmed or disputed.

The memo maps obligations to clauses. It is not legal advice.

## Status

Two documents describe the product:

- [docs/brief.md](docs/brief.md): who the product is for, what it must do for them, and which assumptions the design is based on.
- [docs/spec.md](docs/spec.md): how the product must behave.

`api/` holds the Python service and `web/` the Next.js web app. The service serves the fact schema, with four facts on the form and seven follow-up facts. It records the form answers of an intake, then asks the follow-up questions one at a time. A model chooses each follow-up question and writes its text and its option labels. A "not sure" answer can carry a reason and a note: the model asks about the slot once more, with the note, only when the question was unclear to the user. Code ends the intake. Without a key for the model, or when a call gives no valid question, the service asks about the next slot in schema order with its default text. Without a key, it asks about each slot once. The service also holds examples from official guidance for three facts, with stored copies of their sources in `docs/guidance/`. The model receives the examples of the facts that it may ask about and names the ones that are about the user's text, and the service adds them with their quotes and sources to the question. The model writes each question as three texts: an explanation, the question, and what each answer means. When the user confirms the answers, the service computes the result of eight gates from them: whether the GDPR applies, the roles of controller, processor, provider and deployer, high-risk under Annex III of the AI Act, and transparency when people interact with the product and when it generates content. Each result quotes the units that define it from stored copies of the Official Journal text in `docs/regulations/`, with a link that highlights the unit on EUR-Lex. The result has three parts. The first holds what applies, grouped by regulation: the GDPR, under the result that decides whether it applies, and the AI Act, which the result assumes to apply, each result with its main obligations as rows, each with its clause quoted and linked and the date from which it applies, with a link to the article that sets the date. The second holds the answers to check: each open answer with its question, the reason and the note of a "not sure" answer, what each answer would give and a link to it on the screen of the answers, and for a high-risk result whether the intended use is one of the uses listed under its point of Annex III, the one that the most obligations depend on first. The third holds the obligations that may also apply, each under the first answer that it depends on. After the result shows, a model (Sonnet 5.5) writes for each row what its clause means for the product and one action, once for the confirmed answers, and again after a change. A row shows its label and its action, and its meaning and its clause when the user opens it; without a key, the rows show only the obligations. From the result, the user downloads it as a Markdown file or a PDF file, all of it or the obligations of one category, with or without the quotes and the meanings; the web app makes both files in the browser, the PDF with pdfmake in the web app's fonts. Each row has a category, legal, technical or organisation, set in `gates.yaml`, which says who carries out its action: the result shows it as a coloured tag at the start of the action, or after the label where no action shows, and the model writes an action of that kind. The web app shows the product as a demo named Dutymap, with a header and a footer on every page; the footer says that the result maps the answers to articles of the AI Act and the GDPR and is not legal advice. It opens on a start page that says what the tool does, how to use it and what the user gets, with an excerpt of the result for an example product. From there the form opens empty for the user's own product, or filled in with the example product, a candidate-matching tool, whose fields and answers can be changed before the form is sent. The web app then shows each follow-up question, then a screen with all the answers, the open ones first, where the user changes any answer or answers an open one, with no model call; the result shows when the user confirms, and from the result the user returns to that screen, changes or completes answers, and confirms again. A follow-up question has the label of its fact as its heading, and shows its explanation, the examples and the check line before the question and what each answer means. It asks for a reason for each "not sure" answer, with an optional note, and shows the reasons and the notes with the open questions. Architecture decision records (ADRs) will go in `docs/`.

## Checks

CI runs the checks of both apps and the browser test on every pull request and on every push to main.

In `api/`:

```sh
uv sync --locked
uv run ruff check
uv run ruff format --check
uv run pyright
uv run pytest
```

`uv sync --locked` fails when `uv.lock` does not match `pyproject.toml`. A new version of a package is used only when it is at least 7 days old (`exclude-newer` in `api/pyproject.toml`).

In `web/`:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm install --frozen-lockfile` fails when `pnpm-lock.yaml` does not match `package.json`. The same 7-day rule applies (`minimumReleaseAge` in `web/pnpm-workspace.yaml`), and `pnpm lint` also fails on warnings.

The browser test in `web/` starts the service and the web app by itself, fills in the form in Chromium, answers the questions, changes and completes answers on the screen of the answers, and checks the result. It expects the default question texts. Outside CI it reuses a service that already runs on port 8000, so that service must run without the key. Install the browser once for each Playwright version, then run the test:

```sh
pnpm exec playwright install --only-shell chromium
pnpm e2e
```

The web app runs on the Node.js version in `web/.nvmrc`. With nvm, `nvm install` in `web/` installs that version and switches to it. pnpm switches by itself to the version in the `packageManager` field of `web/package.json`.

## Run

In `api/`:

```sh
uv run uvicorn obligations_agent.server:app --reload
```

The service then answers on http://127.0.0.1:8000. It keeps intakes in memory, so they are lost when the service stops. Without a key, it asks the follow-up questions with their default texts.

For questions written by a model (Claude Sonnet 5.5), put an Anthropic API key in `api/.env`, as one line `ANTHROPIC_API_KEY=...`, and start the service with that file. `.gitignore` keeps the file out of the repository.

```sh
uv run --env-file .env uvicorn obligations_agent.server:app --reload
```

The service writes one log line for each question. The line says whether the model wrote the question, or why the default text was used.

In `web/`, while the service runs:

```sh
pnpm dev
```

The web app then answers on the address that `pnpm dev` prints, by default http://localhost:3000. It forwards calls under `/api` to the service.

## Process

The repository is run with the process that a team would use. A part is checked in the list below when it is in place.

- [x] Instructions for coding agents in `AGENTS.md`, with a one-line `CLAUDE.md` that points to it.
- [x] Agent permissions and one hook, committed to the repository.
- [x] CI that installs from a fixed lockfile.
- [x] A branch ruleset that requires pull requests and passing checks.
- [x] A pull request template with a checklist that a pull request must pass before review, and a decision log.
- [ ] Decisions recorded as ADRs.
- [x] GitHub issues as the place where each part is specified in detail and its plan is reviewed before the work starts.
- [x] Two AI reviewers from different vendors, which comment and never merge.

One part is adapted because the project has one author. GitHub does not let an author approve their own pull request. The human review is therefore a self-review by the author, done line by line. The author confirms it in the pull request and writes down any findings there. The findings of the AI reviewers are input to that review and never the final decision.

Everything a teammate would need to review or continue the work goes in the repository: specifications, decisions, plans as issues, decision logs, agent tooling, benchmark data and results. Unedited planning output, plans that were replaced, and transcripts stay out. A rejected plan is kept as one line in a decision log.

AI assistance is disclosed in commit trailers and in the pull request template. The author is responsible for every merged document and every merged line, and can explain each of them.

## License

MIT. See [LICENSE](LICENSE).
