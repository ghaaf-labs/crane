# Crane Relicensing Plan: Apache-2.0

**Goal:** Relicense the entire `crane` (Dokploy fork) to Apache-2.0 by deleting all
`/proprietary` (DSAL) code and neutralizing the license gate. **No feature is ungated** —
gated capabilities (custom roles, per-user git-provider/server assignment, SSO sign-in
buttons, whitelabeling, audit-log viewer, license activation) are removed, not unlocked.
OAuth/SSO are to be rebuilt in Rust later.

This document is the human-readable runbook. The machine-applicable companion is
[`execution-spec.json`](./execution-spec.json). All line numbers below were verified
against the working tree at the time of writing; re-confirm with `rg` before each edit
because deleting lines shifts subsequent ones (always work top-to-bottom within a file,
or anchor on unique strings).

---

## 0. Key decisions (resolved from the coupling map's open questions)

| Topic | Decision | Rationale |
|---|---|---|
| **Audit-log service** | **Relocate** `createAuditLog`/`getAuditLogs` out of `/proprietary` to `packages/server/src/services/audit-log.ts` and **strip the `hasValidLicense` early-return** so audit logging is always-on Apache code. | Avoids editing the `audit()` helper's ~38 router callers + the 2 `lib/auth.ts` session hooks. The `auditLog` table + `AuditAction`/`AuditResourceType` types already live outside `/proprietary`. |
| **`use-whitelabeling` hook** | **Stub** it (keep file; both functions return `{ config: null }`, no `api.whitelabeling.*` call). | Its 16 consumers already handle `config: null`. Stubbing = 1 edit vs 16. Remove during the later Rust rewrite. |
| **`enterpriseOnlyResources` Set** | **Keep** as plain data in `access-control.ts`; keep the bypass logic in `permission.ts`. | No proprietary import; harmless. Removing it would force re-baselining permission tests for zero behavioral gain. Keeps `enterprise-only-resources.test.ts` valid. |
| **`resolveRole` non-static path** | Use the **SAFER** variant: after the `staticRoles` guard, `return null` and delete the `organizationRole` custom-role query + merge loop. | The map's "remove lines 47–50 only, keep the lookup" is a **behavior change** — a legacy non-static role would resolve to real custom-role perms with NO license check. `return null` is behavior-equivalent to the old unlicensed branch. |
| **`isEnterpriseCloud` column** | **KEEP** (out of scope). | It gates billing/cloud UI, not the license. 22 readers in `stripe/webhook.ts` + `show-billing.tsx`. Dropping it is a separate billing-removal decision. **Flag to owner.** |
| **Stripe/billing path** | **KEEP** (out of scope). | Not under `/proprietary`. **Flag to owner** if billing is also to be removed. |
| **better-auth `sso()` plugin + `ssoProvider` schema table** | **KEEP dormant.** Do NOT touch `lib/auth.ts:401` `sso()`, the `@better-auth/sso` import (line 3), the `isSSORequest` branch (254–277), or `schema/sso.ts`. | Owner will rebuild SSO in Rust. Leaving the plugin/table dormant = zero edits and no half-broken branch. Only the proprietary SSO **router** + **UI** are removed. |
| **`enforceSSO` / `remoteServersOnly` columns** | **KEEP.** | Real self-hosted features. Their endpoints just switch from `enterpriseProcedure` to `adminProcedure`. **Note:** with the SSO sign-in UI removed, `enforceSSO=true` becomes a silent no-op until the Rust rebuild — **flag to owner** to confirm no org currently has it enabled, or accept dormancy. |

---

## 1. Directories & files to DELETE outright

```
packages/server/src/services/proprietary/                 (license-key.ts, sso.ts, audit-log.ts)
apps/dokploy/server/api/routers/proprietary/              (audit-log, custom-role, license-key, sso, whitelabeling)
apps/dokploy/components/proprietary/                       (audit-logs/, auth/, license-keys/, roles/, sso/, whitelabeling/, enterprise-feature-gate.tsx)
apps/dokploy/server/utils/enterprise.ts                   (license-server HTTP client; sole consumer = deleted license-key router)
packages/server/src/utils/crons/enterprise.ts             (license-server polling cron)
apps/dokploy/pages/dashboard/settings/license.tsx         (proprietary LicenseKeySettings page)
apps/dokploy/pages/dashboard/settings/sso.tsx             (proprietary SSOSettings page)
apps/dokploy/pages/dashboard/settings/whitelabeling.tsx   (proprietary WhitelabelingSettings page)
apps/dokploy/pages/dashboard/settings/audit-logs.tsx      (proprietary ShowAuditLogs page)
packages/server/auth-schema2.ts                           (generated better-auth artifact; only referenced by a script)
LICENSE_PROPRIETARY.md                                    (DSAL license text)
apps/dokploy/__test__/permissions/enterprise-only-resources.test.ts  (DELETE ONLY IF the Set is removed — under our KEEP decision, this file STAYS)
```

