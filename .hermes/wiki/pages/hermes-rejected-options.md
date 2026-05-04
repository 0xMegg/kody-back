# Hermes Rejected Options

Decisions already made against, with the reason and the condition that would justify revisiting. The goal is to avoid re-deriving the same conclusions in later sessions.

## Source Provenance

- `wiki/pages/hermes-operating-model.md`
- `policy/automation.md`
- `raw/source-manifest.md`
- `philosophy.md`
- `automation-boundary.md`

## Rejected Options

### 1. Put rationale, examples, and procedures into `AGENTS.md`

Rejected because long instruction files create context rot and turn `AGENTS.md` into the artifact instead of a router.

Default: `AGENTS.md` stays one screen of triggers and invariants. Put rationale in `wiki/`, procedures in `skills/`, and policy detail in `policy/`.

Revisit only if Hermes gains a proven mechanism that loads targeted sections without increasing working-context noise.

### 2. Use `MEMORY.md` as a project knowledge base

Rejected because `MEMORY.md` is agent-managed operational memory. Durable project or domain knowledge belongs in `wiki/` with provenance so it can be reviewed, cited, and linted.

Default: operational observations go to `MEMORY.md`; durable synthesized knowledge goes to `wiki/`.

Revisit only if Hermes memory becomes citation-aware, reviewable, and separable from operational memory.

### 3. Pre-fill `skills/` with anticipated procedures

Rejected because speculative skills become stale instructions and add maintenance surface before they prove useful.

Default: promote a skill only after repeated manual use with clear inputs, outputs, and verification criteria.

Revisit per individual skill when repetition has been observed.

### 4. Introduce multi-agent roles in MVP

Rejected because roles are useful when they enforce a real permission, context, or ownership boundary. Before that point they mostly add coordination cost.

Default: start with a single Hermes operating model.

Revisit when a concrete task requires a boundary a single agent cannot hold safely.

### 5. Enable cron and gateway in MVP

Rejected because scheduled and externally triggered runs amplify any error in the manual loop.

Default: keep cron and gateway disabled until the manual propose/apply/verify/record loop is stable for the same class of task.

Revisit when a repeated task has succeeded manually several times and has clear verification output.

### 6. Expose broad MCP tool surfaces

Rejected because every exposed tool adds attack surface, context cost, and selection risk even when unused.

Default: add MCP servers and tools only for specific tasks, scoped with include filtering.

Revisit when a concrete task needs a specific server or tool.

### 7. Automate wiki lint in MVP

Rejected because unstable lint rules create false positives and train the operator to ignore lint output.

Default: start with manual lint checks for missing citation, stale claim, orphan page, and contradiction.

Revisit when the manual lint checklist is stable enough to automate.

### 8. Create wiki pages without provenance

Rejected because a synthesized page without source provenance is indistinguishable from hallucinated durable knowledge during later review.

Default: no durable wiki page exists without raw provenance.

Revisit only if the page is explicitly marked as a temporary draft and never used as authority.

### 9. Allow open-ended Hermes self-improvement

Rejected because meta work expands to fill available time and displaces implementation work.

Default: meta work needs a box. If it does not block execution, record it and return to product work.

Revisit when a Hermes improvement directly blocks execution or verification on a real task.

### 10. Allow LLM-judged auto-apply without explicit boundary

Rejected because plausibility is not measurement. Auto-apply requires the additive, reversible, measurable test in `policy/automation.md`.

Default: outside the policy boundary, changes are human-gated or blocked.

Revisit only by changing `policy/automation.md` through an explicit human-gated decision.

## Use Rule

Before reopening one of these decisions, check whether its revisit condition has actually fired. If it has, update this page in the same change that lifts or narrows the rejection.
