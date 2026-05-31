# Crane Engineering Review

Fork of Dokploy (self-hostable PaaS) — pnpm monorepo at `/Users/malivix/Documents/ghaaf/crane`, git remote `git@github.com:ghaaf-labs/crane.git`.

Review date: 2026-05-31. Scope: relicensing the whole project to Apache-2.0 by deleting all `/proprietary` (DSAL) code and the license gate (no feature ungating), with a future progressive TypeScript-to-Rust rewrite. This report consolidates nine audit dimensions: Architecture, Coupling, Security, Dependencies, Quality, DevOps, De-brand, DB Schema, and Rust-migration.

---

## Executive Summary

Crane is structurally a good fork to relicense and modernize: there are zero strong-copyleft dependencies in the distributed tree, `apps/dokploy/package.json` already declares Apache-2.0, the router/service split is clean, and the monitoring app is already a separate Go process. The work is therefore mostly surgical removal plus disciplined sequencing.

The dominant risk across every dimension is the same: **the `/proprietary` code is not isolated — it is statically imported by build-entry files and the auth/authz core.** A naive `rm -rf proprietary` breaks all five Docker builds, the Next.js build, the esbuild server bundle, the CI typecheck/test matrix, and the frontend login shell. The relicense must be a coordinated, single-atomic-commit operation that removes import sites first, stubs the license gate fail-closed, and rewires audit logging, before the directories are deleted.

The most urgent non-relicense issue is **security**: a hardcoded fallback `BETTER_AUTH_SECRET` (`"better-auth-secret-123456789"`) that silently signs all sessions if the env var is unset, plus three concrete command-injection surfaces (DB password reset via an allowed backtick, `customGitUrl` in deploy clone, remote Traefik config via shell `echo`), an `apps/api` shared key that fails open when unset, and terminal/docker-exec WebSockets with no RBAC.

For the Rust rewrite, the right strangler-fig order is leaf executors first (SSH/process exec → Docker/Swarm client → schedules/api HTTP shells), deferring the deploy orchestration core until the primitives are Rust-native. The Next.js UI + tRPC + Drizzle layer should stay TypeScript indefinitely.

### Severity rollup

| Dimension | Critical | High | Medium | Low/Info |
|---|---|---|---|---|
| Architecture | 0 | 4 | 4 | 2 |
| Security | 1 | 5 | 4 | 3 |
| Dependencies | 0 | 0 | 2 | 5 |
| Quality | 0 | 2 | 3 | 4 |
| DevOps | 1 | 4 | 4 | 2 |
| De-brand | 2 | 3 | 2 | 4 |
| DB Schema | 0 | 3 | 1 | 2 |
| Rust-migration | 0 | 3 | 2 | 4 |

---

## 1. Architecture

The monorepo has 4 apps (dokploy = Next.js pages-router + tRPC + WebSockets + in-process BullMQ worker; api = Hono/Inngest remote deploy executor; schedules = Hono/BullMQ cron executor; monitoring = standalone Go/Fiber) plus one shared `packages/server` that holds the Drizzle schema, the entire service layer, and all docker/swarm/traefik/ssh integration. The 48 tRPC routers (43 open + 5 proprietary) are thin wrappers over ~46 service files. Deployment has a dual execution path (local in-process BullMQ vs remote Hono+Inngest), but the real work always lives in `packages/server`, so the apps are dispatchers.

| Finding | Severity | Location |
|---|---|---|
| `packages/server` is a god-module exported as one flat 138-line barrel and consumed by every app (no internal module boundaries; barrel re-exports proprietary alongside open services) | High | `packages/server/src/index.ts:1-138` (proprietary at `:38-39`) |
| Deployment has two divergent execution backends (in-process BullMQ vs remote Hono+Inngest) sharing the same core functions, plus a silent no-op mode gated by env flags | High | `apps/dokploy/server/queues/deployments-queue.ts:17-84`; `apps/api/src/index.ts:24-83`; `apps/dokploy/server/api/routers/application.ts:346-366` |
| Deployment is shell-string assembly executed over SSH plus dockerode Swarm calls — the hardest part to port to Rust | High | `packages/server/src/services/application.ts:191-224`; `packages/server/src/utils/builders/index.ts:39-191`; `packages/server/src/utils/process/execAsync.ts:142-159` |
| Proprietary (DSAL) code is coupled into core auth, RBAC, tRPC gating, schema, and a 3-day license cron — deletion is not a clean drop | High | `packages/server/src/lib/auth.ts:3,18,396-401`; `packages/server/src/services/permission.ts:3,47-50`; `apps/dokploy/server/api/trpc.ts:14,216-242`; `packages/server/src/utils/crons/enterprise.ts` |
| Frontend login/register/`_app` pages directly import proprietary components — deleting `/proprietary` breaks the app shell, not just enterprise screens | High | `apps/dokploy/pages/_app.tsx`; `apps/dokploy/pages/index.tsx`; `apps/dokploy/pages/register.tsx`; `apps/dokploy/components/proprietary/enterprise-feature-gate.tsx` |
| Auth session validation (better-auth `validateRequest`) is shared by tRPC and all 6 WebSocket servers — a cross-cutting seam for Rust | Medium | `apps/dokploy/server/api/trpc.ts:13,151-216`; `apps/dokploy/server/wss/listen-deployment.ts:3,34`; `apps/dokploy/server/server.ts:18-57` |
| Drizzle schema (45 modules, 170 migrations) is the de-facto data contract with no language-neutral definition | Medium | `packages/server/src/db/schema/index.ts`; `apps/dokploy/drizzle/*.sql`; `packages/server/src/db/index.ts` |
| Heavy filesystem contract on `/etc/dokploy` hardcoded in `constants.paths` — environment coupling for any rewrite | Medium | `packages/server/src/constants/index.ts:86-110`; `packages/server/src/utils/traefik/application.ts:46,207,245,260` |
| `monitoring` app is a separate Go/Fiber service with its own SQLite — already a clean cross-language boundary (reference pattern) | Info | `apps/monitoring/main.go:48-163`; `apps/monitoring/database/db.go:14` |
| Routers and services are 1:1 thin wrappers — the easiest layer to keep stable across a rewrite | Info | `apps/dokploy/server/api/root.ts:56-105`; `packages/server/src/services/*.ts` |