> **Note:** `use-whitelabeling.ts` appeared in the map's deletion list but under the
> stub decision it is **kept and edited**, not deleted. `enterprise-only-resources.test.ts`
> is **kept** under the KEEP-Set decision.

---

## 2. Ordered execution sequence

### Step 1 — Delete the three `/proprietary` dirs + standalone DSAL files
Delete everything in §1 except the two conditional entries. This is what breaks the
build; the remaining steps fix every caller.

### Step 2 — Fix the package barrel `packages/server/src/index.ts`
- **Delete line 38** `export * from "./services/proprietary/license-key";`
- **Delete line 39** `export * from "./services/proprietary/sso";`
- **Delete line 89** `export * from "./utils/crons/enterprise";`
- **Add** a re-export for the relocated audit-log service (so `@dokploy/server`
  consumers keep working): `export * from "./services/audit-log";` near the other
  `services/*` exports. (Optional but tidy; `audit.ts` and `auth.ts` import by direct
  path, so it is not strictly required.)

### Step 3 — Relocate the audit-log service (Apache, always-on)
Create `packages/server/src/services/audit-log.ts` containing the bodies of the deleted
`proprietary/audit-log.ts`, **minus** the `hasValidLicense` import and the
`const licensed = await hasValidLicense(...); if (!licensed) return;` early-return in
`createAuditLog`. Keep `createAuditLog`, `getAuditLogs`, `CreateAuditLogInput`,
`GetAuditLogsInput`, and the `export type { AuditAction, AuditResourceType }` re-export.

### Step 4 — Fix shared services in `packages/server/src/services/`
**`permission.ts`**
- Delete line 3 `import { hasValidLicense } ... proprietary/license-key`.
- In `resolveRole` (38–72): after the `if (staticRoles[roleName]) return ...` guard,
  replace the rest of the body with `return null;` and delete the `hasValidLicense`
  call, the `organizationRole` query, the empty-check, and the merge loop. (SAFER
  variant — see Decisions.)
- **Keep** lines 87 & 194 (`enterpriseOnlyResources.has(...)`) and the
  `enterpriseOnlyResources` import — Set stays.

**`git-provider.ts`**
- Delete line 3 (`hasValidLicense` import).
- In `getAccessibleGitProviderIds`, replace
  `const licensed = await hasValidLicense(...); const assignedSet = licensed ? new Set(memberRecord?.accessedGitProviders ?? []) : new Set<string>();`
  with `const assignedSet = new Set<string>();`. Preserves the unlicensed (own+shared-only) behavior.

**`server.ts`**
- Delete line 8 (`hasValidLicense` import).
- In `getAccessibleServerIds`, replace the
  `const licensed = await hasValidLicense(...); if (!licensed) return new Set(allOrgServers.map(...)); return new Set(memberRecord?.accessedServers ?? []);`
  block with `return new Set(allOrgServers.map((s) => s.serverId));`. Preserves the
  unlicensed (full-access, no per-server restriction) behavior.

### Step 5 — Fix `lib/auth.ts`
- Line 18: repoint `import { createAuditLog } from "../services/proprietary/audit-log";`
  → `import { createAuditLog } from "../services/audit-log";`. The two hooks at 317/341 are unchanged.
- Lines 384–393: delete the `enableEnterpriseFeatures` and `isValidEnterpriseLicense`
  entries from `user.additionalFields`.
- Lines 514–515: delete the two `enableEnterpriseFeatures`/`isValidEnterpriseLicense`
  assignments inside the API-key mock-session user object.
- Lines 564–567: delete the two `session.user.enableEnterpriseFeatures = ...` /
  `session.user.isValidEnterpriseLicense = ...` assignments.
- **Do NOT** touch line 3 (`@better-auth/sso` import), line 401 (`sso()`), or the
  `isSSORequest` branch (254–277) — SSO stays dormant.

### Step 6 — Fix tRPC plumbing
**`apps/dokploy/server/api/trpc.ts`**
- Delete line 12 `import { hasValidLicense } from "@dokploy/server/index";`.
- Delete the whole `enterpriseProcedure` block (the `export const enterpriseProcedure = t.procedure.use(...)` at ≈211–242, including the preceding doc comment).
- Delete lines 39–40 (`enableEnterpriseFeatures: boolean;` / `isValidEnterpriseLicense: boolean;`) from the `CreateContextOptions` session-user type.

