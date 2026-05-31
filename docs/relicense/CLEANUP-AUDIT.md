# Relicense + SSO-Removal Cleanup Audit

Consolidated, de-duplicated cleanup plan for the session range `d56a17c8..HEAD`
(Apache-2.0 relicense, ~10 security commits, OAuth/SSO + enterprise-toggle
removal). All claims below were independently re-verified read-only against the
working tree on 2026-05-31.

## Verdict

**issues-found.** The relicense, the schema migration (0169), and the OAuth/SSO
removal at the *routable* layer are correct and complete. But two things block
"done":

1. **One genuine security hole** survives the hardening pass: the
   `changePassword` shell-injection fix was applied to `postgres` only. The
   `mongo`/`mysql`/`mariadb` `databaseUser` and the `redis` stored
   `databasePassword` remain shell-injectable (stored at create-time with no
   regex, then spliced into a `bash` command at changePassword time).
2. **SSO removal is incomplete in residue:** the server `sso()` plugin is gone,
   but the client `ssoClient()` plugin, the `@better-auth/sso` dep in two
   `package.json`s, and a pile of dead SSO code/exports remain.

Everything else is dead code / dead deps that is safe to remove now.

---

## 1. Security verdicts (one line each)

| Fix | Verdict | Note |
|-----|---------|------|
| postgres changePassword `databaseUser` regex `/^[A-Za-z0-9_]+$/` + `"${databaseUser}"` quoting | **confirmed** | postgres.ts:443 guard + tightened quoting; `password` also guarded by DATABASE_PASSWORD_REGEX (backtick now blocked). Correct *for postgres only*. |
| mongo/mysql/mariadb `databaseUser` + redis `databasePassword` changePassword | **BROKEN** | Same class of bug, NOT fixed. mongo.ts:441, mysql.ts:440 (`targetUser`=databaseUser), mariadb.ts:422, redis.ts:428 splice unguarded stored values into single-quoted `bash`. Schemas: mongo.ts:122 / mysql.ts:114 / mariadb.ts:116 = `z.string().min(1)`, redis.ts:102 = `z.string()` — no metachar filter. `databaseRootPassword` (mysql:118 / mariadb:120) IS regex-guarded and is safe — do NOT widen the fix to it. |
| git.ts `shq()` POSIX single-quote escaping | **confirmed** | All user/DB-controlled splices wrapped; the one raw `gitSshCommand` is itself `shq()`-wrapped (git.ts:89) and port is `Number()`-coerced. No raw site. |
| auth-secret fail-closed (`resolveBetterAuthSecret`) | **confirmed** | No runtime weak-default; only NODE_ENV=test / NEXT_PHASE=build special-cases (server env, not HTTP-reachable); every other path throws. |
| apps/api API_KEY fail-closed + `safeEqual` (length guard before `timingSafeEqual`) | **confirmed** | Startup throws if unset (index.ts:22), constant-time compare with length guard (index.ts:28-35). |
| apps/api `/api/inngest` endpoint | **weak** | Middleware bypasses `/api/inngest` (index.ts:106); Inngest client/serve never set `signingKey`; service.ts:212 only `logger.warn`s when `INNGEST_SIGNING_KEY` unset instead of failing closed. If the key is unset, `/api/inngest` is an unauthenticated deploy/RCE-capable path. Pre-existing; not closed by hardening. |
| Traefik base64 config pipe + `${configPath}` | **confirmed** | YAML base64-encoded before `echo`; `configPath` gated by APP_NAME_REGEX. No live injection. |
| SECURE_COOKIES + single-admin `/sso` bypass closure | **confirmed** | `useSecureCookies`/`secure` follow `SECURE_COOKIES==='true'`; before-hook single-admin guard no longer has the `isSSORequest` early-out; `sso()` removed + `/sso/register` in disabledPaths means the after-hook SSO branch is unreachable dead code, not a bypass. |
| WS terminal / docker-exec RBAC gate | **confirmed** | `validateRequest` → `activeOrganizationId` → `findMemberByUserId` (org-scoped, throws→close on no member) → owner/admin check, all BEFORE any SSH/exec. Fail-closed. Local-host container exec by org owner/admin is not an escalation (already has host access). |

---

## 2. Must-fix before push

### 2.1 (CRITICAL) Shell injection via stored `databaseUser` / redis `databasePassword` in changePassword

