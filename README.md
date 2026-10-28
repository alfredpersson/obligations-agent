# obligations-agent

obligations-agent turns a description of one AI product into an obligations memo. An engineer fills in a short form and answers a few follow-up questions. The memo has one row for every obligation that applies to the product under the EU AI Act and the GDPR. Each row gives the clause the obligation comes from, a link that highlights that clause in the official text, what the clause means for this product, and one concrete action. The engineer checks each row and marks it as confirmed or disputed.

The memo maps obligations to clauses. It is not legal advice.

## Status

Two documents describe the product:

- [docs/brief.md](docs/brief.md): who the product is for, what it must do for them, and which assumptions the design is based on.
- [docs/spec.md](docs/spec.md): how the product must behave.

`api/` holds the Python service and `web/` the Next.js web app. The service serves the fact schema, with three facts on the form and six follow-up facts. It records the form answers of an intake, then asks the follow-up questions one at a time. A model chooses each follow-up question and writes its text and its option labels. A "not sure" answer can carry a reason and a note: the model asks about the slot once more, with the note, only when the question was unclear to the user. Code ends the intake. Without a key for the model, or when a call gives no valid question, the service asks about the next slot in schema order with its default text. Without a key, it asks about each slot once. The service also holds examples from official guidance for three facts, with stored copies of their sources in `docs/guidance/`; questions do not show them yet. The web app shows the form, then each follow-up question, then the recorded answers. It asks for a reason for each "not sure" answer, with an optional note, and shows the reasons and the notes with the open questions. Architecture decision records (ADRs) will go in `docs/`.

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

The browser test in `web/` starts the service and the web app by itself, fills in the form in Chromium, and checks the screen with the recorded answers. It expects the default question texts. Outside CI it reuses a service that already runs on port 8000, so that service must run without the key. Install the browser once for each Playwright version, then run the test:

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
