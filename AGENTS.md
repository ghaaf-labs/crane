# AGENTS.md

Canonical onboarding guide for coding agents (and humans) working in this repo.
`CLAUDE.md` should be a symlink to this file. Read this before making any change.

## 1. What this project is

**Crane** is a hard fork of [Dokploy](https://github.com/dokploy/dokploy)
**v0.29.6**, a free, self-hostable Platform-as-a-Service (PaaS) for deploying
applications, databases, and Docker Compose stacks across single or multi-node
(Docker Swarm) clusters, fronted by Traefik.

Two things define the fork's direction:

1. **Relicensing to pure Apache-2.0.** Upstream Dokploy ships a split license:
   most of the tree is Apache-2.0, but a `/proprietary` ("DSAL", Dokploy Source
   Available License) layer covers enterprise/cloud features (SSO, license keys,
   audit logs, custom RBAC roles, whitelabeling). Crane is deleting **all**
   `/proprietary` code and the license gate. There is **no feature ungating** —
   gated features are removed, not unlocked for free.
2. **Progressive TypeScript → Rust rewrite.** Once relicensed and stabilized,
   the plan is to incrementally port the TS business/deploy layer to Rust,
   starting from clean process/HTTP boundaries (the Go monitoring service is the
   reference pattern). OAuth/SSO will be **rebuilt in Rust later** — they are
   removed now, not reimplemented in TS.

This is the working tree for that effort. **Done so far:** the `/proprietary`
layer + license gate are removed and the whole tree is single-license Apache-2.0;
the `@dokploy/*` workspace packages are renamed `@crane/*`; container images
publish to `ghcr.io/ghaaf-labs/crane*` (GHCR); passwords hash with argon2id;
a batch of security fixes landed (see `docs/REVIEW.md`); and user-facing
text/links are de-branded to Crane. **Still pending:** the OAuth/SSO Rust
rebuild, the heavier dependency-major upgrades (`docs/relicense/REMAINING-FIXES-PLAN.md`,
batches B4/B6/B7 — they need a running instance to validate), and the long-tail
i18n/asset de-brand. **Runtime/data ABI is intentionally preserved** (see HARD
RULES §4.3).

## 2. Monorepo layout

pnpm + workspaces. Node `^24.4.0`, pnpm `10.22.0` (pinned via `packageManager`).
Workspace globs (`pnpm-workspace.yaml`): `apps/api`, `apps/dokploy`,
`apps/schedules`, `packages/server`.

| Path | Stack | Role |
|------|-------|------|
| `apps/dokploy` | Next.js (pages router) + tRPC + WebSockets + in-process BullMQ worker | The main app: UI, the 48-router tRPC tree, auth/session, 6 WebSocket streaming servers, and the local single-node deploy worker. Build entry for both Next and an esbuild server bundle (`server/server.ts`). |
| `apps/api` | Hono + Inngest | Remote-server deploy executor. Receives `/deploy` POSTs and runs the **same** `@crane/server` functions through Inngest. Port 4000 in dev. |
| `apps/schedules` | Hono + BullMQ | Cron/scheduled-job executor (3 workers). Port 4001 in dev. |
| `apps/monitoring` | **Go** (Fiber) + local SQLite | Standalone metrics service (`/health`, `/metrics`, `/metrics/containers`). Does **not** import `@crane/server`; talks HTTP only. The one already-decoupled, cross-language boundary — use it as the model for Rust extraction. Go module `github.com/ghaaf-labs/crane/apps/monitoring`. |
| `packages/server` (`@crane/server`) | TypeScript | The shared "god-module": Drizzle schema + all ~46 services + all docker/swarm/traefik/ssh integration. Re-exported through one ~138-line barrel (`src/index.ts`) and consumed by all three TS apps. |

Key facts:
- **Real work always lives in `packages/server`.** The apps are dispatchers.
  Deploy execution is shell-string assembly run over SSH (`ssh2`/`execAsyncRemote`)
  plus `dockerode` Swarm calls and `docker stack`/`docker compose` CLI.
- **Single Postgres** via `drizzle-orm/postgres-js` (`packages/server/src/db/index.ts`).
  Schema = **45 Drizzle modules**, **170 migrations** in
  `apps/dokploy/drizzle/*.sql`. This schema is the de-facto cross-language data
  contract; treat migrations as append-only history.
- Monitoring has its **own SQLite** (`monitoring.db`), separate from Postgres.
- On-disk ABI lives under **`/etc/dokploy`** (traefik dynamic config,
  applications, compose, ssh, certificates, …). Path generation is centralized
  in `packages/server/src/constants`. Traefik is configured by writing YAML files
  there. A rewrite must preserve these paths or migrate the Traefik provider
  deliberately.

## 3. Build / dev / typecheck / test

All commands run from the repo root unless noted. Scripts live in the root
`package.json` and per-package `package.json`.

```bash
pnpm install                 # install (uses pnpm@10.22.0)

# Dev
pnpm crane:dev             # main app (Next + tRPC + WS), via tsx server/server.ts
pnpm server:dev              # build/watch @crane/server
pnpm server:script           # switch @crane/server to source (switch:dev)
# apps/api:        pnpm --filter=@crane/api dev        (PORT=4000)
# apps/schedules:  pnpm --filter=@crane/schedules dev  (PORT=4001)

# Setup / DB (run inside apps/dokploy or via filter)
pnpm crane:setup           # setup.ts + run migrations
pnpm --filter=crane run migration:generate   # drizzle-kit generate
pnpm --filter=crane run migration:run        # apply migrations
pnpm --filter=crane run studio               # drizzle-kit studio

# Build
pnpm build                   # pnpm -r run build (all packages)
pnpm server:build            # build @crane/server only
pnpm crane:build           # build main app only

# Quality gates
pnpm typecheck               # pnpm -r run typecheck (tsc --noEmit everywhere)
pnpm format-and-lint         # biome check .   (CHECK ONLY — the CI gate)
pnpm format-and-lint:fix     # biome check . --write (auto-fix)
pnpm test                    # vitest (apps/dokploy/__test__ only)
```

Notes for agents:
- The **test suite lives entirely in `apps/dokploy/__test__`** (~50 files).
  `packages/server` (213 files / ~44 services), `apps/api`, and `apps/schedules`
  have **zero tests**. There is no coverage tooling. When porting anything to
  Rust, add a **characterization/golden test first** so behavior is pinned.
- `*.real.test.ts` (e.g. `apps/dokploy/__test__/deploy/application.real.test.ts`)
  are real-Docker/Swarm integration tests; they are **excluded from the default
  vitest run** (`__test__/vitest.config.ts`) and need a live Docker daemon +
  swarm. The default suite is **462 tests / 49 files, green**.
- `biome check .` is **green** — keep it that way; don't introduce violations.
- Always use the package manager pins: pnpm `10.22.0`, Node `24.4.0`.

## 4. HARD RULES

These are non-negotiable. A change that violates any of them is wrong.

1. **No `/proprietary` code, ever.** Never reintroduce, re-import, or re-create
   the deleted DSAL layer. The three directories that must stay deleted:
   - `packages/server/src/services/proprietary/`
   - `apps/dokploy/server/api/routers/proprietary/`
   - `apps/dokploy/components/proprietary/`
   Do not add new license gates, enterprise/cloud feature flags, or anything
   that depends on `hasValidLicense`, the enterprise license cron, or
   `enterpriseProcedure`. **No feature ungating** — if a feature was DSAL-gated,
   it is gone, not made free.
2. **Everything must be Apache-2.0-compatible.** New code is Apache-2.0. Do not
   add dependencies, snippets, or assets under incompatible licenses (GPL/AGPL,
   SSPL, "source-available", proprietary). Check the license of any new dep.
   All `package.json` `license` fields are `Apache-2.0`.
3. **No Dokploy trademarks/branding in new code; preserve the runtime ABI.**
   The de-brand is largely done: workspace packages are `@crane/*`, images
   publish to `ghcr.io/ghaaf-labs/crane*`, and user-facing text/links point to
   `github.com/ghaaf-labs/crane`. Do not reintroduce `dokploy.com`/
   `app.dokploy.com` URLs, the license server, Discord/sponsor banners, DockerHub
   `dokploy/*`/`siumauricio/*`, or cross-repo pushes to `dokploy/{mcp,cli,sdk,
   website}`. **§4.3 — Runtime/data ABI deliberately keeps the `dokploy` name and
   MUST NOT be renamed without a versioned migration:** `/etc/dokploy/*` paths,
   `DOKPLOY_*` env vars, docker/network/service names (`dokploy-network`, the
   `dokploy` swarm service, `dokploy-postgres`), the `dokployRestart`/
   `dokployBackup` DB columns, and the `x-dokploy-token` header. The one
   exception external `@dokploy/trpc-openapi` is a published npm package (not the
   internal alias) and stays as-is.
4. **OAuth/SSO are removed and will be rebuilt in Rust.** Do not add a TS
   OAuth/SSO replacement. Email/password (better-auth core) is the auth path
   during this phase. The removed sign-in buttons / SSO settings have no TS
   replacement on purpose.
5. **Do not modify the proprietary deletion plan files to "fix" build breaks by
   re-adding proprietary code.** When `/proprietary` is deleted, fix the call
   sites (stub `hasValidLicense` to pass-through, drop the 5 router mounts in
   `apps/dokploy/server/api/root.ts`, drop the 2 re-exports in
   `packages/server/src/index.ts`, replace `enterpriseProcedure` with
   `adminProcedure`, collapse `enterpriseOnlyResources`), never by restoring the
   deleted layer.
6. **Migrations are append-only.** The 170 `apps/dokploy/drizzle/*.sql` files
   encode irreversible history. Generate new migrations; never rewrite old ones.

## 5. Conventions

- **Formatter/linter: Biome `2.1.1`** (`biome.json`). Use `pnpm format-and-lint`
  / `:fix`. Tabs, organize-imports on. Note: `noUnusedVariables` and
  `noExplicitAny` are currently **off** — but do not lean on that; prefer real
  types over `any`, and prefer `@ts-expect-error` (with a reason) over bare
  `@ts-ignore`.
- **Commits: Conventional Commits** (`feat:`, `fix:`, `chore:`, `refactor:`,
  `docs:`, `test:`, …). Keep relicensing/deletion work in atomic commits so the
  lint + test gates verify nothing dangles.
- **TypeScript strictness:** `apps/dokploy` and `packages/server` run `strict` +
  `noUncheckedIndexedAccess` + `checkJs`. `apps/api` and `apps/schedules` are
  weaker (`strict` only) — match the stronger bar in new code where feasible.
- **Errors:** routers throw `TRPCError`; avoid silently-swallowed
  `catch (_) {}`. Prefer a structured log over raw `console.*` in new code.
- **Auth/security:** passwords hash with **argon2id**
  (`packages/server/src/lib/password.ts`; `verifyPassword` accepts legacy bcrypt
  and re-hashes on next change). `BETTER_AUTH_SECRET` is **required** (the app
  fails closed without it); `apps/api` fails closed without `API_KEY` and
  requires `INNGEST_SIGNING_KEY` in production; set `SECURE_COOKIES=true` behind
  HTTPS. bcrypt remains ONLY for legacy verify + Traefik basic-auth (which can't
  parse argon2). When building shell commands, single-quote/validate every
  user/DB-controlled value (see the `shq` helper in `utils/providers/git.ts`).
- **Branching/PRs:** branch off `main`; do not push to upstream `dokploy/*`
  repos. The fork's branch model is being simplified (likely just `main` during
  the rewrite phase) — confirm before relying on `canary`/release automation.