- **Where:** `apps/dokploy/server/api/routers/mongo.ts:441`, `mysql.ts:440`,
  `mariadb.ts:422`, `redis.ts:428`; schemas
  `packages/server/src/db/schema/{mongo.ts:122,mysql.ts:114,mariadb.ts:116}` and
  `redis.ts:102`.
- **Why it's real:** `apiCreateMongo`/`apiCreateMySql`/`apiCreateMariadb` pick
  `databaseUser:true` where the schema is `z.string().min(1)` (no metachar
  filter); `apiCreateRedis` picks `databasePassword:true` where the schema is
  `z.string()`. The `changePassword` `.input()` only re-validates the new
  `password`, never the stored field. A tRPC create with e.g.
  `databaseUser: "x'; touch /tmp/pwned; '"` is accepted, stored, then breaks out
  of the single quote at changePassword time under
  `execAsync(command, { shell: "/bin/bash" })`. The UI default ("mongo") does
  not protect the tRPC boundary.
- **Fix (mirror the postgres pattern):** add an identifier guard in each
  changePassword (`if (!/^[A-Za-z0-9_]+$/.test(databaseUser)) throw BAD_REQUEST`),
  or shell-quote via the existing `shq()` helper / pass `docker exec` args as an
  array. For redis, validate the stored `databasePassword` (add
  DATABASE_PASSWORD_REGEX to redis.ts:102). Best: constrain `databaseUser` with a
  regex at creation in all DB schemas so stored values are safe by construction.
- **Do NOT** add a guard to `databaseRootPassword` — it is already
  regex-guarded and safe.

> The `/api/inngest` signing-key gap (security "weak" above) is a real pre-existing
> exposure but is out of this session's diff. It is listed under **Deferred** as
> a hardening decision, not a session regression — flag it loudly, don't silently
> bundle it into the relicense push.

---

## 3. Safe cleanups (apply now)

Ordered so dependency removals (which require `pnpm install`) come last.

### Dead code / dead config (no install needed)

1. **Dead `else if (isSSORequest)` after-hook branch.**
   `packages/server/src/lib/auth.ts` — delete `const isSSORequest = ...` (line
   189) and collapse the `if (IS_CLOUD || !isAdminPresent) { ... } else if
   (isSSORequest) { ...26 lines... }` (lines 225-268) down to just the
   `if (IS_CLOUD || !isAdminPresent)` body, dropping the entire
   `else if (isSSORequest)` arm (lines 245-267). Branch is unreachable (zero
   server-side `@better-auth/sso` imports → no `/sso` path). Keep the
   `ssoProvider` table.
2. **Dead `auth.registerSSOProvider` / `auth.updateSSOProvider` exports.**
   `packages/server/src/lib/auth.ts:408-409` — delete both lines. Zero consumers
   repo-wide; resolve to `undefined` now that `sso()` is removed. (Critic
   confirmed: tsc is green either way — these are runtime-dead, not a build
   break.)
3. **Orphaned `ssoClient()` client plugin.**
   `apps/dokploy/lib/auth-client.ts` — remove the import on line 2 and the
   `ssoClient()` entry on line 17. Must be done *before* removing the
   `@better-auth/sso` dep from `apps/dokploy/package.json`.
4. **Orphaned `enforceSSO` prop in `pages/index.tsx`.** No longer destructured
   or rendered (component is `Home({ IS_CLOUD }: Props)` at line 57). Remove
   `enforceSSO: boolean;` from `Props` (line 55), `enforceSSO: false` from the
   cloud return (line 412), and `enforceSSO: webServerSettings?.enforceSSO ?? false`
   from the non-cloud return (line 443). The `webServerSettings` fetch at line
   438 then has no remaining consumer in the props — drop the now-orphaned
   `const webServerSettings = await getWebServerSettings();` (line 438) too.
   Leave the `enforceSSO` DB column intact. (Note: `update-server-config.test.ts:55`
   references the *DB-column* `enforceSSO` on a full webServerSettings mock — it
   is unaffected by removing the index.tsx prop.)
5. **Dead `ssoProviderBodySchema` Zod export (~100 lines).**
   `packages/server/src/db/schema/sso.ts` — delete `ssoProviderBodySchema`
   (lines 32-133) and the `domainRegex` const (line 31, used only by that
   schema). Zero consumers (sole caller was the deleted proprietary `sso.ts`
   router). KEEP the `ssoProvider` pgTable (lines 7-19) and `ssoProviderRelations`
   (lines 21-30) — intentionally dormant for the Rust SSO rebuild.
