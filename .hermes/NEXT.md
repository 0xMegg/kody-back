# Kody Backend NEXT

Current mode: backend Hermes active.

Next action:
- Return to root and run `plan` for `S10` Logs API.
- Latest closeout completed `S9` Password Reset API under root macro-slice `Slice C`.

S9 closeout result:
- S9 Password Reset API is complete.
- Added additive `PasswordResetToken` Prisma model and `User.passwordResetTokens` back-reference with one generated local migration: `20260511150814_s9_add_password_reset_token`.
- Added `hashPasswordResetToken` with a distinct HMAC context from refresh and invite tokens.
- Added public endpoints: `POST /auth/forgot-password`, `POST /auth/reset-password/validate`, and `POST /auth/reset-password`.
- New reset-token error codes are limited to `RESET_TOKEN_INVALID`, `RESET_TOKEN_USED`, and `RESET_TOKEN_EXPIRED`.
- Reset request stores only `tokenHash`; raw token is returned once only for eligible active/unlocked users as the approved M0 demo concession. Missing/ineligible users receive uniform `{ requested: true }` success.
- Reset token TTL is 30 minutes. Prior unused reset tokens are superseded by setting `usedAt` before issuing a new token.
- Reset consumption validates token before any `User` write, then updates password hash, clears `failedLoginCount`/`lockedUntil`, marks the reset token used, and revokes active refresh tokens in one transaction.
- Forgot/reset paths intentionally do not call `ActionLog` because the approved M0 `ActionType` list has no password-reset action; no new `ActionType` was introduced.
- M0 anti-enumeration timing remains a documented limitation: response shape is uniform, but constant-time response is not implemented.

Verification:
- `npx vitest run tests/password-reset-service.test.ts tests/password-reset-routes.test.ts` passed with 41 tests across 2 files.
- `npm test` passed with 203 tests across 14 files.
- `npm run lint` passed.
- `npm run build` passed.
- Backend `git diff --check` passed.
- Root `git diff --check` passed.
- Independent review returned PASS with no blockers or important issues.

Current backend progress:
- Current backend M0 work includes schema/migration, auth service primitives, auth session routes, reusable RBAC guard, shared ActionLog writer, profile routes, admin user management routes, invite/signup routes, and password-reset routes with tests passing.
- S1, S2, S3, S4, S5a, S5b, S6, S7, S8, and S9 are complete.
- S10 remains not started.

Workflow reminders:
- Opus/Claude remains primary for backend `plan` and `develop`; Codex/Hermes invokes Claude, checks, records blockers, and owns closeout.
- Backend Claude develop permission profile allows ordinary `src/`, `tests/`, docs, `.hermes/logs/`, and `.hermes/NEXT.md` edits while high-risk surfaces remain gated.
- If Claude develop stops on ordinary backend source/test/docs edit permission, retry/fix the Claude permission profile first; do not convert to Codex develop unless the user explicitly approves fallback after seeing the blocker.

Open gates:
- Prisma write commands (`migrate dev`, `migrate deploy`, `migrate resolve`, `db push`), Prisma schema/migration edits, `_prisma_migrations` mutation, env, lockfile, dependency, generated output, or API contract changes require explicit approval.
- S10 logs API, product route protection, refresh-token rotation beyond S9 consume-time revocation, and frontend F1 require their own plan/gate.
