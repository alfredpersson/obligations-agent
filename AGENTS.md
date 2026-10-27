# AGENTS.md

Instructions for coding agents that work in this repository.

## Project

obligations-agent turns a description of one AI product into an obligations memo under the EU AI Act and the GDPR. Read these files before changing anything:

- `docs/brief.md`: who the product is for and which assumptions the design is based on.
- `docs/spec.md`: how the product must behave. Every requirement has an id, for example `INTAKE-3`.
- `README.md`: the process that every change follows.

`api/` holds the Python service, and `web/` holds the Next.js web app.

## Commands

CI runs the same commands, and all of them must pass before a pull request is opened.

In `api/`:

```sh
uv sync --locked
uv run ruff check
uv run ruff format --check
uv run pyright
uv run pytest
```

`uv run ruff format` fixes the formatting. `uv run uvicorn obligations_agent.server:app --reload` starts the service on http://127.0.0.1:8000. Without a key, the service asks the follow-up questions with their default texts. `uv run --env-file .env uvicorn obligations_agent.server:app --reload` starts it with the author's key in `api/.env`, so that a model writes the questions.

In `web/`:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm dev` starts the web app, which forwards calls under `/api` to the service. The browser test starts the service and the web app by itself. It reuses a service that already runs on port 8000, and it expects the default question texts, so that service must run without the key. Install its browser once for each Playwright version:

```sh
pnpm exec playwright install --only-shell chromium
pnpm e2e
```

## Rules

- No agent framework. The question loop, the rules, the retrieval and the memo steps are project code.
- Write the simplest code that meets the issue. Before adding a type or a helper, check whether the code base has one with the same purpose, and use it. Do not add a wrapper, class, setting or option that the issue does not need, such as a one-line function that only one place calls.
- Do not weaken a check to make it pass. This covers `# type: ignore`, `# noqa`, `eslint-disable` and `@ts-expect-error` comments, skipped or deleted tests, and changed settings for Ruff, pyright, pytest, ESLint, TypeScript, Vitest or CI. If a check seems wrong, stop and ask the author.
- Do not add a dependency without the author's approval. Add an approved one with `uv add` in `api/` or `pnpm add` in `web/`, so that the package list and the lockfile change together.
- When a change alters behavior that `docs/spec.md` describes, change the specification in the same pull request. Requirement ids stay in sequence without gaps.
- Secrets stay out of the repository and out of prompts.
- Do not read `api/.env`. Start the service without it, unless the author asks.

## Workflow

1. Work starts from one GitHub issue with the label `ready-for-agent`. Only the author sets that label.
2. Post the plan as a comment on the issue, and wait for the author's review before writing code.
3. Create a short branch from `main`, named `<type>/<short-name>`. The type is `feat`, `fix`, `docs` or `chore`. Never commit to `main`.
4. Write the tests from the acceptance criteria first, then the code.
5. When the tests pass, check the changed code for types and helpers that repeat existing ones and for code that can be simpler, and fix the findings within the scope of the issue. In Claude Code, `/simplify` runs this check.
6. Commit and push only when the author asks. Every commit message discloses AI assistance with a `Co-Authored-By` trailer.
7. Open a small pull request with the template in `.github/pull_request_template.md`. Fill in the decision log: what was tried and what was ruled out.
8. The author reviews and merges. Agents do not merge.

## Writing

Documents, issues, pull requests and commit messages use plain language. They do not use first person. Where a person must be named, write "the author".
