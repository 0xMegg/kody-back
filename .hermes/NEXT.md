# Kody Backend NEXT

Current mode: backend Hermes active.

Next action:
- Return to root and run `plan/develop/closeout F1` Frontend M0 Shell and CP#2 demo readiness in `kody-frontend/`.
- Latest closeout completed `S10` Logs API in `kody-backend/` under root macro-slice `Slice C`.

S10 closeout result:
- S10 Logs API is complete for the current M0 backend surface.
- Added `ActionLogQueryService` around existing `ActionLog` rows; no schema/migration or ActionType change was needed.
- Added authenticated `GET /logs` using `requirePermission({ resource: 'logs', action: 'read' })`.
- Query contract supports `page`, `pageSize`, `actorUserId`, `actionType`, `targetType`, and `targetId`; default pagination is page 1/pageSize 20 and pageSize is capped at 100.
- ADMIN/FINANCE read all matching logs.
- Non-admin users read own logs plus mapped target record logs where their roles have read permission.
- M0 target mapping covers user-admin, account, productInventory, payment, order, and shipment target types; unknown targets remain admin/finance-only unless constrained to the actor's own logs.
- Response uses the existing success/error envelope and serializes `createdAt` as ISO JSON.

Verification:
- `npx vitest run tests/logs-routes.test.ts` passed with 18 tests.
- `npm test` passed with 221 tests across 15 files.
- `npm run lint` passed.
- `npm run build` passed.
- Backend `git diff --check` passed.
- Root `git diff --check` passed.
- Independent Hermes/Codex-style review returned PASS with no blockers.

Current backend progress:
- Current backend M0 work includes schema/migration, auth service primitives, auth session routes, reusable RBAC guard, shared ActionLog writer, profile routes, admin user management routes, invite/signup routes, password-reset routes, and logs route with tests passing.
- S1, S2, S3, S4, S5a, S5b, S6, S7, S8, S9, and S10 are complete.
- Backend M0 slices now hand off to frontend F1.

Workflow reminders:
- Opus/Claude remains primary for backend `plan` and `develop`; Codex/Hermes invokes Claude, checks, records blockers, and owns closeout.
- Product implementation work belongs in the target child repo; frontend F1 implementation must run from `kody-frontend/`, not backend or root.
- The `codex` CLI is currently not installed in this environment; use Hermes/delegate review for Codex/Hermes closeout checks unless the standalone CLI becomes available.

Open gates:
- Prisma write commands (`migrate dev`, `migrate deploy`, `migrate resolve`, `db push`), Prisma schema/migration edits, `_prisma_migrations` mutation, env, lockfile, dependency, generated output, or additional API contract changes require explicit approval.
- F1 frontend changes are a separate frontend implementation slice and should keep route dependency modes explicit.
