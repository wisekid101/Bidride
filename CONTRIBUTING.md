# Contributing to BidRide — Local Development

Goal: **clone → productive in under an hour.** Local runs a production-shaped
stack (Postgres, Redis, S3, KMS/Secrets, mail) in Docker; the services run on
your host with hot reload. Nothing here touches AWS or production.

## Prerequisites
- **Node ≥ 20**, **pnpm ≥ 9** (`corepack enable`), **Docker Desktop** running.

## Quickstart (5 steps)
```bash
git clone <repo> && cd bidride
pnpm install
pnpm dev:setup      # copies .env, starts the stack, migrates + seeds the DB
pnpm dev:backend    # all backend services with hot reload (add apps with `pnpm dev`)
# open a second terminal for an app:
pnpm dev:rider      # or: pnpm dev:driver   (admin portal: pnpm --filter @bidride/admin dev)
```
`pnpm dev:setup` is idempotent — re-run it any time. It never overwrites an existing `.env`.
(The name is `dev:setup`, not `setup`: pnpm ≥ 9 has a built-in `setup` command that would shadow it.)

## The local stack (`docker-compose.dev.yml`)
| Service | URL / port | Notes |
|---|---|---|
| PostgreSQL | `localhost:5432` | db `bidride` (+ `bidride_test` for integration specs). Versions mirror CI/prod (pg 15). |
| Redis | `localhost:6379` | sessions, refresh tokens, queues, geo |
| MinIO (S3) | console `http://localhost:9001` | `bidride_dev` / `bidride_dev_secret`; dev buckets auto-created |
| LocalStack | `localhost:4566` | KMS + Secrets Manager + SQS only (for the RS256 dev workflow) |
| MailHog | `http://localhost:8025` | catches OTP/email locally |

Manage it: `pnpm dev:up` / `pnpm dev:down` (or `docker compose -f docker-compose.dev.yml down -v` to wipe data).

## Environment
- `.env.example` documents every variable with safe **dev** defaults. `.env` (gitignored) is yours.
- **No real secrets ever go in `.env`** — production values live in AWS Secrets Manager.
- Auth defaults to **HS256** with a dev `JWT_SECRET` (same algorithm as current production).
- **OTP in dev** is printed to the service console (and any email lands in MailHog) — no real SMS/email is sent.
- **Object storage:** SOS recordings use a built-in **local-disk** fallback by default (no S3 needed). To test driver document upload against MinIO, uncomment the MinIO block in `.env` (`AWS_ENDPOINT_URL_S3` + MinIO creds).
- **One `DATABASE_URL`, in the root `.env`.** The Prisma CLI reads the `.env` nearest the schema and does not walk up to the repo root, so `pnpm install` links `packages/database/.env -> ../../.env` (root `postinstall`, `scripts/dev/link-db-env.mjs`). Nothing to do by hand. Never replace that link with a real file — a second copy of `DATABASE_URL` is how Prisma ends up pointing at the wrong database. If you already have one, `rm packages/database/.env && pnpm install` restores the link.
- **Test database:** `bidride_test` is created by the Postgres container but migrated separately — `DATABASE_URL=$TEST_DATABASE_URL pnpm --filter @bidride/database exec prisma migrate deploy`. Re-run it after any new migration. It is intentionally **not** seeded; integration specs build and clean up their own fixtures.

## Everyday commands
```bash
pnpm db:migrate     # apply Prisma migrations (dev)
pnpm db:seed        # founder admin + demo rider/driver + platform config
pnpm db:studio      # Prisma Studio (browse the DB)
pnpm test           # unit tests (all services)
pnpm typecheck      # tsc across the monorepo
pnpm lint           # eslint across the monorepo
pnpm --filter @bidride/<svc> test   # one service
```

## Debugging
- **VS Code:** `.vscode/launch.json` has "Debug: <service>" launch configs (auth/trip/payment/safety — copy the pattern for others), an "Attach" config (`:9229`), and "Jest: current spec file".
- Prisma Studio (`pnpm db:studio`), MinIO console, MailHog UI, and LocalStack logs (`docker compose -f docker-compose.dev.yml logs -f localstack`) cover the rest.

## Local RS256 (forward-looking, B8C)
Production is migrating user JWTs to RS256 (KMS-signed). To exercise that path
locally once it lands:
```bash
pnpm dev:rs256      # prints an ephemeral keypair + JWT_PUBLIC_KEYS (canonical {kid: PEM} schema)
```
Paste the printed `JWT_PUBLIC_KEYS` into `.env`. Keys are ephemeral — never commit them.

## Mobile apps (Expo)
`pnpm dev:rider` / `pnpm dev:driver`. For a physical device on your LAN, set
`EXPO_PUBLIC_API_URL=http://<your-lan-ip>:8080` in `.env` (the `dev-proxy` fronts the services).

## CI parity
CI (`.github/workflows/ci-cd.yml`) runs the same Postgres 15 / Redis 7 services and
the same `TEST_DATABASE_URL`/`TEST_REDIS_URL` conventions, so tests behave the
same on your laptop and in CI.

## Before you push
Run `pnpm typecheck && pnpm lint && pnpm test`. Follow the existing code style
and keep changes scoped. Production behavior and secrets are never changed by
local-dev work.
