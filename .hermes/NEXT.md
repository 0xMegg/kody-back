# Kody Backend NEXT

Current mode: backend Hermes active.

Next action:
- Return to root and run `plan` for `S9` Password Reset API.
- Latest closeout completed `S8` Invite and Signup API under root macro-slice `Slice C`.

S8 closeout result:
- S8 Invite and Signup API is complete.
- `POST /admin/users/invite` creates employee-linked invite tokens for ADMIN/FINANCE actors and returns the raw token once while persisting only `tokenHash`.
- `POST /admin/users/invite/resend` is gated by a prior unused invite and supersedes old unused invites before creating a new token.
- `POST /auth/invite/validate` validates public invite tokens and exposes invalid/used/expired outcomes through the unified envelope.
- `POST /auth/signup` consumes a valid invite token, creates the linked active `User`, marks the invite as used in the same transaction, and returns a user summary with no roles assigned by default.
- Invite/signup paths intentionally do not call `ActionLog` because the approved M0 `ActionType` list has no invite/signup action.
- No Prisma schema/migration, env, dependency/lockfile, generated output, frontend, or ActionType change was made.

Verification:
- `npx vitest run tests/invite-service.test.ts tests/invite-routes.test.ts tests/signup-routes.test.ts` passed with 54 tests across 3 files.
- `npm test` passed with 162 tests across 12 files.
- `npm run lint` passed.
- `npm run build` passed.
- Backend `git diff --check` passed.
- Root `git diff --check` passed.

Current backend progress:
- Current backend M0 work includes schema/migration, auth service primitives, auth session routes, reusable RBAC guard, shared ActionLog writer, profile routes, admin user management routes, and invite/signup routes with tests passing.
- S1, S2, S3, S4, S5a, S5b, S6, S7, and S8 are complete.
- S9 and S10 remain not started.

Workflow reminders:
- Opus/Claude remains primary for backend `plan` and `develop`; Codex/Hermes invokes Claude, checks, records blockers, and owns closeout.
- Backend Claude develop permission profile allows ordinary `src/`, `tests/`, docs, `.hermes/logs/`, and `.hermes/NEXT.md` edits while high-risk surfaces remain gated.
- If Claude develop stops on ordinary backend source/test/docs edit permission, retry/fix the Claude permission profile first; do not convert to Codex develop unless the user explicitly approves fallback after seeing the blocker.

Open gates:
- Prisma write commands (`migrate dev`, `migrate deploy`, `migrate resolve`, `db push`), Prisma schema/migration edits, `_prisma_migrations` mutation, env, lockfile, dependency, generated output, or API contract changes require explicit approval.
- S9 persistent reset-token strategy/API contract, S10 logs API, product route protection, refresh-token rotation, and frontend F1 require their own plan/gate.
