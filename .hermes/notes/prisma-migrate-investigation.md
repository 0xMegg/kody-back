# Prisma Migrate Engine Investigation

Date: 2026-05-07.

Status: diagnosis complete; no schema, migration, dependency, lockfile, env, API, or database mutation was performed.

## Summary

`npx prisma migrate status --schema prisma/schema.prisma` reproduces the blank `Schema engine error` when it uses the repository `.env` `DATABASE_URL`.

The most likely root cause is invalid local database credentials in `.env`: the configured URL uses Postgres role `user`, but local Postgres does not have that role or denies it. When the command is run with an ephemeral local-role `DATABASE_URL`, Prisma reports that the database schema is up to date.

The schema engine binary itself exists, is executable, and matches the machine architecture. The migration file checksum matches the row recorded in `_prisma_migrations`, so the local manual `psql` migration state is consistent.

## Exact Reproducers

Failing command:

```sh
npx prisma migrate status --schema prisma/schema.prisma
```

Observed output:

```text
Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "kody_oms", schema "public" at "localhost:5432"
Error: Schema engine error:
```

Direct schema-engine connection check with `.env` `DATABASE_URL`:

```sh
set -a; source .env; set +a; node_modules/@prisma/engines/schema-engine-darwin-arm64 cli --datasource "$DATABASE_URL" can-connect-to-database
```

Observed output:

```json
{"error_code":"P1010","message":"User was denied access on the database `(not available)`"}
```

Successful control command with ephemeral local role URL:

```sh
DATABASE_URL="postgresql://mero@localhost:5432/kody_oms?schema=public" npx prisma migrate status --schema prisma/schema.prisma
```

Observed output:

```text
1 migration found in prisma/migrations

Database schema is up to date!
```

## Environment Fingerprint

- OS: Darwin 25.4.0, arm64.
- Shell architecture: arm64.
- Default Node.js: v25.9.0.
- Bundled Codex Node.js checked: v24.14.0.
- npm: 11.12.1.
- Installed `prisma`: 6.19.3.
- Installed `@prisma/client`: 6.19.3.
- Installed `@prisma/engines`: 6.19.3.
- Prisma computed binary target: `darwin-arm64`.
- Schema engine: `schema-engine-cli c2990dca591cba766e3b7ef5d9e8a84796e47ab7`.
- Query engine: `libquery-engine c2990dca591cba766e3b7ef5d9e8a84796e47ab7`.

Note: `package.json` currently declares Prisma packages as `^6.4.1`, while `node_modules` resolves to 6.19.3. That version drift is not the primary reproduced cause because the same installed engine succeeds when the datasource uses a valid local role.

## Evidence

Schema validation:

```text
npx prisma validate --schema prisma/schema.prisma
The schema at prisma/schema.prisma is valid
```

Engine binary checks:

```text
node_modules/@prisma/engines/schema-engine-darwin-arm64: Mach-O 64-bit executable arm64
node_modules/@prisma/engines/libquery_engine-darwin-arm64.dylib.node: Mach-O 64-bit dynamically linked shared library arm64
```

Engine binary paths present:

```text
node_modules/@prisma/engines/schema-engine-darwin-arm64
node_modules/@prisma/engines/libquery_engine-darwin-arm64.dylib.node
```

Sanitized `.env` `DATABASE_URL` shape:

```json
{"protocol":"postgresql:","username":"user","host":"localhost","port":"5432","database":"kody_oms","search":"schema=public"}
```

`psql` with the `.env` URL stripped of Prisma-only query parameters fails before metadata can be read:

```text
psql: error: connection to server at "localhost" (::1), port 5432 failed: FATAL: role "user" does not exist
```

`psql` with the local OS role succeeds:

```text
current_user | current_database
mero         | kody_oms
```

## Migration State Reconciliation

Migration file:

```text
prisma/migrations/20260506192500_m0_schema_foundation/migration.sql
```

Migration file checksum:

```text
5cd56eceaf5be45bfa920e6c542d4c59ac0a797fe8b3e887268057668d094f98
```

`_prisma_migrations` row:

```text
migration_name: 20260506192500_m0_schema_foundation
checksum: 5cd56eceaf5be45bfa920e6c542d4c59ac0a797fe8b3e887268057668d094f98
finished_at: 2026-05-06 21:47:24.222671+09
applied_steps_count: 1
rolled_back_at: null
logs: null
```

