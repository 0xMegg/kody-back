# Imweb Warning Persistence Overnight Completion Plan

> **For Hermes/Ouroboros:** execute this with a background `/goal`/Ouroboros run. Keep side effects inside the explicitly bounded scope below.

**Goal:** Make the KODY backend Imweb warning-persistence slice operationally complete after PR #3 merge: verified, synced, documented, and—where safely possible—applied/smoked on dev without performing a full product import write.

**Current state verified before plan:**
- Backend repo: `/Users/qnb/dev/workouts/kody-workspace/kody-backend`
- Current branch: `task/5.5`
- PR #3 `feat(product-import): persist Imweb warning evidence` is `MERGED` into `task/5.5`.
- Local backend worktree is clean.
- Orchestration root has pre-existing dirty/untracked planning/docs artifacts; do not delete or reset them.

## Scope

### In scope
1. Sync local `task/5.5` with `origin/task/5.5` and confirm PR #3 commit is present.
2. Run mechanical gates in backend:
   - dependency/install sanity if needed,
   - Prisma generate/validate/status as applicable,
   - full test suite,
   - lint/typecheck/build if package scripts exist,
   - `git diff --check`.
3. Re-run the real Imweb XLSX dry-run using the actual importer path and save evidence:
   - source checksum / row count,
   - create/update/conflict/fail counts,
   - top warning codes,
   - category fallback count,
   - no DB mutation statement.
4. Apply the warning-persistence migration to the **dev** DB only if all of these are true:
   - the existing project-approved dev path is available without revealing secrets,
   - target identity is clearly `kody-oms-dev` / dev backend DB, not prod,
   - migration status shows only expected pending migrations,
   - no command asks for secrets/2FA/sudo from the sleeping user.
5. After any dev migration, run a rollback-only smoke that proves warning persistence and category mapping provenance, then rolls back and proves no durable smoke rows remain.
6. Update backend `.hermes/logs/log.md` and/or an evidence markdown file with secret-safe outputs.
7. If gaps are found in code/tests/docs, fix them in a small follow-up branch/PR and verify it.

### Explicitly out of scope unless a separate explicit approval already exists in repo policy/evidence
- Prod DB migration.
- Full XLSX persistent write import to dev/prod Product tables.
- Destructive cleanup: no `git reset --hard`, `git clean`, dropping DBs, deleting existing docs/artifacts, or force pushes.
- Secrets exposure or credential generation.
- Merging new follow-up PRs without successful verification.

## Acceptance criteria

1. The backend branch is synced and PR #3 is confirmed merged/present.
2. All available backend gates pass, or any blocker is reported with exact command/output and no fabricated success.
3. Evidence exists under `.hermes/evidence/` or `.hermes/logs/log.md` proving importer warnings are persisted/represented by code and tests.
4. If dev migration is performed: direct schema evidence shows `ImportRow.warnings`, `ImportRow.warningCodes`, `ImportRow.reviewRequired`, and `Product.categoryMappingSource`; rollback smoke proves no durable smoke data remains.
5. If dev migration is not performed: the run clearly states the blocker and exactly what side effects did not occur.
6. Final Discord report is Korean, bottom-line first, and lists: done, verification output, side effects performed, side effects not performed, remaining approval gates.

## Execution notes

- Respect `AGENTS.md`: verification is completion; record decisions/results in `.hermes/logs/log.md`; protect Prisma/database changes with the human gate represented by this overnight request, but do not broaden into prod or full import writes.
- Use real commands and file reads; do not invent outputs.
- Prefer foreground commands with generous timeouts. Use background only for bounded long gates and make results visible.
- If AWS/SSM/dev DB credentials are unavailable/expired, stop that substep and still complete the non-mutating verification/evidence packet.
