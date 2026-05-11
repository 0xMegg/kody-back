# Kody Backend NEXT

Current mode: backend Hermes active.

Next action:
- Return to root and run `plan` for `S8` Invite and Signup API.
- Latest closeout completed `S7` Profile API closeout hardening under root macro-slice `Slice C`.

S7 closeout result:
- S7 Profile API is complete.
- Profile read/update/password-change route coverage is verified in `tests/profile-routes.test.ts`.
- `GET /profile`, `PATCH /profile`, and `POST /profile/password` all have explicit unauthenticated rejection coverage.
- Profile update validation covers non-object bodies, invalid `displayName`, invalid `profileImageUrl`, whitespace-only `displayName`, no-op payloads, display-name-only updates, and profile-image-only updates.
- Password change validation covers missing `currentPassword`, missing `newPassword`, wrong current password, weak new password, and successful password change.
- Suspended actors are rejected before self profile update or password change.
- Profile/password writes intentionally do not call `ActionLog` because the approved M0 `ActionType` list has no profile/password-change action.

Verification:
- `npx vitest run tests/profile-routes.test.ts` passed with 19 tests.
- `npm test` passed with 108 tests across 9 files.
- `npm run lint` passed.
- `npm run build` passed.
- Backend `git diff --check` passed.
- Root `git diff --check` passed.

Current backend progress:
- Current backend M0 work includes schema/migration, auth service, auth session routes, reusable RBAC guard, shared ActionLog writer, profile routes, and admin user management routes with tests passing.
- S1, S2, S3, S4, S5a, S5b, S6, and S7 are complete.
- S8, S9, and S10 remain not started.

Workflow reminders:
- Opus/Claude remains primary for backend `plan` and `develop`; Codex/Hermes invokes Claude, checks, records blockers, and owns closeout.
- Backend Claude develop permission profile allows ordinary `src/`, `tests/`, docs, `.hermes/logs/`, and `.hermes/NEXT.md` edits while high-risk surfaces remain gated.
- If Claude develop stops on ordinary backend source/test/docs edit permission, retry/fix the Claude permission profile first; do not convert to Codex develop unless the user explicitly approves fallback after seeing the blocker.

Open gates:
- Prisma write commands (`migrate dev`, `migrate deploy`, `migrate resolve`, `db push`), Prisma schema/migration edits, `_prisma_migrations` mutation, env, lockfile, dependency, generated output, or API contract changes require explicit approval.
- S8 signup/invite, S9 password reset, S10 logs API, product route protection, and refresh-token rotation require their own plan/gate.