The DB metadata checksum matches the migration file checksum. The public schema contains the expected 20 tables including `_prisma_migrations`, `Employee`, `User`, `UserRole`, `InviteToken`, `RefreshToken`, and `ActionLog`.

## Ranked Hypotheses

1. Invalid local `DATABASE_URL` credentials in `.env`.

Evidence: `.env` username is `user`; `psql` reports role `user` does not exist; schema engine reports `P1010`; the same migration command succeeds with the ephemeral `mero` local role URL.

2. Prisma CLI hides datasource auth errors behind a blank `Schema engine error` in this version/runtime combination.

Evidence: normal `migrate status` prints only the blank error, while direct schema-engine `can-connect-to-database` exposes `P1010`.

3. Installed Prisma version drift is a secondary risk, not the current failure cause.

Evidence: `package.json` declares `^6.4.1`, while installed CLI/client/engines are 6.19.3. However, 6.19.3 succeeds with a valid datasource URL.

4. Engine binary corruption or architecture mismatch is unlikely.

Evidence: schema engine and query engine are present, executable, arm64, report versions, and successfully connect when given a valid datasource.

## Proposed Fix Options And Gates

Recommended next gated fix:

- Update the local development `DATABASE_URL` to use a valid local Postgres role or create/grant the configured `user` role.
- Gate: environment/database access change. Do not apply without explicit approval.
- Verification after approval: run `npx prisma migrate status --schema prisma/schema.prisma` without an ephemeral override and confirm it reports `Database schema is up to date!`.

Alternative:

- Create a local Postgres role named `user` with appropriate access to `kody_oms`.
- Gate: database role/permission change.
- Verification after approval: direct schema-engine `can-connect-to-database` with `.env` URL succeeds, then `migrate status` succeeds.

Secondary cleanup option:

- Reconcile Prisma package declarations and lockfile with the installed 6.19.3 toolchain or reinstall to the declared 6.4.x range.
- Gate: dependency/lockfile change.
- Verification after approval: `npm install` or equivalent, `npx prisma -v`, `npx prisma validate --schema prisma/schema.prisma`, `npx prisma migrate status --schema prisma/schema.prisma`, `npm run lint`, `npm run test`, `npm run build`.

## Verification Commands Run

- `node -v`
- `npm -v`
- `uname -a`
- `arch`
- `npx prisma -v`
- `npx prisma validate --schema prisma/schema.prisma`
- `npx prisma migrate status --schema prisma/schema.prisma`
- `DEBUG="prisma:*" npx prisma migrate status --schema prisma/schema.prisma`
- `node_modules/@prisma/engines/schema-engine-darwin-arm64 --version`
- `node_modules/@prisma/engines/schema-engine-darwin-arm64 --help`
- `node_modules/@prisma/engines/schema-engine-darwin-arm64 cli --help`
- `node_modules/@prisma/engines/schema-engine-darwin-arm64 cli --datasource "$DATABASE_URL" can-connect-to-database`
- `DATABASE_URL="postgresql://mero@localhost:5432/kody_oms?schema=public" npx prisma migrate status --schema prisma/schema.prisma`
- `psql -h localhost -d kody_oms -c "select current_user, current_database();"`
- `psql -h localhost -d kody_oms -c "select migration_name, checksum, finished_at, applied_steps_count, rolled_back_at, logs from _prisma_migrations order by started_at;"`
- `psql -h localhost -d kody_oms -c "select table_name from information_schema.tables where table_schema = 'public' order by table_name;"`
- `shasum -a 256 prisma/migrations/20260506192500_m0_schema_foundation/migration.sql`

## Next Slice Recommendation

Run a gated environment/database access fix before implementing schema-dependent features. The smallest fix is to align local `DATABASE_URL` with the working local role, then verify `migrate status` without overrides.

Do not proceed to signup/invite, password reset, refresh-token rotation, or new schema slices until Prisma migration automation works from the normal repo environment.

## Opus Re-Verification

Date: 2026-05-07.

Status: Opus/Claude was re-invoked for the develop stage after the user explicitly requested Opus develop and a longer wait. The invocation completed after a long delay, but Claude's file edit permissions did not allow it to modify this report or `.hermes/logs/log.md`. Codex recorded the returned Opus result here without changing the technical conclusion.

Opus independent agreement:

