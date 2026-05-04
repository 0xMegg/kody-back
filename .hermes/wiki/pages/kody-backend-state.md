# Kody Backend State

## Source Provenance

- Git status and package inspection on 2026-05-04.

## Current State

- Branch before cutover: `task/5.5`.
- HEAD before cutover: `b286d62536f1d5c9739d82c57be571d550bb1612`.
- Pre-existing dirty files before Hermes cutover: `package.json`, `package-lock.json`, `.DS_Store`, `src/.DS_Store`.
- The dirty package changes are not Hermes changes and must not be reverted or cleaned without explicit approval.

## Source Shape

- Server entry and composition live under `src/server/`.
- Domain placeholders live under `src/domain/`.
- Prisma schema lives at `prisma/schema.prisma`.
- Tests live under `tests/`.
