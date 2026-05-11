# Kody Backend NEXT

Current mode: backend Hermes active.

Next action:
- Return to root and run `plan` for `S7` Profile API closeout hardening.
- Latest closeout completed `S6` Admin User API closeout hardening under root macro-slice `Slice C`.

S6 closeout result:
- S6 Admin User API is complete.
- Admin list/detail/status/role/unlock route coverage is verified in `tests/admin-users-routes.test.ts`.
- Detail response body shape and read-only no-log behavior are asserted.
- Unknown detail route returns `USER_NOT_FOUND`.
- ADMIN and FINANCE allow behavior is explicit across admin write surfaces.
- Operational roles are forbidden for status, role replacement, and unlock.
- Suspended elevated actor route-level rejection is covered before update/log.
- ActionLog matrix is explicit: real status changes write `USER_STATUS_CHANGE`; status no-ops are not logged; real role changes write `USER_ROLE_CHANGE`; role no-op and reorder no-op are not logged; read-only list/detail and unlock are not logged under the current approved M0 action list.

Verification:
- `npx vitest run tests/admin-users-routes.test.ts` passed with 19 tests.
- `npm test` passed with 97 tests.
- `npm run lint` passed.
- `npm run build` passed.
- Backend `git diff --check` passed.
- Root `git diff --check` passed.

Current backend progress:
- Current backend M0 work includes schema/migration, auth service, auth session routes, reusable RBAC guard, shared ActionLog writer, profile routes, and admin user management routes with tests passing.
- S1, S2, S3, S4, S5a, S5b, and S6 are complete.
- S7 remains partial. S8, S9, and S10 remain not started.

Workflow reminders:
- Opus/Claude remains primary for backend `plan` and `develop`; Codex/Hermes invokes Claude, checks, records blockers, and owns closeout.
- Backend Claude develop permission profile allows ordinary `src/`, `tests/`, docs, `.hermes/logs/`, and `.hermes/NEXT.md` edits while high-risk surfaces remain gated.
- If Claude develop stops on ordinary backend source/test/docs edit permission, retry/fix the Claude permission profile first; do not convert to Codex develop unless the user explicitly approves fallback after seeing the blocker.

Open gates:
- Prisma write commands (`migrate dev`, `migrate deploy`, `migrate resolve`, `db push`), Prisma schema/migration edits, `_prisma_migrations` mutation, env, lockfile, dependency, generated output, or API contract changes require explicit approval.
- Further API contract expansion, signup/invite, password reset, product route protection, and refresh-token rotation require a new plan/gate.
