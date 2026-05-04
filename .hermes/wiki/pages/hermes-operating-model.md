# Hermes Operating Model

## Purpose

Hermes is a long-running operating agent with memory, skills, tools, MCP, gateway, and cron capabilities. It should be configured as a controlled operating system for repeated work, not as a large instruction file.

Hermes initially operates on this directory as its own reference project. When reused elsewhere, the same structure becomes the operating layer for that target project.

## Source Provenance

- Hermes Agent guide: `https://wikidocs.net/book/19414`
- Boris Cherny / Claude Code workflow interpretation: `https://wikidocs.net/blog/@jaehong/8587/`
- CLAUDE.md anti-pattern article: `https://siosio3103.medium.com/당신의-claude-md는-아마-잘못되었을-겁니다-boris-cherny가-절대-하지-않는-7가지-실수-f2201efd098b`
- Karpathy LLM Wiki gist: `https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f`
- Harness essence: `philosophy.md`
- Automation boundary: `automation-boundary.md`

Note: inherited source documents may mention upstream harness-forge paths that are not present in this Hermes artifact. Treat those paths as provenance from the upstream source, not active local dependencies.

## Core Design

Hermes uses small operating rules plus separate durable layers:

- `AGENTS.md`: short triggers and invariants.
- `SOUL.md`: stable identity and judgment philosophy.
- `USER.md`: collaboration preferences.
- `MEMORY.md`: agent-managed operational memory.
- `raw/`: immutable source material and source manifest.
- `wiki/`: synthesized durable knowledge with provenance.
- `skills/`: project-specific repeatable procedures.
- `policy/`: automation and permission boundaries.
- `logs/`: decision traces, verification results, and run notes.

## Why Not One Large AGENTS.md

Long instruction files create context rot. Hermes should not carry every rationale, example, and procedure in working context. `AGENTS.md` should route the agent to the correct artifact instead of becoming the artifact.

## Memory vs Wiki

`MEMORY.md` is for operational observations about working with the user and the environment. It is not a project knowledge base.

`wiki/` is for durable synthesized knowledge derived from raw sources. A wiki page without provenance is not valid durable knowledge.

## Skills vs Wiki

Skills are executable procedures. Wiki pages are reference knowledge.

Promotion rule:

- Repeated procedure -> `skills/`
- Repeated knowledge -> `wiki/`
- Mandatory rule -> `AGENTS.md` or `policy/`
- Operational observation -> `MEMORY.md`

## Automation Boundary

Automation exists to reduce repeated manual judgment, not to replace project judgment.

Auto-apply is limited to changes that are additive, reversible, and measurable. Changes that alter behavior, ownership, permissions, execution flow, or project judgment require a human gate. Destructive or high-risk changes are blocked unless the user approves a scoped plan.

## Core Promotion Boundary

Hermes Core may absorb project-proven operating rules when they prevent a named failure, have logged evidence, and remain product-agnostic. This is reverse propagation from a downstream project into Core.

Core updates propagate forward by proposal only. A downstream project may adopt, defer, or opt out with a recorded reason; Core must not silently overwrite project-specific judgment.

See `policy/promotion.md` for the active promotion and propagation gates.

## Operating Loops

Execution loop:

1. Propose: classify risk and reversibility.
2. Apply: auto-apply, human-gate, or block according to `policy/automation.md`.
3. Verify: confirm with measurable evidence where possible.
4. Record: write important decision and verification trace to `logs/log.md`.

Knowledge loop:

1. Ingest: add or reference raw source material.
2. Synthesize: update a wiki page with provenance.
3. Index: update `wiki/index.md`.
4. Log: append a short entry to `wiki/log.md`.
5. Lint: check missing citation, stale claim, orphan page, and contradiction.

## Glossary

- Additive: adds a new rule, note, scaffold, or page without changing existing behavior.
- Reversible: can be undone cheaply without data loss, downtime, or broad downstream repair.
- Measurable: has a concrete check that can detect whether the change helped or harmed.
- Verification: evidence that the requested behavior or artifact works as intended, not just a plausible explanation.
- Blast radius: the scope of damage if the agent chooses wrong, including data, behavior, permissions, user time, and downstream projects.
- Meta work box: an explicit budget for improving Hermes itself; outside the box, record the idea and return to product work.
- Human gate: stop and ask the user to decide before applying the change.

## Log Boundaries

- `logs/log.md`: decision trace, execution trace, verification result, and policy-relevant events.
- `wiki/log.md`: wiki page creation and modification history only.

## Self-Application

Changes to Hermes itself are subject to `policy/automation.md`. Editing rules, policy, skills, execution modes, or source material is not exempt because the target is Hermes.

## MVP Scope

Start small:

- Keep cron and gateway disabled until a manual loop has worked repeatedly.
- Avoid broad MCP exposure. Use include filtering.
- Do not pre-fill skills. Promote procedures only after repeated use.
- Do not introduce multi-agent roles until a real permission boundary requires it.
- Start with manual wiki lint before automating it.
