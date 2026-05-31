# Crane: TypeScript → Rust Migration Roadmap

A phased **strangler-fig** plan to progressively rewrite Crane's TypeScript
runtime into Rust without stopping shipping. This document is an architectural
roadmap, not an implementation order of record — sequencing assumptions are
called out so they can be revised as the relicensing (Apache-2.0 / `/proprietary`
deletion) lands.

> Scope note: this roadmap covers the **migration path only**. It assumes the
> relicensing work (delete `/proprietary`, neutralize the license gate, stub the
> SSO/OAuth sign-in buttons) is handled separately and is a prerequisite for
> the OAuth/SSO greenfield section at the end.

---

## 1. Guiding principles

1. **Keep shipping.** The product is customer deployments. No phase may take the
   deploy path offline. Every Rust component lands behind a feature flag with the
   TypeScript implementation kept as a live fallback until the Rust path has
   proven itself in production.
2. **Replace the edges first, the core last.** Migrate *leaf executors* (SSH/process
   exec, the Docker/Swarm client, the WebSocket byte-pumps) before the
   orchestration logic that calls them. The deploy/build orchestration core is the
   densest, least-typed, highest-risk surface — it goes last, only after its
   primitives are already Rust-native.
3. **One stable interop boundary, chosen per component.** Two seams exist and the
   codebase already favors specific ones:
   - **NAPI-RS native modules** for things that live *inside* the Next.js Node
     process (exec, Docker client, WebSocket servers). Preserve the existing TS
     function signatures (`execAsync`, `getRemoteDocker`) so the `@dokploy/server`
     import graph and the deploy hot-path stay unchanged.
   - **Standalone Rust processes** (axum/Redis) for the apps that are *already*
     separate processes over a network contract (`apps/api` over HTTP, `apps/schedules`
     over Redis). These can be swapped by deployment, with zero source change to callers.
4. **Preserve external contracts byte-for-byte.** The on-disk ABI (`/etc/dokploy`
   tree + Traefik file-provider), the BullMQ/Redis wire format, the Inngest event
   shape, the Docker Engine REST contract, and the Postgres schema are all shared
   state. Each must be reproduced exactly before a flag flips; snapshot tests
   against current output are the gate.
5. **The database is the shared truth.** Rust and TypeScript will run against the
   **same Postgres** during the whole transition. Freeze the Drizzle migration
   toolchain in TS; the schema layer is the *last* thing to move, not the first.
6. **The UI never moves.** The Next.js pages-router app + tRPC end-to-end type
   inference stays TypeScript indefinitely (see §4).

---

## 2. System shape (what we are migrating)

| App / package | Role | Language today | Migration disposition |
| --- | --- | --- | --- |
| `apps/dokploy` | Next.js pages-router UI + 48 tRPC routers + in-process BullMQ deploy worker + 6 WebSocket servers | TS | UI/tRPC **stays TS**; exec/Docker/WSS primitives go Rust via NAPI-RS |
| `apps/api` | Hono + Inngest remote-deploy dispatcher (`/deploy`, `/cancel-deployment`) | TS | Dispatch shell → axum (standalone process) |
| `apps/schedules` | Hono + BullMQ backup/cron executor (3 workers) | TS | Queue runtime → axum + apalis (standalone process) |
| `apps/monitoring` | Fiber service, own SQLite, HTTP-only | **Go** | **Not a TS→Rust candidate** — already decoupled; reference pattern |
| `packages/server` | ~40k LOC god-module: Drizzle schema + all services + all docker/swarm/traefik/ssh utils | TS | Migrate *bottom-up* by sub-domain; schema last |

The structural reality that drives everything below: **the real work always lives
in `packages/server`.** `apps/api` and `apps/schedules` are thin dispatchers that
re-enter the same service functions. So those apps cannot fully move to Rust until
the primitives they transitively call are Rust — which is why the primitives are
phased first.

---

## 3. Ranked component table

Ranked by recommended phase. "Why" = why it is a good (or bad) candidate at this
position. Risk reflects correctness/blast-radius if the Rust port diverges.