**Recommendations.** Treat `packages/server` as the rewrite unit and re-introduce explicit internal modules (deploy-engine, schema/data-access, integrations) before extraction. Stop re-exporting proprietary from the shared barrel as the first relicensing step. Document the local-vs-remote-vs-cloud dispatch matrix and make the no-op fallbacks an explicit "disabled" mode. For the deploy core, plan a Rust deploy-engine that reproduces the exact command strings byte-for-byte initially, with snapshot tests before refactoring. Preserve the router-as-thin-adapter pattern and target services/utils for the Rust effort. Use the monitoring app as the reference HTTP-boundary pattern.

---

## 2. Coupling (relicensing map)

There are three proprietary directories to delete entirely: `packages/server/src/services/proprietary/` (license-key.ts, sso.ts, audit-log.ts), `apps/dokploy/server/api/routers/proprietary/` (5 routers), `apps/dokploy/components/proprietary/` (15 .tsx). The barrel (`packages/server/src/index.ts:38-39`) re-exports only `license-key` and `sso`; `audit-log.ts` is imported by direct path only.

**Critical hidden coupling** (no `proprietary` token in the import line): `apps/dokploy/server/api/trpc.ts:12` imports `hasValidLicense` from `@dokploy/server/index`, feeding `enterpriseProcedure` at `trpc.ts:216`. There are ~15 `hasValidLicense` call/import sites: 4 import sites (git-provider service, server service, permission service, trpc.ts barrel) + 6 non-proprietary call sites (`permission.ts:47`, git-provider svc:73, server svc:161, git-provider router:77, user router:363, server router:134) + `trpc.ts:225`.

`enterpriseProcedure` is used by **non-proprietary** `settings.ts:449` (`updateRemoteServersOnly`) and `:471` (`updateEnforceSSO`) — these are real self-hosted features and must be replaced with `adminProcedure`, not removed. Other coupling: `apps/dokploy/server/utils/enterprise.ts` (used only by the proprietary license-key router — delete it); `packages/server/src/utils/crons/enterprise.ts` (barrel-exported at `index.ts:89`, called by `server.ts:9,70`); `lib/access-control.ts:58` `enterpriseOnlyResources` Set (consumed by `permission.ts:87,194`); the `audit()` helper (`apps/dokploy/server/api/utils/audit.ts`) imports `createAuditLog` from `/proprietary` and is called across ~38 routers + `lib/auth.ts:317,341`; `use-whitelabeling.ts` hook consumed by 16 UI files.

The `audit-log` **schema** (`packages/server/src/db/schema/audit-log.ts`: `auditLog` table + `AuditAction`/`AuditResourceType`) is OUTSIDE `/proprietary` — keep the table and types, but the `createAuditLog`/`getAuditLogs` service must be relocated or the `audit()` helper rewired/removed.

**Recommended sequence (one atomic commit):**
1. Remove the 5 proprietary router imports/mounts in `root.ts:31-35` and `:94-98`, and the two re-exports in `index.ts:38-39`.
2. Stub `hasValidLicense` fail-closed (see Security finding) and replace `enterpriseProcedure` with `adminProcedure` at the two `settings.ts` call sites.
3. Delete the enterprise license cron and its call site in `server.ts` (`initEnterpriseBackupCronJobs`).
4. Excise `sso()` from `auth.ts` and rewire/remove `createAuditLog` calls (re-implement audit logging unconditionally — see Security).
5. Delete `apps/dokploy/server/utils/enterprise.ts`, replace `WhitelabelingProvider` with a pass-through, and stub the login/register SSO/OAuth buttons.
6. Run `pnpm server:build && pnpm -r run build && pnpm typecheck && pnpm test` before pushing.

---

## 3. Security

The auth layer (better-auth) is reasonably structured — tRPC procedures enforce session + RBAC, API-key validation re-derives org/role from the DB — but there are several concrete, exploitable issues. The relicense touches the authz surface directly, so the deletion sequence has security implications.