## 6. Where the relicensing plan + Rust roadmap live

These docs live under `docs/` and are the authoritative companions to this file:

- **Engineering review** — full audit (architecture, security, deps, quality,
  devops, de-brand, schema, Rust): [`docs/REVIEW.md`](./docs/REVIEW.md).
- **Relicensing plan** (✅ executed) — [`docs/relicense/RELICENSING-PLAN.md`](./docs/relicense/RELICENSING-PLAN.md)
  + machine-readable `docs/relicense/execution-spec.json`. The `/proprietary`
  removal + single Apache-2.0 `LICENSE` was executed against this plan.
- **Cleanup audit** (✅ applied) — [`docs/relicense/CLEANUP-AUDIT.md`](./docs/relicense/CLEANUP-AUDIT.md):
  dead-code / unused-dep removal after the relicense (incl. the multi-DB
  changePassword injection fix).
- **De-brand checklist** — [`docs/relicense/DEBRAND-CHECKLIST.md`](./docs/relicense/DEBRAND-CHECKLIST.md).
  Status: the `@crane/*` alias rename + GHCR image names + user-facing text/links
  are **done**; the runtime/data ABI (`/etc/dokploy`, `DOKPLOY_*`, `dokploy-*`
  docker/traefik names, DB columns) is an **intentional survivor** (see §4.3);
  a long-tail of i18n strings + brand assets (logo/domain) remains.
