# Hermes Memory Index

This file is reserved for agent-managed operational memory.

Do not use it as a project knowledge base, decision log, or wiki.

Allowed memory:

- Stable user collaboration preferences not already captured in `USER.md`.
- Repeated operational observations useful for the next session.
- Short feedback patterns that affect how Hermes should work.
- Pointers to durable artifacts elsewhere.

Boundary with `USER.md`:

- `USER.md` stores preferences the user explicitly declared.
- `MEMORY.md` stores patterns the agent observed across work.
- If they conflict, `USER.md` wins.

Do not store:

- Raw source material. Use `raw/`.
- Synthesized domain or project knowledge. Use `wiki/`.
- Decision rationale. Use `logs/log.md` or `wiki/pages/`.
- Procedures. Use `skills/`.
- Automation rules. Use `policy/automation.md`.

Initial state: no additional operational memories recorded.
