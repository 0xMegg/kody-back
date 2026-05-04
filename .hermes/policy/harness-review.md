# Hermes Harness Review Policy

Status: Incubating.

Harness or Hermes operating-layer changes should receive available peer-agent review before the change takes effect, after any required human gate.

Current peer-agent reviewers are Claude and Codex. This reviewer set is operational, not part of the invariant.

## Source Provenance

- `/Users/mero/Dev/13.claude/workouts/divebase/.hermes/logs/log.md`.
- `/Users/mero/Dev/13.claude/workouts/divebase/.hermes/policy/workflow.md`.
- `policy/automation.md`.
- `policy/promotion.md`.
- Claude and Codex review on 2026-05-03.

## Scope

This policy applies to:

- Edits to `policy/`, `AGENTS.md`, `SOUL.md`, `skills/`, hooks, or adapters.
- Any change, wherever located, that affects permissions, ownership, execution flow, handoff structure, project memory boundaries, automation boundaries, or agent operating authority.

Typo-only documentation or wiki edits are excluded unless they affect authority, procedure, or active operating guidance.

## Review Standard

Peer-agent review checks:

- Whether the change stays inside the human-approved scope.
- Whether it fits `policy/automation.md` and `policy/promotion.md`.
- Whether it changes behavior, ownership, permissions, execution flow, or project judgment.
- Whether verification and logging are sufficient for the changed operating surface.

## Recording

Record the decision, source evidence, review result, and verification in `logs/log.md`.

Downstream projects may adopt, defer, or opt out of this incubating policy under `policy/promotion.md`.
