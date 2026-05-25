# KODY OMS Backend — App Runner Packaging Runbook

This runbook records the Stage 2 packaging baseline for the KODY OMS backend.
It intentionally contains **no secret values** and does not authorize AWS resource creation by itself.

## Approved packaging baseline

- Runtime target: AWS App Runner, ECR image source.
- Region baseline: `ap-northeast-2`.
- Image tag baseline: Git SHA tag, with optional human-readable alias for dev.
- Container entrypoint: `node dist/server/index.js` only.
- Migration rule: never run Prisma migrations on container startup.
- Secret rule: values live in AWS-managed configuration/SSM, not in Git, chat, image layers, or docs.
- Dependency rule: no dependency or lockfile changes were needed for Stage 2 packaging.

## Local image build

From `kody-backend/`:

```bash
IMAGE_TAG="kody-backend:$(git rev-parse --short HEAD)"
docker build -t "$IMAGE_TAG" .
```

Optional local boot check requires a reachable non-production database URL and a test-only JWT secret.
Do not paste real secret values into chat, docs, or shell history.

```bash
docker run --rm \
  -e PORT=4000 \
  -e HOST=0.0.0.0 \
  -e CORS_ORIGIN=http://localhost:3000 \
  -e DATABASE_URL='<test-only-url-with-pool-params>' \
  -e AUTH_JWT_SECRET='<test-only-secret>' \
  -p 4000:4000 \
  "$IMAGE_TAG"
```

Then in another shell:

```bash
curl -fsS http://localhost:4000/health
```

## ECR image publish shape

Requires AWS account, region, repository name, IAM permissions, and login method to be confirmed first.
Placeholders only:

```bash
AWS_REGION=ap-northeast-2
AWS_ACCOUNT_ID='<account-id>'
ECR_REPOSITORY='kody-backend'
GIT_SHA="$(git rev-parse --short HEAD)"
IMAGE_URI="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY:$GIT_SHA"

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

docker build -t "$IMAGE_URI" .
docker push "$IMAGE_URI"
```

Do not run this until Stage 3 AWS account/cost/resource approval is complete.

## App Runner service configuration baseline

Use ECR image source and inject runtime configuration through App Runner environment variables and secrets.

### Non-secret environment variables

| Name | Dev baseline | Prod baseline | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | `production` | `production` | Runtime image default also sets this. |
| `HOST` | `0.0.0.0` | `0.0.0.0` | Required for container networking. |
| `PORT` | App Runner/default `4000` | App Runner/default `4000` | App listens on configured port. |
| `CORS_ORIGIN` | Vercel dev/preview origin | Exact production frontend origin | No wildcard in prod. |

### Secret / sensitive configuration names

| Name | Storage baseline | Notes |
| --- | --- | --- |
| `DATABASE_URL` | SSM Parameter Store SecureString | Include pool query params unless superseded: `connection_limit=5&pool_timeout=10`. Do not store raw value in Git/docs/chat. |
| `AUTH_JWT_SECRET` | SSM Parameter Store SecureString | Rotate by replacing secret and redeploying App Runner. |

## RDS / Prisma pool baseline

Initial conservative baseline:

- `DATABASE_URL` contains `connection_limit=5&pool_timeout=10`.
- App Runner starts with low instance count and conservative concurrency.
- Recalculate before raising max instances or moving to paid/external-user traffic.

Example shape only:

```text
postgresql://<user>:<password>@<host>:5432/<db>?schema=public&connection_limit=5&pool_timeout=10
```

## Health-check baseline

- Keep current `/health` as App Runner liveness check for Stage 2.
- `/health` is unauthenticated and does not mutate privileged state.
- It may report a degraded JSON body when DB connectivity fails while still returning HTTP 200.
- If App Runner should restart/mark unhealthy on DB failure, add a separate readiness endpoint or change semantics in a later backend contract gate.

## Manual gated migration baseline

Production/staging migrations are a separate human-approved step.
They are not part of the Dockerfile, image entrypoint, App Runner startup command, or health check.

Before any `prisma migrate deploy` run:

1. Confirm target environment and exact `DATABASE_URL` source.
2. Confirm backup/PITR status and, for production, manual snapshot status.
3. Confirm operator and approver.
4. Confirm expected migration list.
5. Run from an approved operator environment with the target secret available locally but not printed.

Command shape only:

```bash
npx prisma migrate deploy --schema prisma/schema.prisma
```

## Stage 3 blockers before AWS execution

The following are still required before creating or changing AWS resources:

- AWS account ID and operator login path.
- Budget/cost guardrail and alert recipients.
- ECR repository approval.
- RDS dev/prod resource approval and VPC/security-group design.
- SSM parameter names and write operator.
- App Runner service name(s), instance/scaling settings, and deployment approver.
- Frontend/backend production domain decision for prod CORS/TLS.

## Stage 4 staging smoke checks

After staging App Runner exists:

```bash
curl -fsS https://<staging-app-runner-url>/health
```

Then verify:

- App Runner service reaches healthy state.
- CloudWatch logs receive application logs.
- No secret values appear in logs.
- DB connectivity works or degrades without sensitive disclosure.
- Approved staging frontend origin can call backend APIs.
- Rollback target image tag is recorded before promotion.

## Stage 5 production go/no-go

Do not promote to production until the production checklist in the root ADR is satisfied:

- Image tag/digest recorded.
- Production RDS backup/PITR retention recorded.
- Production secrets present in approved store, values never printed.
- Production CORS origin and session behavior confirmed.
- Migration operator/approver named or migration explicitly excluded.
- Monitoring/alerts active.
- Rollback procedure and contact path ready.

## Stage 6 rollback outline

For app-only rollback:

1. Identify previous known-good image tag/digest.
2. Update App Runner service image source to previous tag/digest.
3. Wait for App Runner healthy state.
4. Run `/health` and minimum auth smoke checks.
5. Record reason, operator, image tags, and verification results.

For database-related issues:

- Prefer forward fix when safe.
- PITR/restore is a separate owner decision and may require app downtime or a new DB endpoint.
- Never run destructive DB commands without a new explicit gate.
