# De-brand Checklist: Dokploy → Crane

**Scope note:** This is a *roadmap*, not part of the Apache-2.0 relicensing execution
pass. The relicensing pass removes `/proprietary` code and rewrites the license files
only. The rename below is large (**2541 "dokploy" occurrences across 615 files**) and
splits into cosmetic changes (safe, do anytime) and runtime/ABI changes (breaking,
require a migration + version bump). Do the SAFE tier freely; schedule the RISKY tier
deliberately.

> Trademark note: "Dokploy" and its logo are Dokploy Technology, Inc. trademarks.
> Apache-2.0 grants no trademark rights (LICENSE §6). The fork must not present itself
> as Dokploy. Removing the name/logo from user-facing surfaces is a legal requirement,
> not just cosmetic — prioritize the SAFE tier accordingly.

---

## Tier 1 — SAFE (cosmetic, no runtime/data impact)

Do these first. No migration, no API/ABI break.

| Area | Action | Pattern / location |
|---|---|---|
| README / docs | Replace branding, tagline, badges | `README.md`, `docs/`, `GUIDES.md`, `CONTRIBUTING.md`, `SECURITY.md` |
| Logos & images | Replace Dokploy art | `.github/sponsors/logo.png`, `apps/dokploy/public/images/`, favicons |
| Marketing URLs | Repoint or remove | `dokploy.com`, `app.dokploy.com`, `docs.dokploy.com` |
| Community links | Replace/remove | Discord invite `discord.gg/2tBnJ3jDJc`, guild widget ID `1234073262418563112` |
| UI copy | Page titles, headers, emails, toasts | `apps/dokploy/public/locales/**`, `apps/dokploy/components/**`, `packages/server/src/emails/**` |
| `package.json` `name` | `"dokploy"` → `"crane"` (root + the `"name"` of the web app) | root `package.json`, `apps/dokploy/package.json` |
| `package.json` `license` | Set `"Apache-2.0"` where present | `rg '"license"' --glob '!**/node_modules/**'` |

Suggested safe sweep (review each diff — do **not** run blind):
```bash
rg -l "Dokploy" --glob '!**/node_modules/**' --glob '!**/drizzle/**' --glob '!pnpm-lock.yaml'
# then targeted, reviewed sed per file — never a global replace across the repo
```

---

## Tier 2 — RISKY / BREAKING (deliberate, needs migration + version bump)

Each of these is a contract with something external (an existing install, an operator's
env, a running Traefik/Docker plane, or the DB). Renaming **breaks upgrades** unless you
ship a migration/compat shim. Recommendation: keep these as-is for now; rename in a
dedicated, versioned change.

| Identifier | Why breaking | Count | Recommended handling |
|---|---|---|---|
| `@dokploy/server` workspace alias | Every import + tsconfig `paths` + build config | 821 hits / 336 files | Rename in one mechanical pass (package name + `paths` + imports) — internal only, no external ABI, but big. Safe once typecheck is green. |
| `/etc/dokploy/**` on-disk paths | Runtime ABI — existing installs store SSH keys, Traefik config, certs, backups there | many | Keep, or rename with a data-migration + symlink shim. Touches `packages/server/src/constants`, `server/wss/terminal.ts`, Traefik mounts. |
| `DOKPLOY_*` env vars (`DOKPLOY_DOCKER_HOST/PORT/API_VERSION`, `DOKPLOY_DEPLOY_URL`, `DOKPLOY_CLOUD_IPS`) | Operator-facing config contract | 6 | Keep, or support both names during a deprecation window. |
| Docker/Traefik names (`dokploy-network`, `dokploy-router-*`, `dokploy-service-*`, `dokploy-traefik`, `dokploy-deployments`, `dokploy-bucket`) | Live orchestration plane — renaming orphans running containers/labels/routers | many | Keep, or migrate with a coordinated redeploy. Heavy `__test__` coupling — update golden tests in lockstep. |
| DB columns `dokployRestart`, `dokployBackup` (`schema/notification.ts`) | Schema + read sites | 10 | Keep (cosmetic only); rename = a migration for zero functional gain. |
| `drizzle/**` historical SQL + snapshots | Immutable migration history | 66+ | **Never edit.** Names there are frozen history. |

---

## Verification (after a SAFE-tier pass)

```bash
# user-facing branding gone from shipped surfaces (UI, emails, README)
rg -i "dokploy" apps/dokploy/components apps/dokploy/public README.md \
   --glob '!**/node_modules/**'
```

Expect only intentional survivors (the `@dokploy/server` alias and runtime identifiers
in Tier 2 until they are deliberately migrated).