**`apps/dokploy/server/api/utils/audit.ts`**
- Line 2: repoint `import { createAuditLog } from "@dokploy/server/services/proprietary/audit-log";`
  → `import { createAuditLog } from "@dokploy/server/services/audit-log";`. Do NOT delete the `audit()` helper.

### Step 7 — Unregister tRPC routers in `apps/dokploy/server/api/root.ts`
- Delete import lines 31–35 (`auditLogRouter`, `customRoleRouter`, `licenseKeyRouter`, `ssoRouter`, `whitelabelingRouter`).
- Delete registration lines 94–98 (`licenseKey`, `sso`, `whitelabeling`, `customRole`, `auditLog`).

### Step 8 — Fix `apps/dokploy/server/api/routers/settings.ts`
- Line 80: remove `enterpriseProcedure,` from the `../trpc` import list (`adminProcedure` is already imported at line 78).
- Line 449: `updateRemoteServersOnly: enterpriseProcedure` → `adminProcedure`.
- Line 471: `updateEnforceSSO: enterpriseProcedure` → `adminProcedure`.
- OpenAPI allowlist (the string array ≈716–724): remove `"auditLog"`, `"customRole"`, `"whitelabeling"`, `"sso"`, `"licenseKey"`.

### Step 9 — Fix the other router gate-calls
**`apps/dokploy/server/api/routers/git-provider.ts`**
- Delete line 8 (`hasValidLicense` import).
- Remove the `.use(async ({ ctx, next }) => { const licensed = await hasValidLicense(...); if (!licensed) throw FORBIDDEN; ... })` middleware (≈76–85) on `allForPermissions`, leaving `allForPermissions: withPermission("member", "update").query(...)`.

**`apps/dokploy/server/api/routers/server.ts`**
- Delete line 20 (`hasValidLicense` import).
- Remove the analogous `.use(...)` middleware (≈133–141) on `allForPermissions`.

**`apps/dokploy/server/api/routers/user.ts`**
- Delete line 33 (`hasValidLicense` import).
- In `assignPermissions`: delete the `const licensed = await hasValidLicense(...)` lookup (≈363–365) and the two `...(licensed && accessed* !== undefined ? { accessed* } : {})` spreads (≈371–376), leaving `await db.update(member).set({ ...rest }).where(...)`. Drop `accessedGitProviders, accessedServers` from the destructure at line 361 (they are no longer assignable).

### Step 10 — Fix startup `apps/dokploy/server/server.ts`
- Delete `initEnterpriseBackupCronJobs,` from the `@dokploy/server` import (line 9).
- Delete the call `await initEnterpriseBackupCronJobs();` (line 70).

### Step 11 — Fix UI pages
**`apps/dokploy/pages/_app.tsx`**
- Delete line 11 (`WhitelabelingProvider` import) and the `<WhitelabelingProvider />` render (line 52).

**`apps/dokploy/pages/index.tsx`** (login)
- Delete imports 17–19 (`SignInWithGithub`, `SignInWithGoogle`, `SignInWithSSO`).
- Delete the `{IS_CLOUD && <SignInWithGithub />}` / `{IS_CLOUD && <SignInWithGoogle />}` renders (181–182).
- Delete line 64 (`api.sso.showSignInWithSSO` query) and the `showSignInWithSSO` variable.
- Replace the SSO render branch (≈254–262 `{enforceSSO ? <SignInWithSSO enforce/> : showSignInWithSSO ? <SignInWithSSO>{loginContent}</SignInWithSSO> : loginContent}`) with just `{loginContent}`. **Flag:** silently disables enforced-SSO until Rust rebuild.
- `useWhitelabelingPublic()` at line 44/63 stays (stubbed hook returns `{ config: null }`).

**`apps/dokploy/pages/register.tsx`**
- Delete imports 12–13 (`SignInWithGithub`, `SignInWithGoogle`).
- Delete the `{isCloud && <div>...<SignInWithGithub/><SignInWithGoogle/>...</div>}` OAuth block (≈162–167) **and** the orphaned `{isCloud && <p>Or register with email</p>}` separator (≈168–172).

**`apps/dokploy/components/layouts/side.tsx`**
- Remove the `api.whitelabeling.get` query (≈904–907) and the `whitelabeling` variable.
- Remove the `footerText` render (≈1171–1173).
- Remove the `docsUrl`/`supportUrl` override logic (≈468–475) and drop `whitelabeling` from the options object (≈920) and the `whitelabeling?` opts type (≈446–448).
- Delete the four settings nav entries: **Audit Logs** (≈314–320), **License** (≈398–405), **SSO** (≈406–413), **Whitelabeling** (≈414–421).
- Remove now-unused icon imports (`ClipboardList` line 14, `Palette` line 29, and `Key`/`LogIn` if their only use was the deleted nav entries — verify each with `rg` before removing).

