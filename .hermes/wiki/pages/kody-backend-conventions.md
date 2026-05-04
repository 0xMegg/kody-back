# Kody Backend Conventions

## Source Provenance

- Backend `package.json`, `prisma/schema.prisma`, `src/server/`, and `tests/` inspected on 2026-05-04.

## Stack

- Fastify `^5.2.1`.
- Prisma `^6.4.1`.
- TypeScript `^5.7.3`.
- Vitest.

## Guardrails

- `.env` and other secret files are protected.
- Prisma schema and migrations are database contract changes and require a human gate.
- Lockfile and dependency changes require explicit approval.
- API contract changes that affect frontend require root orchestration approval.
- Generated output such as `dist/` is not durable source.

## Verification

- Lint/typecheck: `npm run lint`.
- Tests: `npm run test`.
- Build: `npm run build`.