| # | Component | Candidate? | Why | Rust crates | Interop mechanism | Risk | Phase |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **SSH + process exec** — `execAsync` / `execAsyncRemote` (`packages/server/src/utils/process/execAsync.ts:142`) | **Yes — first cut** | Narrowest, highest-leverage seam: 4 funcs, `string → {stdout,stderr}` + optional `onData` stream, no DB/business logic. Transport for *every* remote deploy/backup. Also a command-injection hotspot (callers concat git URLs/branches/app names into shell strings) so a Rust executor with explicit argv hardens it. | `russh` or `openssh`, `russh-keys`, `tokio`, `tokio` process | NAPI-RS native module behind the **same** `execAsync`/`execAsyncRemote` signatures (or local Unix-socket sidecar with a streaming RPC for `onData`) | **Medium** — must match interactive PTY streaming, exact stderr interleaving, the long timeout, and the friendly auth-error messaging callers depend on | **P1** |
| 6 | **WebSocket terminal / log / stats streaming** — `apps/dokploy/server/wss/*` (6 servers) | **Yes — bundle with P1** | Real-time byte pumps, no business logic, natural Rust fit, and they reuse the *same* ssh2/node-pty primitives as #1. Low priority only because they ride inside the Next.js HTTP upgrade handler. | `russh`, `portable-pty` (replaces `node-pty`), `tokio-tungstenite` or `axum::extract::ws` | Route-based: a separate `crane-wss` Rust process behind a reverse-proxy rule for `/terminal`, `/docker-container-terminal`, `/docker-stats`, etc. Easy per-path rollback. | **Low** — isolated, well-bounded | **P1 (alongside #1)** |
| 2 | **Docker / Swarm client** — `getRemoteDocker` (`remote-docker.ts:5`), `mechanizeDockerContainer` (`builders/index.ts:77`), `docker/utils.ts` (30+ funcs) | **Yes — second cut** | Docker Engine API is a stable REST contract; `bollard` models Swarm `ServiceSpec` natively; the logic is mechanical mapping, no UI. Depends on #1 because remote Docker tunnels over SSH. | `bollard`, `hyper`, `http`, `serde` | NAPI-RS behind existing `getRemoteDocker` / `mechanizeDockerContainer` signatures so `application.ts`/`compose.ts`/`databases/*` callers are unchanged. SSH-tunneled remote Docker reuses #1's transport to forward the socket. | **Medium-High** — the Swarm update path (read `inspect.Version.Index`, bump `ForceUpdate`, `builders/index.ts:172`) and authConfig handling must be byte-faithful or deploys silently no-op/duplicate | **P2** |
| 3 | **Scheduler runtime** — `apps/schedules` (Hono + BullMQ 3 workers, `runJobs` `utils.ts:31`) | **Partial — port the shell** | Queue/HTTP plumbing is trivial to port (the easy 80%). But the *job bodies* are the whole backup engine living in `@dokploy/server`, so it can't fully move until those services' exec/docker primitives are Rust. | `axum` (replaces Hono), `apalis` or `tokio-cron-scheduler` (Redis via `deadpool-redis`/`fred`), `serde` | Standalone Rust process speaking the **same Redis `backupQueue` protocol** — enqueue from TS, consume in Rust, run side-by-side. Job bodies delegate to #1/#2 Rust primitives. | **Medium** — BullMQ job/repeatable-key wire format must match exactly or schedules silently duplicate/drop | **P3** |
| 4 | **Deploy dispatcher / API** — `apps/api` (Hono + Inngest, `index.ts:24`) | **Partial — port the shell** | Thin dispatcher: HTTP + `X-API-Key` auth + Inngest forward. The `deploy()` body is the orchestration core (#5). The boundary is already a network seam (Next.js calls it over HTTP), so low-friction swap. | `axum` + `tower` (HTTP + API-key middleware), `serde` + `validator` (replaces zod-validator), `reqwest` (call Inngest HTTP) or `apalis` + Postgres outbox | Drop-in axum service on the same port/contract. | **Medium** — must reproduce Inngest `cancelOn` + `concurrency` key (`limit: 1` per `serverId`) and `retries: 0`; losing per-server concurrency=1 lets concurrent deploys race the Swarm | **P4** |
| 5 | **Deploy/build orchestration core** — `deployApplication`/`deployCompose` (`application.ts:168`), builders (nixpacks/railpack/buildpacks/dockerfile/static), git providers, Traefik config | **Yes — last, highest value/risk** | The heart of the product. Assembles a single `set -e;` bash blob (clone + patch + build + push), pipes it over SSH, then `mechanizeDockerContainer`. Transitively depends on **every** primitive above and has the densest, least-typed surface (string-built shell, base64 log piping). | `git2`/`gix` (clone, replaces shelling git), `bollard` (build/buildkit), `serde_yaml`/`serde_yml` (Traefik config, replaces YAML lib + `writeFileSync`), `tokio` (stream logs to `logPath`) | NAPI-RS behind `deployApplication`'s signature. **Strangle one `buildType` at a time** behind a flag keyed off `application.buildType`, starting with `dockerfile`/`static` (simplest), falling back to the TS path. | **High** — this path *is* the product; any divergence breaks customer deploys. Keep the TS impl as a live fallback through the entire transition. | **P5** |
| — | **Next.js UI + tRPC + Drizzle ORM layer** — `apps/dokploy` pages + 48 routers + 45 schema modules | **No — stays TS** | tRPC's end-to-end type inference has no Rust equivalent without giving up the client model. Router/service split is 1:1 and rewrite-friendly *as a facade*. | n/a | This layer is the **consumer** of every seam above — it keeps calling identically-shaped shims/services. | **N/A** | **Do not migrate** |
| — | **`apps/monitoring`** (Go/Fiber/SQLite) | **No — not TS** | Already a separate process, narrow HTTP contract, own storage, its own LICENSE. | n/a | Reference pattern for the rest. | **N/A** | **No action** |

---

## 4. What stays TypeScript (indefinitely)

- **The Next.js pages-router UI** and all React/tRPC client–server type sharing.
- **The 48 tRPC routers** — they remain the stable orchestration *facade*. They
  handle zod validation, permission checks, and audit logging, then delegate to
  services. Keep this thin-adapter pattern; it is the most rewrite-friendly part
  of the codebase precisely because the business logic is *not* in it.
- **Auth/session** (`validateRequest`, better-auth) until a dedicated Rust auth
  gateway exists (and even then, exposed behind one token-introspection interface
  that both an HTTP gateway and the WS gateway call).
- **The Drizzle schema + migration toolchain.** 45 schema modules, 170 migrations.
  This is the de-facto data contract. Freeze it in TS and let Rust read the *same*
  Postgres tables (via `sqlx`/`SeaORM`) generated off a language-neutral artifact
  (the existing `schema.dbml` is a starting point; otherwise emit SQL DDL). The
  schema is the **last** thing to port, if ever.

Treat `@dokploy/server`'s service-function signatures as the contract: when DB
access eventually moves to Rust, expose it behind the existing signatures so the
routers do not change.

---

## 5. Recommended first vertical slice (P1)

Do **not** start with the deploy core. Start with a single, end-to-end, low-risk
slice that exercises the interop boundary and produces visible value:

> **Slice: `crane-exec` (SSH + process executor) as a NAPI-RS module, validated
> through the host-terminal WebSocket.**

Why this slice:
- It is the **narrowest seam** in the whole system (`execAsync.ts:142`, 4
  functions, no DB, no business logic) and **everything else stands on it**.
- The host-terminal WSS (`apps/dokploy/server/wss/terminal.ts`) is the smallest
  consumer that exercises the full path — auth → resolve server → SSH shell →
  pipe bytes — so it doubles as a live integration test of the Rust transport
  with a tight, per-connection rollback.
- It hardens a real security surface (command-injection via shell-string
  concatenation) by moving to explicit argv arrays.

Concrete steps:
1. Build `crane-exec` (NAPI-RS) exposing `exec(command, env, cwd)` and
   `exec_remote(server, command, onData_stream)` over `russh`/`openssh` + `tokio`.
2. Implement a TS shim that re-exports the **same** `execAsync` / `execAsyncRemote`
   signatures, dispatching to the native module behind a `CRANE_RUST_EXEC` flag
   (default off).
3. Route the host-terminal WS path through it first (smallest blast radius).
4. Gate on the existing conformance harness in `apps/dokploy/__test__`
   (`mechanizeDockerContainer.test.ts`, `deploy/application.real.test.ts`, `wss/*`)
   — match stdout/stderr interleaving, exit codes, timeout, and the auth-error
   messaging before widening the flag.
5. Roll out flag → backup/cleanup remote-exec callers → full deploy path.

Once `crane-exec` is solid, fold in the rest of the WSS servers (#6, shares
`russh`/`portable-pty`), then build `crane-docker` (#2) on top of the same SSH
transport. That chain (P1 → P1-WSS → P2) is the foundation the schedules/api
shells (P3/P4) and finally the deploy core (P5) all stand on.

---

## 6. OAuth/SSO as a Rust greenfield module

The proprietary OAuth/SSO is being **deleted, not migrated** — there is no TS
implementation to strangle, so this is **greenfield Rust** and does not follow the
strangler-fig sequencing above. It slots in as an independent service whenever the
business wants the feature back.

Design constraints inherited from the deleted code:
- It must produce a session that **`validateRequest` (better-auth) accepts**, since
  tRPC context creation *and* all 6 WebSocket servers validate through that one
  primitive. The cleanest seam is a standalone Rust **auth gateway** that mints
  sessions into the same store better-auth reads, exposing **token introspection**
  as the single interface both the HTTP gateway and the WS gateway call.
- It writes to the existing Postgres user tables. Note the schema still carries the
  `ssoProvider` relation and the enterprise/stripe columns on `user`
  (`packages/server/src/db/schema/user.ts`); decide during relicensing whether to
  keep these as no-op columns (cheaper) or drop them via migration before the Rust
  module is built against them.

Recommended shape:
- Standalone **axum** service (`crane-auth`), separate process — same pattern as
  `apps/monitoring` and the P3/P4 standalone services.
- Crates: `axum` + `tower` (HTTP), `oauth2` (authorization-code flow), `openidconnect`
  (OIDC/SSO providers), `jsonwebtoken` (token signing/verification), `reqwest`
  (provider calls), `sqlx`/`SeaORM` (write the session/user rows).
- On the frontend, the deleted `SignInWithGithub` / `SignInWithGoogle` /
  `SignInWithSSO` buttons (today imported by `index.tsx` / `register.tsx`) are
  replaced — first by the email/password flow or stubs at deletion time, then by
  thin buttons that redirect to `crane-auth` endpoints when the Rust module lands.

Because this is greenfield, it is the **proof case** for the standalone-axum interop
seam: no fallback path to maintain, a clean network contract, and it validates the
auth-gateway pattern the rest of the system will eventually lean on.

---

## 7. Phase summary

| Phase | Deliverable | Depends on | Interop seam |
| --- | --- | --- | --- |
| **P1** | `crane-exec` (SSH/process) + `crane-wss` (6 WS servers) | — | NAPI-RS (exec) + standalone WS process behind reverse proxy |
| **P2** | `crane-docker` (bollard, replaces dockerode) | P1 (remote Docker tunnels over SSH) | NAPI-RS behind `getRemoteDocker`/`mechanizeDockerContainer` |
| **P3** | `crane-schedules` (axum + apalis, same Redis protocol) | P1, P2 (job bodies need Rust primitives) | Standalone process, shared Redis `backupQueue` |
| **P4** | `crane-api` (axum deploy dispatcher) | P1, P2 | Standalone process, same HTTP + `X-API-Key` contract |
| **P5** | Deploy/build core, one `buildType` at a time | P1–P4 | NAPI-RS behind `deployApplication`, flag-gated with TS fallback |
| **Greenfield** | `crane-auth` (OAuth/SSO) | relicensing complete | Standalone axum auth gateway, token introspection |
| **Never** | Next.js UI + tRPC + Drizzle schema | — | Stays TS; consumes all seams above |