- **Remaining-fixes runbook** — [`docs/relicense/REMAINING-FIXES-PLAN.md`](./docs/relicense/REMAINING-FIXES-PLAN.md):
  the sequenced plan for what's left. Self-update→GHCR, Go-module rename,
  bcrypt→argon2, and dependency batches **B1/B2/B3a/B5-subset are done**;
  **B3 (drizzle-zod), B4 (octokit/inngest), B6 (UI majors), B7 (React 19)** are
  pending and need a running instance to validate.
- **Security** — [`docs/security/password-hashing.md`](./docs/security/password-hashing.md)
  (argon2id + the bcrypt migration) and
  [`docs/security/docker-socket-hardening.md`](./docs/security/docker-socket-hardening.md)
  (socket-proxy / read-only / TLS recommendations).
- **Rust rewrite roadmap** — [`docs/RUST-MIGRATION-ROADMAP.md`](./docs/RUST-MIGRATION-ROADMAP.md):
  target `packages/server` services/utils first; keep tRPC routers as thin
  adapters; `ssh2`→`russh`, `dockerode`→`bollard`, byte-for-byte command strings
  behind golden tests; shared Postgres during migration; `apps/monitoring` is the
  reference separate-process / narrow-HTTP pattern.

If you add or move these docs, **update this section** so this file stays the
single source of truth for onboarding.