**`apps/dokploy/utils/hooks/use-whitelabeling.ts`** (STUB, do not delete)
- Replace both function bodies so neither calls `api.whitelabeling.*`; each returns `{ config: null }`.

### Step 12 — Fix users settings components
**`apps/dokploy/pages/dashboard/settings/users.tsx`**
- Delete line 9 (`ManageCustomRoles` import) and the `{isOwnerOrAdmin && <ManageCustomRoles />}` render (line 23). Keep the rest of the page.

**`apps/dokploy/components/dashboard/settings/users/add-permissions.tsx`**
- Delete line 6 (`EnterpriseFeatureLocked` import).
- Remove the `api.licenseKey.haveValidLicenseKey` query (≈202–203) and the `haveValidLicense` variable.
- Per-user git-provider/server assignment is a removed feature: delete the gated field blocks AND their `<EnterpriseFeatureLocked/>` else-branches (the two ternaries around ≈955–965 and ≈1030–1040) so neither the assignment UI nor the locked placeholder renders. **Read both ternaries fully before editing.**

**`apps/dokploy/components/dashboard/settings/users/show-users.tsx`**
- Remove the `api.licenseKey.haveValidLicenseKey` query (≈40–41), the `hasCustomRolesWithoutLicense` computation (≈50–51), and the JSX that renders the warning (≈83).

**`apps/dokploy/components/dashboard/settings/users/change-role.tsx`**
- Remove the `api.customRole.all` query (≈52–54) and the `customRoles` variable.
- Remove the `customRoles?.map(...)` `SelectItem` block (≈132–139), leaving only the static Admin/Member items.
- Remove the `{customRoles && customRoles.length > 0 && (...)}` `FormDescription` conditional (≈147–154).

**`apps/dokploy/components/dashboard/settings/users/add-invitation.tsx`**
- Remove the `api.customRole.all` query (line 108) and the `customRoles` variable.
- Remove the `customRoles?.map(...)` JSX (≈282) — limit invitation roles to static roles.

### Step 13 — Fix permission tests
**`check-permission.test.ts`** & **`service-access.test.ts`**
- Remove the `vi.mock("@dokploy/server/services/proprietary/license-key", ...)` block (≈46–48 each).
- Re-baseline any assertion that relied on the unlicensed branch of `resolveRole`/`checkPermission` against the new always-static-role behavior.

**`resolve-permissions.test.ts`**
- Remove the `vi.mock(... proprietary/license-key ...)` block (≈46–48).
- Keep the `enterpriseOnlyResources` import (line 53) and the loops at 71/83 — the Set is kept. Re-baseline assertions.

**`enterprise-only-resources.test.ts`** — **KEEP** (Set is kept).

### Step 14 — Schema + Drizzle migration
**`packages/server/src/db/schema/user.ts`**
- Delete columns: `enableEnterpriseFeatures` (58–60), `licenseKey` (61), `isValidEnterpriseLicense` (62–64). **Keep `isEnterpriseCloud` (71)** (billing — out of scope).
- Delete the `// Enterprise / proprietary features` comment (line 57).
- Remove `isValidEnterpriseLicense: true,` from the `createInsertSchema(...).omit({...})` (≈98). **Keep `isEnterpriseCloud: true,`** in the omit since the column stays.

**`packages/server/src/db/schema/web-server-settings.ts`**
- Delete the `whitelabelingConfig` jsonb column + its `.$type<...>()` + `.default({...})` (69–98, including the `// Whitelabeling Configuration` comment).
- Delete `whitelabelingConfigSchema` (201–214) and `apiUpdateWhitelabeling` (216–218).
- **Keep `remoteServersOnly` (100) and `enforceSSO` (102)** and their schema entries (162–163).

**`packages/server/auth-schema2.ts`** — delete the whole file (Step 1). The
`generate:drizzle` script (`packages/server/package.json:30`) needs **no change** — once
the `additionalFields` are gone from `lib/auth.ts`, re-running it emits a clean file.

**Test referencing whitelabelingConfig:**
`apps/dokploy/__test__/traefik/server/update-server-config.test.ts:51` — remove the
`whitelabelingConfig` literal from the test fixture.

