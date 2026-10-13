#!/usr/bin/env python3
"""PreToolUse hook for the Bash tool.

Blocks three kinds of commands and tells the agent why:
- a git command with --no-verify, which skips the commit hooks
- a forced git push
- merging a pull request, which only the author does

Exit code 2 blocks the command. The text on stderr is shown to the agent.
"""

import json
import re
import sys

RULES = [
    (
        # --no-verify anywhere in a git command, or its short form -n before the commit message
        r"\bgit\b[^|;&]*\s(--no-verify\b|commit\b[^|;&\"']*\s-[a-zA-Z]*n[a-zA-Z]*\b)",
        "--no-verify skips the commit hooks. Fix what the hook reports.",
    ),
    (
        r"\bgit\b[^|;&]*\spush\b[^|;&]*\s(--force\b|-[a-zA-Z]*f[a-zA-Z]*\b)",
        "A forced push rewrites history on GitHub. Add a new commit.",
    ),
    (
        r"\bgh\s+pr\s+merge\b",
        "Agents do not merge pull requests. The author merges.",
    ),
]

command = json.load(sys.stdin).get("tool_input", {}).get("command", "")
for pattern, reason in RULES:
    if re.search(pattern, command):
        print(f"Blocked: {reason}", file=sys.stderr)
        sys.exit(2)