| Finding | Severity | Location |
|---|---|---|
| Hardcoded fallback `BETTER_AUTH_SECRET` (`"better-auth-secret-123456789"`) silently signs all sessions/cookies/reset tokens/API keys if env var unset; warning suppressed under `NODE_ENV=test`, not in `.env.example` | Critical | `packages/server/src/lib/auth-secret.ts:3-28` |
| Command-substitution injection in DB password reset: `DATABASE_PASSWORD_REGEX` blocks `$ ' " \` and space but **explicitly allows the backtick** (regex ends `...<>?~\``), and the password is interpolated into a double-quoted `psql -c "..."` region where bash performs backtick substitution; `databaseUser` also interpolated unquoted (validated only `z.string().min(1)`) | High | `apps/dokploy/server/api/routers/postgres.ts:441-460`; `packages/server/src/db/schema/utils.ts:16-17` |
| Command injection via unescaped `customGitUrl`/`customGitBranch` in deploy clone command; validated only `z.string().optional()`; SSH key written to fixed `/tmp/id_rsa` (predictable-path race) | High | `packages/server/src/utils/providers/git.ts:46-85` |
| `apps/api`: static shared `API_KEY`, non-constant-time compare, **fails open when unset** (`undefined !== undefined` is false → request allowed), and `/api/inngest` webhook unauthenticated when `INNGEST_SIGNING_KEY` unset | High | `apps/api/src/index.ts:85-97` |
| Relicensing: deleting `/proprietary` breaks auth/authz wiring; if `hasValidLicense` is stubbed to return `true`, custom-role permission JSON is honored without any check → privilege escalation. `createAuditLog` early-returns unless licensed, so login/logout audit is already disabled for OSS and vanishes on deletion | High | `packages/server/src/services/permission.ts:3,39-74`; `packages/server/src/lib/auth.ts:18`; `packages/server/src/services/proprietary/audit-log.ts:25-28` |
| Terminal and docker-exec WebSockets check session + org but never enforce `docker`/`sshKeys` RBAC — any authenticated org member (including read-only base role) gets host SSH / container exec shell | High | `apps/dokploy/server/wss/terminal.ts:87-174`; `apps/dokploy/server/wss/docker-container-terminal.ts:30-68` |
| Remote Traefik config written via `execAsyncRemote("echo '" + yamlStr + "' > path")` without escaping YAML single-quotes → quote-break injection on the remote host (local path uses safe `fs.writeFileSync`) | Medium | `packages/server/src/utils/traefik/application.ts:266-276` |
| Self-hosted cookies hardcoded insecure (`useSecureCookies:false`, `secure:false`, `sameSite:'lax'`) even when served over HTTPS | Medium | `packages/server/src/lib/auth.ts:45-57` |
| SSO bypass branch in user-create hook skips the single-admin guard (`isSSORequest = context?.path.includes('/sso')`); becomes dead-or-dangerous after SSO removal | Medium | `packages/server/src/lib/auth.ts:182-196,254-277`; `packages/server/src/services/admin.ts:159-166` |
| Docker socket auto-detected and mounted (rw for dokploy/traefik) = root-equivalent; remote Docker over TCP has no surfaced TLS — escalates every injection finding to host root | Medium | `packages/server/src/constants/index.ts:21-84`; `packages/server/src/setup/traefik-setup.ts` |
| bcrypt synchronous hashing at cost 10, no rehash/upgrade path, 72-byte truncation | Low | `packages/server/src/lib/auth.ts:129-136` |
| API-key org binding parses unauthenticated metadata JSON; synthesized `mockSession` bypasses better-auth session lifecycle (expiry/revocation) | Low | `packages/server/src/lib/auth.ts:435-527` |

**Recommendations.** Fail closed on the auth secret: throw on startup (outside test) if no secret is provided; add `BETTER_AUTH_SECRET` to `.env.example`. Remove the backtick from `DATABASE_PASSWORD_REGEX` and stop string-interpolating into a shell — pass passwords via `PGPASSWORD`/stdin with `execFile`/argv (no shell); add a strict allowlist for `databaseUser`. Validate `customGitUrl` against a URL allowlist and pass URL/branch as argv to git; write SSH keys to per-deploy `mkstemp` 0600 paths. In `apps/api`: refuse to start if `API_KEY` unset, use `crypto.timingSafeEqual`, require `INNGEST_SIGNING_KEY` in production. **For the relicense, stub `hasValidLicense` to return `false` (fail-closed; custom roles disabled until the Rust authz rewrite)** and remove the `enterpriseOnlyResources` bypass; re-implement audit logging unconditionally; add a CI check that nothing imports from `/proprietary`. Gate the terminal/exec WS upgrade handlers with the same `checkPermission` used by tRPC. Upload Traefik config via SFTP or base64-pipe, not shell `echo`. Derive cookie `secure` from the configured scheme.

---

## 4. Dependencies

A full scan of the installed pnpm store (~2,866 packages) found **zero** GPL/AGPL/LGPL-in-app-code/SSPL/BSL/Commons-Clause/CC-BY-NC/Elastic-licensed runtime code. The tree is overwhelmingly permissive (2,285 MIT, 232 ISC, 118 Apache-2.0, 74 BSD-3-Clause, plus 0BSD/BlueOak/Unlicense/CC0). The Apache-2.0 relicense is clear on the dependency axis.

