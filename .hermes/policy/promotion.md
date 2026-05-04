# Hermes Promotion Policy

Hermes Core evolves from project-proven operating rules. It does not absorb product knowledge, and it does not push changes into projects without review.

This policy governs:

- Reverse propagation: project Hermes layer -> Hermes Core.
- Forward propagation: Hermes Core -> downstream project Hermes layer.

## Source Provenance

- `policy/automation.md`.
- `wiki/pages/hermes-operating-model.md`.
- `/Users/mero/Dev/13.claude/workouts/divebase/.hermes/logs/log.md`.
- `/Users/mero/Dev/13.claude/workouts/divebase/.hermes/policy/workflow.md`.
- `/Users/mero/Dev/13.claude/workouts/honbabseoul/.hermes/logs/log.md`.
- Claude review on 2026-05-03 for Core promotion and propagation policy.

## Statuses

Use the smallest status set that supports review:

- Local: exists only in one project.
- Core candidate: recorded in a project log as possibly reusable.
- Incubating: accepted into Core as opt-in guidance.
- Recommended: Core suggests adoption by default, but projects may opt out with a recorded reason.
- Retired: preserved as negative knowledge so the same rule is not re-derived.

Do not create mandatory Core rules through this policy. Changes to `AGENTS.md`, `SOUL.md`, ownership, permissions, or execution flow require a separate explicit human-gated amendment.

## Reverse Propagation

A project rule may become a Core candidate only when all are true:

- It is an operating-layer rule, not product knowledge.
- It prevents a named failure mode or repeated judgment cost.
- It has logged provenance from real project work.
- It has survived at least two relevant task closeoffs or one explicit user-gated harness decision.
- It can state what kind of project it may hurt.
- It has a clear target location in Core.
- It has a verification method or adoption check.
- It does not conflict with existing Core policy.

Promotion from candidate to incubating requires human approval plus Claude and Codex review when available. Record the decision, evidence, reviewer result, and verification in `logs/log.md`.

Promotion from incubating to recommended requires at least one additional downstream project adoption or an explicit human-gated decision that the rule is broadly applicable despite limited project count.

## Forward Propagation

Core updates are pull-only. Core may propose adoption; it must not silently rewrite a downstream project.

Before applying a Core rule to a project, confirm:

- The rule does not overwrite project-specific judgment.
- The change is additive or clearly reversible.
- The target project has no conflicting local policy.
- The adoption or opt-out reason can be recorded in the project log.
- Verification or a checklist exists for the changed operating behavior.

Incubating rules are opt-in. Recommended rules should be surfaced during planning or Hermes setup, but adoption still requires project-level review. Retired rules should be surfaced only when a project still carries the old rule.

## Target Locations

Choose the narrowest Core location:

- `policy/`: boundaries, gates, permissions, ownership, automation, promotion.
- `wiki/`: durable operating knowledge with provenance.
- `skills/`: repeated executable procedures with stable inputs, outputs, and verification.
- `AGENTS.md`: only short invariants that every fresh agent must load.
- `SOUL.md`: only stable judgment posture.
- `logs/log.md`: decisions, transition evidence, and verification.

Do not promote a project rule into `AGENTS.md` or `SOUL.md` merely because it is useful. Most promoted rules belong in `policy/`, `wiki/`, or `skills/`.

## Blocked Patterns

- Product facts or project decisions promoted as Core rules.
- One-off workaround promoted without repeat evidence.
- Bundled promotions where strong and weak rules are reviewed together.
- Automatic Core-to-project sync.
- Cross-project copying that bypasses Core review.
- Rules that increase context load without preventing a named failure.
- Promotion based on plausibility rather than logged evidence.
- Deleting failed promotions instead of retiring them with rationale.

## Acceptance Question

Before promoting or propagating a rule, ask:

"Is this a reusable operating invariant that prevents a known failure, and can a downstream project reject it without breaking Hermes Core?"

If the answer is unclear, keep it local or incubating.