**Generate the forward migration** (after editing the schema TS):
```
pnpm --filter=dokploy migration:generate
```
This uses `apps/dokploy/server/db/drizzle.config.ts`, emits the next file
`apps/dokploy/drizzle/0169_*.sql` containing:
```sql
ALTER TABLE "user" DROP COLUMN "enableEnterpriseFeatures";
ALTER TABLE "user" DROP COLUMN "licenseKey";
ALTER TABLE "user" DROP COLUMN "isValidEnterpriseLicense";
ALTER TABLE "webServerSettings" DROP COLUMN "whitelabelingConfig";
```
and auto-updates `drizzle/meta/_journal.json` + a new snapshot. **Do NOT hand-edit
existing `drizzle/*.sql` or `drizzle/meta/*_snapshot.json` — they are immutable history**
(66+ historical references to the dropped columns are expected and must stay).

### Step 15 — License files
- **`LICENSE.MD`**: replace with the full Apache-2.0 license text only; remove the
  bullet (line 5) carving out `/proprietary` under `LICENSE_PROPRIETARY` and the
  "Portions of this software are licensed as follows" preamble.
- **Delete `LICENSE_PROPRIETARY.md`** (Step 1).
- **`TERMS_AND_CONDITIONS.md`**: remove the proprietary/anti-resale clause
  ("any commercial resale or redistribution of Dokploy as a service is strictly
  forbidden ...") so the terms match Apache-2.0's permissions; or delete the file if
  redundant under Apache-2.0. **Flag to owner** for preferred wording.
- Update any `"license"` field in `package.json` files to `"Apache-2.0"` if present
  (verify with `rg '"license"' --glob '!**/node_modules/**'`).

---

## 3. Verification checklist

1. **No residual proprietary references** (the only allowed survivors after the work are
   in `AGENTS.md` and this `docs/relicense/` runbook):
   ```
   rg -i "proprietary" --glob '!**/node_modules/**' --glob '!**/.next/**' \
      --glob '!docs/relicense/**' --glob '!AGENTS.md' --glob '!**/drizzle/**'
   ```
   Expected: zero hits in `apps/`, `packages/` source. (`AGENTS.md` legitimately
   documents the no-proprietary rule; the historical `drizzle/` SQL/snapshots are immutable.)

2. **No `hasValidLicense` / `enterpriseProcedure` / `initEnterpriseBackupCronJobs` left:**
   ```
   rg "hasValidLicense|enterpriseProcedure|initEnterpriseBackupCronJobs|enableEnterpriseFeatures|isValidEnterpriseLicense" \
      --glob '!**/node_modules/**' --glob '!**/drizzle/**' --glob '!docs/relicense/**'
   ```
   Expected: zero hits.

3. **No dangling tRPC client calls** to removed routers:
   ```
   rg "api\.(licenseKey|sso|whitelabeling|customRole|auditLog)\." apps/dokploy --glob '*.tsx' --glob '*.ts'
   ```
   Expected: zero hits.

4. **Server package typechecks:** `pnpm --filter=server typecheck`

5. **Dokploy app typechecks:** `pnpm --filter=dokploy typecheck`

6. **Permission tests pass:** `pnpm --filter=dokploy test -- permissions`
   (re-baselined assertions; `enterprise-only-resources.test.ts` still green).

7. **Migration is forward-only:** `git status` shows exactly one new `apps/dokploy/drizzle/0169_*.sql`
   plus a new `drizzle/meta/*_snapshot.json` and a one-line `_journal.json` change — and
   **no modifications** to any pre-existing `0000_*`–`0168_*.sql` files.

8. **License sanity:** `LICENSE.MD` contains only Apache-2.0; `LICENSE_PROPRIETARY.md`
   is gone; no `/proprietary` carve-out clause remains.

---

## 4. Open questions to confirm with the owner

1. **Audit-log viewer UI** is removed (it lived in `/proprietary/audit-logs`). The
   backend logging keeps running via the relocated service. Build a new Apache viewer now,
   or defer?
2. **`enforceSSO` becomes a silent no-op** with the SSO sign-in UI removed. Confirm no
   org currently has `webServerSettings.enforceSSO = true`, or accept dormancy until the
   Rust SSO rebuild.
3. **`isEnterpriseCloud` + the whole Stripe/billing path** are kept (out of scope). Confirm
   billing is NOT part of this relicensing pass.
4. **OAuth (GitHub/Google) sign-in** is dropped (buttons lived in `/proprietary/auth`).
   Confirm OAuth is being rebuilt in Rust later rather than reimplemented in TS now.
5. **`TERMS_AND_CONDITIONS.md`** — preferred handling of the anti-resale clause: rewrite
   to match Apache-2.0, or delete the file entirely?