| Finding | Severity | Location |
|---|---|---|
| LGPL-3.0 prebuilt libvips bundled by sharp (transitive via Next.js image optimization) — dynamic-link, Apache-compatible, but triggers NOTICE attribution + replaceability obligation in distributed images | Medium | `pnpm-lock.yaml:1540-1591` (`@img/sharp-libvips-*@1.2.4`); `pnpm-lock.yaml:14734` (next→sharp); root `package.json:72` |
| Heavy reliance on native/compiled deps (bcrypt, node-pty, ssh2, sharp, better-sqlite3, tree-sitter, cpu-features) — build-toolchain dependency and friction for the Rust rewrite | Medium | `package.json:61-76` (onlyBuiltDependencies); `apps/dokploy/package.json:104,130,151`; `packages/server/package.json:53,68,83` |
| `better-sqlite3` compiles a native addon but is unused dead weight (transitive optional dep; app uses postgres) | Low | `package.json:65`; `apps/dokploy/package.json:136` (postgres) |
| `node-forge` dual `(BSD-3-Clause OR GPL-2.0)` reaches the tree only via `@better-auth/sso → samlify → node-forge` — the SSO chain being deleted; elect BSD or it vanishes | Low | `pnpm-lock.yaml:8828-8849`; `apps/dokploy/package.json:51`; `packages/server/package.json:41` |
| `dompurify` is `(MPL-2.0 OR Apache-2.0)` — elect Apache-2.0 (documentation only) | Low | `apps/dokploy/package.json:115` |
| Several runtime libs multiple majors behind (cmdk, `@react-email/components`, react-day-picker, date-fns, recharts, React 18); Radix version skew; esbuild force-pinned to 0.20.2 | Low | `apps/dokploy/package.json:86,87,113,123,141,145`; root `package.json:48-50` |
| No strong-copyleft dependency anywhere — relicense unblocked on this axis | Info | `node_modules/.pnpm`; `apps/dokploy/package.json:5` |
| Bundled telemetry transitive: `@scarf/scarf` via swagger-ui-react (Apache-2.0, install-time phone-home) | Info | `package.json:62`; `apps/dokploy/package.json:154` |

**Recommendations.** Add a CI license gate (allowlist MIT/ISC/Apache-2.0/BSD/0BSD/BlueOak/Unlicense/CC0). Discharge the libvips obligation with a `THIRD-PARTY-LICENSES` NOTICE (or drop Next image optimization / `SHARP_IGNORE_GLOBAL_LIBVIPS`). When removing SSO, drop `@better-auth/sso` from both package.json files and confirm samlify/node-forge leave the lockfile. Record Apache-2.0/BSD elections for dompurify/node-forge. Remove `better-sqlite3` from onlyBuiltDependencies once SQLite is confirmed unused. Set `SCARF_ANALYTICS=false`. Prioritize bcrypt → argon2, node-pty → portable-pty, ssh2 → russh in the Rust migration.

---

## 5. Quality

TS strictness is strong in the two main TS packages (`apps/dokploy` and `packages/server` both enable `strict` + `noUncheckedIndexedAccess` + `checkJs`), TODO/FIXME density is unusually low (4 total), and the unit suite (50 files, ~442 cases) runs green. The biggest weaknesses are a test-coverage cliff and type-safety erosion.

| Finding | Severity | Location |
|---|---|---|
| Test coverage cliff: entire suite lives in `apps/dokploy/__test__`; `packages/server` (213 files, 44 services) + `apps/api` + `apps/schedules` have **zero** tests — no behavioral safety net to port against | High | `apps/dokploy/__test__/vitest.config.ts:7`; `packages/server/src/services/` |
| CI lint gate is red: `pnpm format-and-lint` (`biome check .`) reports 24 errors + 4 warnings across 17 files, so the gate does not pass on a clean checkout | High | `biome.json`; `apps/dokploy/__test__/setup.ts:17` |
| Type-safety erosion: 253 `as any`, 99 `: any`, 58 `@ts-ignore` (56 bare, **0** `@ts-expect-error`); biome `noExplicitAny` is OFF | Medium | `packages/server/src/utils/process/execAsync.ts:1-40`; `apps/dokploy/server/wss/terminal.ts`; `biome.json:40` |
| Relicense footprint is large and coupled: 23 proprietary files (~5,815 LOC) + a gate touched by ~126 files; 3 permission tests will FAIL after deletion | Medium | `packages/server/src/index.ts:38-39`; `apps/dokploy/server/api/root.ts:31-35`; `packages/server/src/lib/access-control.ts:58`; `apps/dokploy/__test__/permissions/enterprise-only-resources.test.ts` |
| Monolithic files (2,137-line `handle-notifications.tsx`, 1,927-line environment page, 1,255-line compose router) concentrate complexity and resist incremental porting | Medium | `apps/dokploy/components/dashboard/settings/notifications/handle-notifications.tsx:1-2137`; `apps/dokploy/pages/dashboard/project/[projectId]/environment/[environmentId].tsx` |
| `apps/api` and `apps/schedules` tsconfigs weaker (no `noUncheckedIndexedAccess`, no `checkJs`; api uses old `moduleResolution: Node`) | Low | `apps/api/tsconfig.json:1-15`; `apps/schedules/tsconfig.json:1-16` |
| Silently swallowed catch blocks (8 `catch (_) {}` in DB routers, none logged); 197 raw `console.*` in packages/server | Low | `apps/dokploy/server/api/routers/postgres.ts:334`; `mongo.ts:361`; `application.ts:274` |
| Dead-code detection disabled (`noUnusedVariables` off) over a 1,451-export server surface — orphaned helpers after proprietary deletion will go unflagged | Low | `biome.json:37` |
| Real-Docker integration test mixed into the unit suite (180s timeout, clones GitHub, shells docker) — relies on `it.skip`, can be accidentally enabled in CI | Info | `apps/dokploy/__test__/deploy/application.real.test.ts:1-150` |

