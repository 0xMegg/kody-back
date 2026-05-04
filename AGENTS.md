# Kody Backend Hermes Entry

Read order for fresh agents:

1. `.hermes/SOUL.md` — judgment posture.
2. `.hermes/USER.md` — user and collaboration preferences.
3. `.hermes/NEXT.md` — active backend handoff pointer.
4. `.hermes/MEMORY.md` — operational memory boundary.
5. `.hermes/policy/automation.md` — change classification and human-gate rules.
6. `.hermes/policy/promotion.md` — Core/project rule propagation.
7. `.hermes/policy/harness-review.md` — operating-layer review boundary.
8. `.hermes/policy/claude-cli.md` — Claude CLI invocation boundary.
9. `.hermes/wiki/pages/kody-backend-conventions.md` — backend implementation rules.
10. `.hermes/wiki/pages/kody-backend-state.md` — current backend state.
11. `.hermes/wiki/index.md` — knowledge index.

Precedence: `AGENTS.md` > `.hermes/policy/` > `.hermes/SOUL.md` > `.hermes/USER.md` > `.hermes/NEXT.md` > `.hermes/MEMORY.md` > `.hermes/wiki/`.

1. Verification is the completion condition. An unverified result is not done.
2. Protect environment files, Prisma schema/migrations, lockfiles, generated output, and server contract changes with a human gate.
3. Do not revert or clean pre-existing dirty files unless explicitly requested.
4. Behavior, ownership, permission, execution-flow, dependency, database, or project-judgment changes require a human gate.
5. Record important decisions and verification results in `.hermes/logs/log.md`.
6. No prior backend active legacy harness was found. Use `.hermes/wiki/pages/kody-backend-legacy-harness-summary.md` for cutover provenance.
