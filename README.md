# obligations-agent

obligations-agent turns a description of one AI product into an obligations memo. An engineer fills in a short form and answers a few follow-up questions. The memo has one row for every obligation that applies to the product under the EU AI Act and the GDPR. Each row gives the clause the obligation comes from, a link that highlights that clause in the official text, what the clause means for this product, and one concrete action. The engineer checks each row and marks it as confirmed or disputed.

The memo maps obligations to clauses. It is not legal advice.

## Status

The repository holds no code yet. Two documents describe the product:

- [docs/brief.md](docs/brief.md): who the product is for, what it must do for them, and which assumptions the design is based on.
- [docs/spec.md](docs/spec.md): how the product must behave.

The repository will have two apps, `api/` in Python and `web/` in Next.js. Architecture decision records (ADRs) will go in `docs/`.

## Process

The repository is run with the process that a team would use. A part is checked in the list below when it is in place.

- [ ] Instructions for coding agents in `AGENTS.md`, with a one-line `CLAUDE.md` that points to it.
- [ ] Agent permissions and one hook, committed to the repository.
- [ ] CI that installs from a fixed lockfile.
- [ ] A branch ruleset that requires pull requests and passing checks.
- [ ] A pull request template with a checklist that a pull request must pass before review, and a decision log.
- [ ] Decisions recorded as ADRs.
- [ ] GitHub issues as the place where each part is specified in detail and its plan is reviewed before the work starts.
- [ ] Two AI reviewers from different vendors, which comment and never merge.

One part is adapted because the project has one author. GitHub does not let an author approve their own pull request. The human review is therefore a self-review by the author, done line by line. The author confirms it in the pull request and writes down any findings there. The findings of the AI reviewers are input to that review and never the final decision.

Everything a teammate would need to review or continue the work goes in the repository: specifications, decisions, plans as issues, decision logs, agent tooling, benchmark data and results. Unedited planning output, plans that were replaced, and transcripts stay out. A rejected plan is kept as one line in a decision log.

AI assistance is disclosed in commit trailers and in the pull request template. The author is responsible for every merged document and every merged line, and can explain each of them.

## License

MIT. See [LICENSE](LICENSE).
