## Summary

<!-- What the change does and why, in one or two sentences. Link the issue, for example "Closes #12". -->

## Testing

<!-- What was run, and the result. CI covers the five commands in the README. Add evidence for anything that CI does not cover. -->

## AI involvement

<!-- The tools that were used. For work written by an agent, add the decision log: what it was trying to do and what it ruled out. -->

## Risk tier

<!--
Low, medium or high, with one sentence of reason.
High: CI, the checks and their settings, agent configuration, secrets, stored user data, and code where text from a user reaches a model.
Medium: product logic, and anything else that changes behavior.
Low: documents and text.
-->

## Before review

- [ ] The summary says what the change does and why.
- [ ] The diff has fewer than about 400 changed lines, not counting generated files such as `uv.lock`.
- [ ] The tests ran, and the result is under Testing.
- [ ] The changed code was checked for types and helpers that repeat existing ones and for code that can be simpler (see the workflow in `AGENTS.md`), and the decision log says what was changed or left.
- [ ] The decision log is filled in.
- [ ] The risk tier is stated.

## Self-review

- [ ] The author read the full diff line by line.
