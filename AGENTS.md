# AGENTS.md

Instructions for coding agents that work in this repository.

## Project

obligations-agent turns a description of one AI product into an obligations memo under the EU AI Act and the GDPR. Read these files before changing anything:

- `docs/brief.md`: who the product is for and which assumptions the design is based on.
- `docs/spec.md`: how the product must behave. Every requirement has an id, for example `INTAKE-3`.
- `README.md`: the process that every change follows.

`api/` holds the Python service. `web/` will hold the Next.js web app.

## Commands

Run these in `api/`. CI runs the same five commands, and all of them must pass before a pull request is opened.

```sh
uv sync --locked
uv run ruff check
uv run ruff format --check
uv run pyright
uv run pytest
```

`uv run ruff format` fixes the formatting.

## Rules

- No agent framework. The question loop, the rules, the retrieval and the memo steps are project code.
- Do not weaken a check to make it pass. This covers `# type: ignore`, `# noqa`, skipped or deleted tests, and changed settings for Ruff, pyright, pytest or CI. If a check seems wrong, stop and ask the author.
- Do not add a dependency without the author's approval. Add an approved one with `uv add`, so that `pyproject.toml` and `uv.lock` change together.
- When a change alters behavior that `docs/spec.md` describes, change the specification in the same pull request. Requirement ids stay in sequence without gaps.
- Secrets stay out of the repository and out of prompts.

## Workflow

1. Work starts from one GitHub issue with the label `ready-for-agent`. Only the author sets that label.
2. Post the plan as a comment on the issue, and wait for the author's review before writing code.
3. Create a short branch from `main`, named `<type>/<short-name>`. The type is `feat`, `fix`, `docs` or `chore`. Never commit to `main`.
4. Write the tests from the acceptance criteria first, then the code.
5. Commit and push only when the author asks. Every commit message discloses AI assistance with a `Co-Authored-By` trailer.
6. Open a small pull request with the template in `.github/pull_request_template.md`. Fill in the decision log: what was tried and what was ruled out.
7. The author reviews and merges. Agents do not merge.

## Writing

Documents, issues, pull requests and commit messages use plain language. They do not use first person. Where a person must be named, write "the author".