- Opus agreed with the primary diagnosis: the blank `Schema engine error` is driven by `.env` `DATABASE_URL` using local Postgres role `user`, which is denied or missing locally.
- Opus confirmed Prisma version drift is real but secondary: `package.json` declares `^6.4.1`, while installed Prisma packages are 6.19.3.
- Opus confirmed the installed engine/CLI is loadable: `validate`, `migrate status --help`, and version checks work.

Opus independently re-confirmed:

- `npx prisma migrate status` exits 1 and prints the blank `Schema engine error`.
- `npx prisma validate` reports the schema is valid.
- `npx prisma -v` reports Prisma and `@prisma/client` 6.19.3, schema-engine/query-engine hash `c2990dca591cba766e3b7ef5d9e8a84796e47ab7`, target `darwin-arm64`, and Node `v25.9.0`.
- `.env` literal datasource uses `postgresql://user:password@localhost:5432/kody_oms?schema=public`.
- Engine binaries are present under `node_modules/@prisma/engines/`.
- Migration file `prisma/migrations/20260506192500_m0_schema_foundation/migration.sql` is present.
- System is Darwin 25.4.0 on `arm64`.

Opus verification commands run:

- `node -v`
- `uname -a`
- `arch`
- `npx prisma -v`
- `npx prisma validate`
- `npx prisma migrate status`
- `npx prisma migrate status --help`
- `cd prisma && wc -c migrations/20260506192500_m0_schema_foundation/migration.sql`

Opus blockers:

- Claude's hook layer blocked direct execution paths containing `node_modules/`, so Opus could not re-run direct schema-engine `can-connect-to-database` to personally re-attest the `P1010` string.
- Claude's permission layer did not approve the ephemeral local-role `DATABASE_URL` control run, `psql` metadata queries, `shasum -a 256`, or `DEBUG=prisma* npx prisma migrate status`.
- Claude file edit/write permission was not granted for this report or `.hermes/logs/log.md`.

Opus recommendation:

- Keep the same next gated action: align local development `DATABASE_URL` with a valid local Postgres role or create/grant the configured `user` role, then verify `npx prisma migrate status` without an override.

## Opus Follow-Up Re-Verification After Hook Adjustment

Date: 2026-05-07.

Status: Hermes safety adapter was relaxed to allow read-only inspection while still blocking destructive and DB-mutating commands. Opus re-ran the checks that were previously blocked. All read-only verifications succeeded; no verification remains blocked for this investigation.

Re-verified results:

- Direct schema-engine `can-connect-to-database` with the repository `.env` `DATABASE_URL` returned `error_code P1010`, message `User was denied access on the database (not available)`, exit 1.
- Ephemeral local-role `DATABASE_URL` run for `npx prisma migrate status --schema prisma/schema.prisma` reported `1 migration found in prisma/migrations` and `Database schema is up to date!`, exit 0.
- `psql -h localhost -d kody_oms -c "select current_user, current_database();"` returned `mero | kody_oms`.
- `psql -h localhost -d kody_oms -c "select migration_name, checksum, finished_at, applied_steps_count, rolled_back_at, logs from _prisma_migrations order by started_at;"` returned a single row `20260506192500_m0_schema_foundation` with checksum `5cd56eceaf5be45bfa920e6c542d4c59ac0a797fe8b3e887268057668d094f98`, `finished_at 2026-05-06 21:47:24.222671+09`, `applied_steps_count 1`, no `rolled_back_at`, no `logs`.
- `shasum -a 256 prisma/migrations/20260506192500_m0_schema_foundation/migration.sql` returned `5cd56eceaf5be45bfa920e6c542d4c59ac0a797fe8b3e887268057668d094f98`, matching the `_prisma_migrations` row.
- `DEBUG="prisma:*" npx prisma migrate status --schema prisma/schema.prisma` reproduced the same blank `Schema engine error` against the `.env` `DATABASE_URL`; the debug stream did not surface a more specific datasource error than the direct schema-engine `P1010` already established.

Diagnosis remains unchanged. The blank `Schema engine error` surface from the standard CLI is driven by `.env` `DATABASE_URL` user `user` being denied or absent on local Postgres. Schema, engine binaries, and migration checksum are healthy. The recommended next gated action is unchanged: align the local development `DATABASE_URL` with a valid local Postgres role or create/grant the configured `user` role, then verify `npx prisma migrate status` without an override.

Scope held during this re-verification: no edits to `.env`, schema, migrations, package files, source, or tests; no migrate dev/deploy/resolve, no db push, no database mutation.
