# Kody Backend NEXT

Current mode: backend Hermes active.

Next action:
- Return to root and run `closeout S6` for Admin User API closeout hardening.
- S6 develop is complete in this backend repo and closeout is pending from the orchestration root.

S6 develop result:
- Target file: `tests/admin-users-routes.test.ts`.
- Scope: backend test-only Admin User API closeout hardening.
- Added/confirmed coverage for user detail body shape and no-log read access, unknown detail `USER_NOT_FOUND`, FINANCE status update allow, ADMIN role replacement allow, FINANCE unlock allow, operational-role write/unlock rejection, suspended elevated actor route-level rejection, truthful actor-role token fixtures, and representative admin payload validation cases.
- S6 develop did not intentionally edit frontend files, Prisma schema/migrations, env, dependency/lockfile, generated output, API contract, or route/service source.

Verification:
- `npx vitest run tests/admin-users-routes.test.ts` passed with 19 tests.
- `npm test` passed with 97 tests.
- `npm run lint` passed.
- `npm run build` passed.
- Backend `git diff --check` passed.
- Root `git diff --check` passed.
- Independent spec review passed; independent quality/security review approved.

Current backend progress:
- Current backend M0 work includes schema/migration, auth service, auth session routes, reusable RBAC guard, shared ActionLog writer, profile routes, and admin user management routes with tests passing.
- S1, S2, S3, S4, S5a, and S5b are complete.
- S6 develop is complete and closeout is pending.
- S7 remains partial. S8, S9, and S10 remain not started.

Workflow reminders:
- Opus/Claude remains primary for backend `plan` and `develop`; Codex/Hermes invokes Claude, checks, records blockers, and owns closeout.
- Backend Claude develop permission profile allows ordinary `src/`, `tests/`, docs, `.hermes/logs/`, and `.hermes/NEXT.md` edits while high-risk surfaces remain gated.
- If Claude develop stops on ordinary backend source/test/docs edit permission, retry/fix the Claude permission profile first; do not convert to Codex develop unless the user explicitly approves fallback after seeing the blocker.

Open gates:
- Prisma write commands (`migrate dev`, `migrate deploy`, `migrate resolve`, `db push`), Prisma schema/migration edits, `_prisma_migrations` mutation, env, lockfile, dependency, generated output, or API contract changes require explicit approval.
- Further API contract expansion, signup/invite, password reset, product route protection, and refresh-token rotation require a new plan/gate.