6. **Dead OAuth test env vars.**
   `apps/dokploy/__test__/vitest.config.ts:15-18` — remove the four unused
   `GITHUB_CLIENT_ID/_SECRET`, `GOOGLE_CLIENT_ID/_SECRET` `define.process.env`
   entries (the socialProviders reader was deleted from auth.ts).
7. **Dead `"/sso/register"` disabledPaths entry.**
   `packages/server/src/lib/auth.ts:37` — optional, lowest priority. Disabling a
   non-existent route is a no-op; removing it is cosmetic.

### Dead-weight allowlist entry (no install regeneration strictly needed)

8. **`better-sqlite3` in `pnpm.onlyBuiltDependencies`.**
   root `package.json:66` — remove the `"better-sqlite3",` entry. Not a declared
   dependency anywhere; app uses postgres. The Go monitoring SQLite is not a Node
   dep.

### Dependency removals (run `pnpm install` after — do these LAST)

9. **`@better-auth/sso` in `packages/server/package.json:42`** — remove. Server
   `sso()` plugin removed this session; zero source imports in
   `packages/server/src`. Safe immediately.
10. **`@better-auth/sso` in `apps/dokploy/package.json:51`** — remove **only
    after** safe-cleanup #3 (deleting the `ssoClient` import). Removing the dep
    while the import survives breaks the build.
11. **`@better-auth/utils` in `packages/server/package.json:43`** — remove
    (redundant direct declaration; still available transitively via better-auth).
    Pre-existing, low priority.
12. **`@oslojs/crypto` / `@oslojs/encoding` in
    `packages/server/package.json:47-48`** — remove (zero source imports, dead
    before this session). Pre-existing, low priority.
13. After 9-12 + `pnpm install`, **verify `samlify` and `node-forge` are gone
    from `pnpm-lock.yaml`** — they only reach the tree transitively via
    `@better-auth/sso` (the node-forge `BSD-3-Clause OR GPL-2.0` dual-license
    concern in docs/REVIEW.md:107 disappears with them). If they persist, another
    consumer pulls them.

---

## 4. Deferred (need a decision / risky — do NOT auto-apply)

- **`/api/inngest` signing-key hardening.** Assert `INNGEST_SIGNING_KEY` at
  startup (same fail-closed pattern as API_KEY) and/or pass `signingKey`
  explicitly to the Inngest client/serve so unsigned requests are rejected. This
  is a real pre-existing exposure but a behavior/ops decision (it changes startup
  requirements and dev-mode flows), not a mechanical relicense cleanup. Decide
  separately. **(security "weak")**
- **`@faker-js/faker` in `apps/dokploy/package.json:62`.** Likely redundant
  (faker is imported only in `packages/server`, available transitively via
  `@dokploy/server`). KEEP if there's intent to use faker directly in
  apps/dokploy seed/test scripts; verify no untracked usage before removing.
  Pre-existing, lowest confidence.
- **Dependabot vuln "fixes" via major upgrades.** Do **NOT** blind-bump major
  versions to silence advisories. Each major (better-auth, drizzle, next,
  inngest, etc.) needs an isolated, tested upgrade with a behavior diff. Out of
  scope for this relicense/cleanup push.
- **Dropping the dormant `ssoProvider` table / `@better-auth/sso` package
  entirely.** Intentionally retained for the future Rust SSO rebuild
  (AGENTS.md HARD RULE 4 + relicense plan). Do not remove the table or, while the
  client plugin path is being decided, prematurely purge the package beyond the
  steps above.

---

## 5. Confirmed-correct (no action)

- Migration `0169_flawless_shatterstar.sql` drops exactly the 4 intended columns
  (`user.{enableEnterpriseFeatures,licenseKey,isValidEnterpriseLicense}`,
  `webServerSettings.whitelabelingConfig`) and nothing else. Drizzle journal +
  snapshots are append-only and consistent (chain prevId intact, version 7).
- Zero surviving code reads any dropped column (rg over the tree excluding
  drizzle history / docs / lockfile = empty). Postgres will not throw
  "column does not exist".
- Surviving columns `isEnterpriseCloud` / `remoteServersOnly` / `enforceSSO`
  are present and consistent with their readers (the `enforceSSO` column is now
  a dormant no-op at the UI layer — a documented OAuth/SSO concern, not a schema
  defect).
- OAuth/SSO removal is complete at the routable layer (no `sso()` plugin, no
  socialProviders, no sign-in components, root.ts mounts dropped). Only dead
  client/dep residue remains (covered in §3).
