# Hermes Automation Policy

Hermes automation reduces repeated manual judgment. It does not replace project judgment.

This policy applies to Hermes files themselves and to any downstream project where Hermes is used.

## Classification

Classify every proposed system improvement before applying it:

- Auto-apply candidate
- Human gate required
- Blocked by default

## Auto-Apply Candidate

A change may be auto-applied only when all are true:

- Additive.
- Reversible.
- Measurable.
- Low risk.
- Has a concrete target file, trigger condition, and exact action.
- Does not modify existing behavior.
- Does not alter ownership, permissions, execution flow, or project judgment.

## Human Gate Required

Require explicit user judgment when any are true:

- The change adds or modifies a skill, hook, config, execution mode, template category, or automation policy.
- The effect is qualitative or not visible to the current metric.
- The change affects project-specific workflow, context policy, operating mode, or ownership.
- The change can increase meta work even if it improves system quality.
- The next action is ambiguous and the blast radius is high.

## Blocked By Default

Block unless the user explicitly approves a scoped plan:

- Deleting rules, skills, hooks, templates, policy, source material, or logs.
- High-risk changes.
- Changes that lower measured quality or remove verification.
- Modifications to existing behavior without a narrow plan.
- Broad placeholder substitution or sync behavior changes without downstream smoke verification.
- Destructive operations such as reset, wipe, mass rename, or irreversible data deletion.

## Acceptance Question

Before automating a Hermes improvement, ask:

"If this applies without a human decision, what is the worst plausible wrong outcome, and can Hermes detect or reverse it cheaply?"

If the answer is unclear, use the human gate.