**Recommendations.** Before any Rust rewrite, add characterization/golden tests for the highest-risk pure functions in `packages/server` (deploy command building, env interpolation, docker/compose label generation) and wire `pnpm -r run test`. Run `biome check . --write`, hand-fix the rest, scope `// biome-ignore` to the 3 intentional drizzle-thenable test mocks, then make the gate a required CI check. Convert all `@ts-ignore` to `@ts-expect-error` with a reason; burn down `as any` in WSS/execAsync first. Sequence the relicense as one atomic commit and rewrite the 3 permission tests to assert the ungated model. Add `noUncheckedIndexedAccess` to api/schedules. Replace empty catches with debug logs. Run a one-off `knip`/`ts-prune` pass after proprietary deletion. Move the integration test to a separate glob/project.

---

## 6. DevOps

Five images build via multi-stage Node 24.4.0 / pnpm 10.22.0 (main, cloud, server, schedule) plus a Go 1.21 monitoring image, driven by eight GitHub workflows. None of the build/CI files contain literal `proprietary`/`enterprise` tokens, so the relicense breakage is purely transitive through application imports.

| Finding | Severity | Location |
|---|---|---|
| Deleting `/proprietary` breaks all five Docker builds and the CI typecheck/build/test matrix — the build-entry `index.ts:38-39` re-exports proprietary and `root.ts:31-35` mounts 5 proprietary routers; 27 import sites total | Critical | `packages/server/src/index.ts:38-39`; `apps/dokploy/server/api/root.ts:31-35`; `Dockerfile:20-21` |
| Server entry imports `initEnterpriseBackupCronJobs`/`IS_CLOUD`; the enterprise cron module is re-exported from the build index but lives OUTSIDE `/proprietary` → half-relicensed build if deleted by path filter alone | High | `apps/dokploy/server/server.ts:8`; `packages/server/src/index.ts:89`; `packages/server/src/utils/crons/enterprise.ts` |
| CI `test` job runs 3 permission tests that import proprietary modules → PR gate breaks | High | `apps/dokploy/__test__/permissions/{service-access,check-permission,resolve-permissions}.test.ts`; `.github/workflows/pull-request.yml:14-51` |
| Cross-repo sync jobs clone/push to `github.com/dokploy/{mcp,cli,sdk,website}` using upstream bot + `DOCS_SYNC_TOKEN` — fork cannot push, jobs hard-fail | High | `.github/workflows/dokploy.yml:166-241`; `.github/workflows/sync-openapi-docs.yml:45-132` |
| Hardcoded upstream image names + personal DockerHub namespace (`dokploy/dokploy`, `dokploy/monitoring`, `siumauricio/{cloud,schedule,server}`) | High | `.github/workflows/dokploy.yml:9`; `.github/workflows/monitoring.yml:8`; `.github/workflows/deploy.yml:22-24`; `apps/dokploy/docker/build.sh:15` |
| Workflows trigger on stale upstream branches (`fix/re-apply-database-migration-fix`) and encode upstream reviewers/PAT (`siumauricio`); `pr-quality.yml` blocks commit authors `claude,copilot` (conflicts with this project's AI workflow) | Medium | `.github/workflows/dokploy.yml:5`; `.github/workflows/create-pr.yml:74-77`; `.github/workflows/pr-quality.yml:17-21` |
| Main Dockerfile `COPY .env.production` fails for local/script builds (file gitignored, only synthesized by `dokploy.yml`) | Medium | `Dockerfile:43`; `.github/workflows/dokploy.yml:40-43`; `apps/dokploy/.gitignore:10` |
| Stripe build-arg + cloud-only Dockerfile reference billing infra not needed after relicense | Medium | `Dockerfile.cloud:25-26`; `.github/workflows/deploy.yml:9-44` |
| LICENSE files still reference DSAL/proprietary; root + `packages/server` package.json have `license: null` | Medium | `LICENSE.MD`; `LICENSE_PROPRIETARY.md`; `package.json`; `packages/server/package.json` |
| Go toolchain mismatch (Dockerfile 1.21 vs go.mod 1.20 vs devcontainer 1.20); module path still `github.com/mauriciogm/dokploy` | Low | `Dockerfile.monitoring:3`; `apps/monitoring/go.mod:1-3` |
| Release/version workflows assume upstream cadence + maintainer account | Low | `.github/workflows/dokploy.yml:137-164`; `.github/workflows/create-pr.yml:21-44` |

**Recommendations.** Remove all proprietary import sites and prove `pnpm server:build && pnpm -r run build && pnpm typecheck` locally before CI sees the deletion. Decide explicitly on the enterprise cron (it survives a path-filter delete). Update/remove the 3 permission tests in the same commit. Delete the cross-repo sync jobs and `DOCS_SYNC_TOKEN` dependency. Rename all image refs to the fork's namespace (consider GHCR `ghcr.io/ghaaf-labs/...`) and provision fork DockerHub/registry secrets. Reconcile workflow triggers to the fork's branch model and re-evaluate `pr-quality.yml`'s blocked-author list. Fix the `.env.production` COPY for local builds. Decide whether to ship a cloud/Stripe image at all. Replace `LICENSE.MD` with standard Apache-2.0, delete `LICENSE_PROPRIETARY.md`, set `license: "Apache-2.0"` in all manifests. Align Go versions and rename the Go module path.

---

## 7. De-brand

~2,297 case-insensitive "dokploy" occurrences across 609 files (plus 514 in generated Drizzle snapshots, 7 in pnpm-lock). They split into safe-to-rename (cosmetic) and rename-is-breaking (runtime/persisted/network identifiers). The big trap: ~34% of all matches are the `@dokploy/*` package alias, which looks identical to the `dokploy/` Docker image namespace under a naive grep but has a totally different blast radius.

| Finding | Severity | Location |
|---|---|---|
| Persisted DB identifiers: columns `dokployBackup`/`dokployRestart`, enum literal `type: "Dokploy"`, enum value `'dokploy-server'` — rename needs SQL migration + data backfill | Critical | `packages/server/src/db/schema/notification.ts:40-41`; `web-server-settings.ts:26,49,138`; `schema/schedule.ts:18`; `apps/dokploy/drizzle/0019,0062,0088,0156*.sql` |
| Default DB identity hardcoded `dokploy`: `POSTGRES_USER`/`POSTGRES_DB`, `POSTGRES_HOST=dokploy-postgres`, baked-in connection string — cannot be edited in source on a live deployment | Critical | `packages/server/src/db/constants.ts:6-8,42,45`; `packages/server/src/setup/postgres-setup.ts:6,20`; `packages/server/src/utils/docker/utils.ts:858,904` |
| `@dokploy/server` import alias — 776 refs / 330 files; coordinated workspace rename (package.json names + tsconfig paths + esbuild/next aliases + lockfile regen), not a text find/replace | High | `packages/server/package.json:2` (+330 files); tsconfig/esbuild/next aliases |
| Docker image names incl. self-update target `dokploy/dokploy` (tag-poll + `docker service update --force --image`); renaming requires owning the new registry or self-update keeps pulling upstream | High | `packages/server/src/services/settings.ts:53,298`; `.github/workflows/dokploy.yml:9`; setup/*.ts |
| Network `dokploy-network`, swarm self-name `dokploy` (`docker service inspect dokploy`), container names, `x-dokploy-token` header, `/etc/dokploy` path, JWT issuer — runtime contracts that break existing deployments | High | `packages/server/src/services/settings.ts:35,291`; `lib/auth.ts:153` + `pages/invitation.tsx:127`; `constants/index.ts:89`; `templates/index.ts:98` |
| `DOKPLOY_*` env vars (5 distinct) — externally set by operators; renaming the keys breaks configs | Medium | `packages/server/src/constants/index.ts:7-12`; `services/application.ts` (DOKPLOY_DEPLOY_URL) |
| `apps/dokploy` directory name + `dokploy-*.ts/.tsx` files — dir rename cascades into all Dockerfile COPY/filter paths, workspace, CI | Medium | `apps/dokploy/`; `Dockerfile:21-45`; `.github/workflows/dokploy.yml` |
| User-facing brand strings, dokploy.com URLs (49), Discord/X/GitHub links, i18n strings — SAFE to rebrand freely | Low | `README.md`; `apps/dokploy/components/layouts/{side,onboarding-layout}.tsx`; `packages/server/src/emails/emails/*.tsx` |
| Sponsor logos, FUNDING.yml, brand SVG, email logo URLs (`githubusercontent.com/Dokploy/...` will 404/serve upstream branding) — assets to replace | Low | `.github/sponsors/*`; `.github/FUNDING.yml`; `apps/dokploy/components/shared/logo.tsx`; email templates |
| `apps/dokploy/logo.png`, `public/{logo,icon}.svg` brand marks | Low | `apps/dokploy/public/logo.svg`, `icon.svg` |
| Auto-generated artifacts (`drizzle/meta/*.json` 514 lines, pnpm-lock 7) + 39 refs inside `/proprietary` — do NOT hand-edit; proprietary refs vanish with the gate deletion | Info | `apps/dokploy/drizzle/meta/*.json`; `pnpm-lock.yaml` |

**Recommendations.** Stage the de-brand: rebrand cosmetic strings/assets freely now (decide new domain/Discord/socials first; repoint email logo URLs to self-hosted assets). Rename the `@dokploy/*` alias as one atomic commit (codemod imports, regenerate lockfile, gate on typecheck+test) — exclude `pnpm-lock.yaml` and `drizzle/meta/**` from sweeps. **Strongly prefer NOT renaming persisted DB identifiers or runtime/network contracts** (DB name/user/host, `dokploy-network`, swarm self-name, `/etc/dokploy`) — they are invisible to users and carry migration risk; if required, do them as documented stack migrations against live data, never source edits. Change `x-dokploy-token` on client and server in the same commit. Decide the new registry namespace before touching image names and update CI + runtime pull/update strings together.

---

## 8. DB Schema

Two schema files carry the proprietary/enterprise/license/whitelabel surface. Migrations are forward-only (`drizzle-orm/postgres-js/migrator`, no down files), so removal must be a NEW additive migration `0169` with `DROP COLUMN`, generated by `drizzle-kit` — never an edit of historical migrations or their meta snapshots.

| Finding | Severity | Location |
|---|---|---|
| Enterprise/billing columns on the user table (drop targets): `enableEnterpriseFeatures`, `licenseKey`, `isValidEnterpriseLicense`, `stripeCustomerId`, `stripeSubscriptionId`, `serversQuantity`, `sendInvoiceNotifications`, `isEnterpriseCloud` (+ borderline `enablePaidFeatures`); no FK, no relation references | High | `packages/server/src/db/schema/user.ts:55-71` |
| `createInsertSchema().omit()`/extend lists reference dropped columns — TypeScript will not compile unless co-edited (`isValidEnterpriseLicense`, `isEnterpriseCloud` in user omit; `enforceSSO` + whitelabeling schemas in web-server-settings) | High | `packages/server/src/db/schema/user.ts:94-100`; `packages/server/src/db/schema/web-server-settings.ts:122-218` |
| `whitelabelingConfig` (jsonb) and `enforceSSO` (boolean) on `webServerSettings`; whitelabeling has only proprietary consumers (safe drop), but `enforceSSO` is read by NON-proprietary `pages/index.tsx` and mutated by `settings.ts:472` — must be neutralized in the same PR or Postgres throws "column does not exist" | High | `packages/server/src/db/schema/web-server-settings.ts:69-102` |
| Removal must be a new forward migration `0169` — editing `0137/0148/0164/0165/0168` or their snapshots corrupts the hash chain; existing prod DBs already have the columns | Medium | `apps/dokploy/drizzle/meta/_journal.json`; `apps/dokploy/server/db/migration.ts:9-20` |
| `DROP COLUMN` is irreversible without backup — low data-loss risk (all targets are enterprise/billing/whitelabel state, no FK, no OSS value) | Low | `apps/dokploy/drizzle` (forward-only migrator) |
| `schema.dbml` is already stale and decoupled from the migration chain — not load-bearing | Info | `packages/server/src/db/schema/schema.dbml:944-952` |

**Recommendations.** Edit the two `pgTable` definitions + their zod `omit`/extend/export lists in the same change, then run `pnpm drizzle-kit generate` from `apps/dokploy` — it will diff against the `0168` snapshot and emit `0169_<name>.sql` with the `DROP COLUMN` statements plus a fresh snapshot and journal entry. Do NOT hand-edit numbered files. Keep `trustedOrigins`, `bookmarkedTemplates`, `allowImpersonation`, `role` (not enterprise fields). Coordinate `enforceSSO` removal with the auth dimension (hardcode readers to `false`). Decide `enablePaidFeatures` with the billing owner (`user.ts:272` returns it to the client). Review the generated DROP list before committing; regenerate or delete `schema.dbml` after.

---

## 9. Rust-migration

Almost all orchestration lives in `@dokploy/server` (~40k LOC) and is re-entered from three runtimes (Next.js custom server, Inngest dispatcher, BullMQ scheduler). The deploy engine concatenates a single `set -e;` shell script piped over SSH, then calls dockerode to create/update Swarm services over an SSH transport. Monitoring is already Go (not a TS→Rust candidate). The strangler-fig order replaces leaf executors first and defers the orchestration core.

| Finding / Migration unit | Severity / Priority | Location |
|---|---|---|
| SSH remote-exec + process layer (`execAsync`/`execAsyncRemote`) — FIRST cut: narrow surface (4 fns, string-in/{stdout,stderr}-out), no DB/business logic, also a command-injection hotspot | High / P1 | `packages/server/src/utils/process/execAsync.ts:142` |
| Docker/Swarm client layer (dockerode → bollard) — SECOND cut: stable REST API, mechanical mapping; depends on P1 for SSH-tunneled remote Docker | High / P2 | `packages/server/src/utils/builders/index.ts:77` |
| Deploy/build orchestration core (`deployApplication`/`deployCompose` + builders + git providers) — LAST, highest-value, highest-risk; transitively depends on every primitive and has the densest untyped surface | High / P5 | `packages/server/src/services/application.ts:168` |
| Scheduler service (`apps/schedules`: BullMQ + node-schedule) — THIRD cut: trivial HTTP/queue shell, but job bodies are the backup engine in `@dokploy/server` | Medium / P3 | `apps/schedules/src/utils.ts:31` |
| Deploy dispatcher / api server (`apps/api`: Hono + Inngest) — FOURTH cut: thin axum-able dispatcher; already a network seam | Medium / P4 | `apps/api/src/index.ts:24` |
| WebSocket terminal/log/stats streaming (ws + node-pty + ssh2) — opportunistic, shares crates with P1 | Low / P6 | `apps/dokploy/server/wss/terminal.ts:1` |
| Next.js UI + tRPC surface + Drizzle schema — STAYS TypeScript (end-to-end type inference has no Rust equivalent) | Info / do-not-migrate | `apps/dokploy/server/api/root.ts:1` |
| Interop strategy: NAPI-RS in-process for primitives (P1/P2/P6, keeps import graph intact) vs standalone Rust processes for already-networked services (P3 over Redis, P4 over HTTP) | Info | `apps/dokploy/server/server.ts:1` |
| Monitoring app already Go — reference pattern, not a TS→Rust target | Info | `apps/monitoring/main.go` |

**Recommendations.** Build a Rust `crane-exec` (russh/openssh + tokio) preserving the exact `execAsync`/`execAsyncRemote` signatures via NAPI-RS, matching the friendly auth-error messaging and timeout contract callers depend on. Replace dockerode with bollard behind `getRemoteDocker`/`mechanizeDockerContainer`, keeping the Swarm update path (read `inspect.Version.Index`, bump `ForceUpdate`) byte-faithful. Port the schedules/api HTTP+queue shells to axum, matching BullMQ's Redis wire format and Inngest's per-server concurrency=1. Migrate the deploy core last, modeling deploys as typed steps (git2/gix + bollard + serde_yaml) instead of one shell blob — the biggest correctness+security win — strangling one `buildType` at a time behind a flag with the TS path as fallback. Keep the Next.js UI + tRPC + Drizzle layer in TypeScript indefinitely; treat tRPC routers as the stable facade over progressively-Rust primitives. Validate each cut against the existing `apps/dokploy/__test__` conformance tests before flipping flags.

---

## Top 15 Prioritized Actions

| # | Action | Severity | Dimension(s) | Anchor |
|---|---|---|---|---|
| 1 | Fail closed on `BETTER_AUTH_SECRET` — throw on startup if unset (outside test); add to `.env.example` | Critical | Security | `packages/server/src/lib/auth-secret.ts:3-28` |
| 2 | Execute the relicense as ONE atomic commit: remove 5 proprietary router mounts + 2 barrel re-exports, then delete `/proprietary` — keeps all builds/CI green | Critical | DevOps, Coupling, Architecture | `apps/dokploy/server/api/root.ts:31-35`; `packages/server/src/index.ts:38-39` |
| 3 | Stub `hasValidLicense` fail-CLOSED (return `false`) and remove the `enterpriseOnlyResources` bypass — prevents custom-role privilege escalation | Critical | Security, Coupling | `packages/server/src/services/permission.ts:39-74`; `lib/access-control.ts:58` |
| 4 | Remove the backtick from `DATABASE_PASSWORD_REGEX` and stop shell-interpolating password/user — use `PGPASSWORD`/stdin + argv exec | High | Security | `packages/server/src/db/schema/utils.ts:16-17`; `postgres.ts:441-460` |
| 5 | Validate `customGitUrl`/branch (URL allowlist, argv to git) and write SSH keys to per-deploy 0600 mkstemp paths | High | Security | `packages/server/src/utils/providers/git.ts:46-85` |
| 6 | Harden `apps/api` auth: refuse to start if `API_KEY` unset, use `timingSafeEqual`, require `INNGEST_SIGNING_KEY` | High | Security | `apps/api/src/index.ts:85-97` |
| 7 | Gate terminal/docker-exec WS upgrade handlers with the same `checkPermission` as tRPC | High | Security, Architecture | `apps/dokploy/server/wss/terminal.ts:87-174`; `docker-container-terminal.ts:30-68` |
| 8 | Re-implement audit logging unconditionally (drop license gate); keep the `auditLog` table/types, rewire `audit()` off `/proprietary` | High | Security, Coupling | `packages/server/src/lib/auth.ts:317,341`; `services/proprietary/audit-log.ts:25-28` |
| 9 | Replace `enterpriseProcedure` with `adminProcedure` at `settings.ts:449,471` (real self-hosted features) | High | Coupling | `apps/dokploy/server/api/routers/settings.ts:449,471` |
| 10 | Generate migration `0169` dropping the 8-9 user enterprise columns + `whitelabelingConfig`/`enforceSSO`; neutralize `enforceSSO` readers in the same PR | High | DB Schema | `packages/server/src/db/schema/user.ts:55-71`; `web-server-settings.ts:69-102` |
| 11 | Get the lint gate green (`biome check . --write` + scoped ignores) and make it a required CI check; update/remove the 3 proprietary permission tests | High | Quality, DevOps | `biome.json`; `apps/dokploy/__test__/permissions/*.test.ts` |
| 12 | Delete cross-repo sync jobs + `DOCS_SYNC_TOKEN`; re-point all image names to the fork namespace (GHCR) with fork secrets | High | DevOps, De-brand | `.github/workflows/dokploy.yml:9,166-241`; `monitoring.yml:8`; `deploy.yml:22-24` |
| 13 | Replace `LICENSE.MD` with Apache-2.0, delete `LICENSE_PROPRIETARY.md`, set `license: "Apache-2.0"` in all package.json; add a CI no-import-from-`/proprietary` check + license allowlist gate | High | DevOps, Dependencies, Security | `LICENSE.MD`; root + `packages/server/package.json` |
| 14 | Add characterization/golden tests for the highest-risk `packages/server` pure functions (deploy command building, env interpolation, docker/compose generation) before any Rust port | High | Quality, Rust | `packages/server/src/services/` |
| 15 | Begin the Rust strangler-fig at the SSH/process exec primitive (`crane-exec` via NAPI-RS), preserving exact signatures and behavior; defer the deploy core to last | High | Rust, Architecture, Security | `packages/server/src/utils/process/execAsync.ts:142` |

---

*Generated from a nine-dimension read-only audit. No files were modified during this review. All citations are `file:line` against the working tree at the review date.*
