# Crane Relicense — Remaining Fixes Execution Runbook

> **Status:** ready to apply. Single ordered runbook consolidating 6 patch specs.
> **Apply model:** the orchestrator applies each STEP, then runs that step's validation, then commits. On red, roll back the step (see per-step rollback) and stop.
> **Read-only rule:** every step is code/config edits except the two doc deliverables (Step 3 doc + the already-written Step 6 doc). No runbook step invents new domains, Discord, or logo assets.
> **External-link target (owner):** `https://github.com/ghaaf-labs/crane`. Runtime images move to GHCR `ghcr.io/ghaaf-labs/crane` + `ghcr.io/ghaaf-labs/crane-monitoring`.

---

## Ordering rationale (why this sequence)

Apply **least-invasive / most-isolated first**, framework majors **last**, so that each validation gate has the smallest possible blast radius and a clean rollback boundary.

1. **Go-module rename** — pure string substitution in an isolated app (`apps/monitoring`), no TS coupling, validated by `go build`. Cannot affect any later JS step. Safest possible first move.
2. **Self-update → GHCR** — three TS files, localized to the update/version-check + monitoring-image flow. Independent of auth and of dependency versions. Behavioral but contained.
3. **bcrypt → argon2** — touches the auth path + adds one dependency (`@node-rs/argon2`). Done BEFORE the dependency-major batch so that the `bcrypt 5→6` major in Step 5 is simply DROPPED (argon2 already owns hashing); avoids a wasted bump + coordination hazard. Includes the `password-hashing.md` doc.
4. **Cosmetic de-brand (text + links)** — large file count but every edit is exact-string display text / links, zero ABI. Done before dependency churn so the de-brand diff is reviewed against stable dependency versions (no lockfile noise mixed in).
5. **Dependency majors (LAST, batched B1→B7)** — the most invasive. Each batch is `pnpm install` + `pnpm -r typecheck` + biome + tests, committed per batch, rolled back whole-batch on red. React 19 (B7) is isolated and last.
6. **Docker-socket hardening doc** — already written (`docs/security/docker-socket-hardening.md`); included here only as a verification checkbox (doc-only, no code).

---

## ABI DO-NOT-TOUCH (binding for every step)

These are runtime/data ABI. Never rename, never repoint, never reformat:

- `/etc/dokploy/*` runtime paths (incl. `/etc/dokploy/monitoring/monitoring.db` bind + its mkdir/touch).
- `DOKPLOY_*` env vars: `DOKPLOY_DOCKER_HOST`, `DOKPLOY_DOCKER_PORT`, `DOKPLOY_DOCKER_API_VERSION`, `RELEASE_TAG`, and `getDokployImageTag()` behavior.
- Docker network/service/container names: `dokploy-network`, `dokploy-postgres`, `dokploy-traefik`, `dokploy-monitoring`, the swarm **service name `dokploy`** (the `${resourceName}` arg in `reloadDockerResource` and the trailing `"dokploy"` arg in `updateServer`'s `spawnAsync`).
- DB column / schema field names `dokployRestart` / `dokployBackup` (and all read sites). Only FormLabel **display text** is in cosmetic scope.
- `x-dokploy-token` request header.
- JWT issuer / better-auth secret (`auth-secret.ts`) and the auth config surface (issuer/cookie names).
- `account.password` DB column (must keep accepting existing bcrypt hashes; argon2 strings live in the same TEXT column).
- Traefik basicAuth htpasswd **bcrypt** format in `packages/server/src/utils/traefik/security.ts` (Traefik cannot parse argon2 — MUST stay bcrypt).
- `getServiceImageDigest()` signature/behavior (`docker service inspect dokploy ...`).
- `@crane/*` import alias (already done).
- Code identifiers that merely contain "dokploy": `isDokployNetworkInstalled`, `getDokployVersion`, `DokployBackupEmail`, `DokployRestartEmail`, `ShowDokployActions`, `ShowWelcomeDokploy`, the `appName="dokploy"` runtime arg in `show-dokploy-actions.tsx`.
- Functional (non-display) URLs that are live endpoints, kept as-is: `https://app.dokploy.com` (cloud API base), `app.dokploy.com/register` (hubspot tracking), `https://dokploy.com/security/*.sh` (live security-migration scripts), `https://templates.dokploy.com` (template registry), email **logo** `raw.githubusercontent.com/Dokploy/...` URLs (owner: keep logo assets as-is).
- `apps/dokploy/drizzle/**/*.sql` and `meta/*_snapshot.json` (frozen migration history — never edit).
- `apps/dokploy/__test__/**` fixtures containing `dokploy-router`/service/host strings and `github.com/Dokploy/examples.git` (golden-test coupling — out of cosmetic scope).
- Go third-party `require`/`replace` lines (gofiber/joho/mattn/shirou) and subpackage path segments (`/config`, `/containers`, `/database`, `/middleware`, `/monitoring`).

---

## STEP 1 — Go-module rename (risk: safe)

Rename module path `github.com/mauriciogm/dokploy/apps/monitoring` → `github.com/ghaaf-labs/crane/apps/monitoring`. 13 occurrences across 7 files. Pure prefix substitution; trailing subpackage segments unchanged. No TS/data ABI touched.

**Files & exact edits:**

| File | Before | After |
|---|---|---|
| `apps/monitoring/go.mod` (module decl, L1) | `module github.com/mauriciogm/dokploy/apps/monitoring` | `module github.com/ghaaf-labs/crane/apps/monitoring` |
| `apps/monitoring/go.mod` (replace, L34) | `replace github.com/mauriciogm/dokploy/apps/monitoring => ./` | `replace github.com/ghaaf-labs/crane/apps/monitoring => ./` |
| `apps/monitoring/main.go` (L12-16) | 5 imports `…/mauriciogm/dokploy/apps/monitoring/{config,containers,database,middleware,monitoring}` | same with `…/ghaaf-labs/crane/apps/monitoring/…` |
| `apps/monitoring/monitoring/monitor.go` (L21-22) | imports `…/config` + `…/database` | repointed |
| `apps/monitoring/containers/monitor.go` (L13-14) | imports `…/config` + `…/database` | repointed |
| `apps/monitoring/containers/config.go` (L6) | import `…/config` | repointed |
| `apps/monitoring/middleware/auth.go` (L7) | import `…/config` | repointed |

**Mechanical shortcut (recommended):** a single scoped substitution of the module prefix across the dir:
`find apps/monitoring -name '*.go' -o -name 'go.mod' | xargs sed -i '' 's#github.com/mauriciogm/dokploy/apps/monitoring#github.com/ghaaf-labs/crane/apps/monitoring#g'` (macOS `sed -i ''`). `go.sum` has zero matches (self-module not listed).

**Validation:**
```
cd apps/monitoring && go build ./...        # expect clean build
go vet ./...                                 # optional
rg "github.com/mauriciogm/dokploy" apps/monitoring   # MUST be 0 matches
```

**Rollback:** `git checkout -- apps/monitoring` (isolated; nothing else depends on it).

---

## STEP 2 — Self-update + version-check → GHCR (risk: medium)

Repoint the runtime self-update + version-check from Docker Hub to GHCR. Three files. Only the **registry/repo of the image pulled** changes; the swarm service name `dokploy` and `dokploy-monitoring` container stay.

### 2a — `packages/server/src/services/settings.ts` — `getUpdateData()` rewrite (L48 onward)

Replace the Docker Hub tags-fetch block + canary/feature digest branch + stable latest-digest-match block with the GHCR/OCI flow. `import semver from "semver"` (L9) already present — no new import.

**Replace this block** (anchor starts at the doc-comment above `export const getUpdateData`):

```ts
/** Returns latest version number and information whether server update is available by comparing current image's digest against digest for provided image tag via Docker hub API. */
export const getUpdateData = async (
	currentVersion: string,
): Promise<IUpdateData> => {
	try {
		const baseUrl =
			"https://hub.docker.com/v2/repositories/dokploy/dokploy/tags";
		let url: string | null = `${baseUrl}?page_size=100`;
		let allResults: { digest: string; name: string }[] = [];

		// Fetch all tags from Docker Hub
		while (url) {
			const response = await fetch(url, {
				method: "GET",
				headers: { "Content-Type": "application/json" },
			});

			const data = (await response.json()) as {
				next: string | null;
				results: { digest: string; name: string }[];
			};

			allResults = allResults.concat(data.results);
			url = data?.next;
		}

		const currentImageTag = getDokployImageTag();
		// ... canary/feature digest branch ... stable latest-digest match ...
		const latestVersion = latestVersionTag.name;
```

**With** (new GHCR helpers added immediately above `getUpdateData`, after `DEFAULT_UPDATE_DATA` / `getServiceImageDigest` which stay at L33-45):

```ts
/** GHCR repository the Crane runtime image lives in (ghcr.io/<owner>/<repo>). */
const GHCR_REGISTRY = "https://ghcr.io";
const GHCR_CRANE_REPO = "ghaaf-labs/crane";

/** Fetches an anonymous pull bearer token for a public GHCR repository. */
const getGhcrPullToken = async (repo: string): Promise<string> => {
	const tokenUrl = `${GHCR_REGISTRY}/token?scope=${encodeURIComponent(
		`repository:${repo}:pull`,
	)}&service=ghcr.io`;
	const response = await fetch(tokenUrl, {
		method: "GET",
		headers: { Accept: "application/json" },
	});
	const data = (await response.json()) as {
		token?: string;
		access_token?: string;
	};
	const token = data.token || data.access_token;
	if (!token) {
		throw new Error("Could not obtain GHCR pull token");
	}
	return token;
};

/** Lists all tags for a public GHCR repository via the OCI tags/list endpoint. */
const getGhcrTags = async (repo: string, token: string): Promise<string[]> => {
	const response = await fetch(`${GHCR_REGISTRY}/v2/${repo}/tags/list`, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
		},
	});
	const data = (await response.json()) as { name?: string; tags?: string[] };
	return data.tags ?? [];
};

/** Resolves the manifest digest for a given tag from the GHCR registry. */
const getGhcrManifestDigest = async (
	repo: string,
	tag: string,
	token: string,
): Promise<string | null> => {
	const response = await fetch(`${GHCR_REGISTRY}/v2/${repo}/manifests/${tag}`, {
		method: "HEAD",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept:
				"application/vnd.oci.image.index.v1+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json",
		},
	});
	return response.headers.get("docker-content-digest");
};

/** Returns latest version number and information whether server update is available by comparing the current image against tags published to GHCR (ghcr.io/ghaaf-labs/crane). */
export const getUpdateData = async (
	currentVersion: string,
): Promise<IUpdateData> => {
	try {
		// Fetch all tags from GHCR using an anonymous pull token.
		const token = await getGhcrPullToken(GHCR_CRANE_REPO);
		const allTags = await getGhcrTags(GHCR_CRANE_REPO, token);

		const currentImageTag = getDokployImageTag();

		// Special handling for canary and feature branches
		// For development versions (canary/feature), don't perform update checks
		// These are unstable versions that change frequently, and users on these
		// branches are expected to manually manage updates
		if (currentImageTag === "canary" || currentImageTag === "feature") {
			if (!allTags.includes(currentImageTag)) {
				return DEFAULT_UPDATE_DATA;
			}
			const currentDigest = await getServiceImageDigest();
			const latestDigest = await getGhcrManifestDigest(
				GHCR_CRANE_REPO,
				currentImageTag,
				token,
			);
			if (!latestDigest) {
				return DEFAULT_UPDATE_DATA;
			}
			if (currentDigest !== latestDigest) {
				return {
					latestVersion: currentImageTag,
					updateAvailable: true,
				};
			}
			return {
				latestVersion: currentImageTag,
				updateAvailable: false,
			};
		}

		// For stable versions, use semver comparison.
		// The OCI tags/list endpoint returns tag names only (no digests), so pick
		// the highest semver-valid versioned (v*) tag as the latest release.
		const latestVersionTag = allTags
			.filter((t) => t.startsWith("v") && semver.valid(semver.clean(t)))
			.sort((a, b) =>
				semver.rcompare(
					semver.clean(a) as string,
					semver.clean(b) as string,
				),
			)[0];

		if (!latestVersionTag) {
			return DEFAULT_UPDATE_DATA;
		}

		const latestVersion = latestVersionTag;
```

> **Keep verbatim:** everything after `const latestVersion = latestVersionTag;` (the `const cleanedCurrent = semver.clean(currentVersion);` block through the closing `} catch (error) { console.error("Error fetching update data:", error); return DEFAULT_UPDATE_DATA; }`) is UNCHANGED. All early-return `DEFAULT_UPDATE_DATA` and outer try/catch semantics preserved.

### 2b — `packages/server/src/services/settings.ts` L298 — `reloadDockerResource()` image source

```diff
-			command = `docker service update --force --image dokploy/dokploy:${imageTag} ${resourceName}`;
+			command = `docker service update --force --image ghcr.io/ghaaf-labs/crane:${imageTag} ${resourceName}`;
```
(`${resourceName}` = `dokploy` service name — UNCHANGED.)

### 2c — `apps/dokploy/server/api/routers/settings.ts` L534 — `updateServer` `--image` arg

```diff
-				`dokploy/dokploy:${data.latestVersion}`,
+				`ghcr.io/ghaaf-labs/crane:${data.latestVersion}`,
```
(The trailing `"dokploy"` swarm-service-name arg on the next line is UNCHANGED.)

### 2d — `packages/server/src/setup/monitoring-setup.ts` — both monitoring image defaults (4 sites: L14/L21 `setupMonitoring`, L90/L97 `setupWebMonitoring`)

The two `latest` lines and the two `canary` lines are byte-identical across both functions. Apply with two `replace_all` on the string literals:

```
replace_all "dokploy/monitoring:latest"  -> "ghcr.io/ghaaf-labs/crane-monitoring:latest"   (2 sites)
replace_all "dokploy/monitoring:canary"  -> "ghcr.io/ghaaf-labs/crane-monitoring:canary"   (2 sites)
```
(Container name `dokploy-monitoring` and the `/etc/dokploy/monitoring/monitoring.db` bind path UNCHANGED.)

**Validation:**
```
pnpm --filter=@crane/server run typecheck     # tsc --noEmit, packages/server
pnpm --filter=crane run typecheck             # apps/dokploy
pnpm format-and-lint                          # no NEW biome findings in the 3 files
rg "dokploy/dokploy|dokploy/monitoring|hub.docker.com" packages/server/src/services/settings.ts packages/server/src/setup/monitoring-setup.ts apps/dokploy/server/api/routers/settings.ts
#   -> 0 matches; but `dokploy` service-name arg, `dokploy-monitoring` container, /etc/dokploy paths MUST still be present (intentional ABI survivors)
```
Behavioral (optional): call `getUpdateData(version)` with `RELEASE_TAG` unset → confirms GET `ghcr.io/token?...:pull` then GET `ghcr.io/v2/ghaaf-labs/crane/tags/list` with bearer, returns highest `v*` tag. With `RELEASE_TAG=canary` → HEADs the manifest, compares `docker-content-digest` to running service digest.

**Rollback:** `git checkout -- packages/server/src/services/settings.ts packages/server/src/setup/monitoring-setup.ts apps/dokploy/server/api/routers/settings.ts`.

**Open questions (carry forward):** (1) GHCR tags/list is single-page here (no Link-header loop) — fine for the expected handful of tags; owner to confirm. (2) Stable path now picks highest `v*` by semver instead of "tag sharing `latest`'s digest" — agrees whenever `latest` == highest `v*` (normal release invariant); a `v*` pushed before promoting `latest` would be advertised early.

---

## STEP 3 — bcrypt → argon2id (custom better-auth hasher) (risk: medium)

Replace bcrypt (cost 10) with argon2id via `@node-rs/argon2` (prebuilt, no node-gyp) across **5 of 6** call sites. **Traefik basicAuth stays bcrypt** (Traefik cannot parse argon2). bcrypt stays installed for legacy verify + Traefik. New/changed passwords migrate transparently to argon2.

### 3a — NEW FILE `packages/server/src/lib/password.ts`

```ts
import * as bcrypt from "bcrypt";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

// OWASP-recommended argon2id parameters (2024 "second" profile, t>=2).
// memoryCost is in KiB (19456 KiB ~= 19 MiB).
const ARGON2_OPTIONS = {
	memoryCost: 19456,
	timeCost: 2,
	parallelism: 1,
} as const;

/** True when the stored hash is a legacy bcrypt hash ($2a$/$2b$/$2y$). */
export const isBcryptHash = (hash: string): boolean =>
	/^\$2[aby]\$/.test(hash);

/** True when the stored hash is an argon2 hash ($argon2id$/$argon2i$/$argon2d$). */
export const isArgon2Hash = (hash: string): boolean => hash.startsWith("$argon2");

/** Hash a plaintext password with argon2id. Always produces an argon2 hash. */
export const hashPassword = (password: string): Promise<string> =>
	argon2Hash(password, { ...ARGON2_OPTIONS, algorithm: 2 /* Argon2id */ });

/**
 * Verify a plaintext password against a stored hash of either format.
 * Returns ok plus needsRehash=true when the stored hash is legacy bcrypt and
 * the password was correct, so callers can opportunistically upgrade it.
 */
export const verifyPassword = async ({
	hash,
	password,
}: {
	hash: string;
	password: string;
}): Promise<{ ok: boolean; needsRehash: boolean }> => {
	if (isArgon2Hash(hash)) {
		const ok = await argon2Verify(hash, password).catch(() => false);
		return { ok, needsRehash: false };
	}
	if (isBcryptHash(hash)) {
		const ok = bcrypt.compareSync(password, hash);
		return { ok, needsRehash: ok };
	}
	return { ok: false, needsRehash: false };
};
```

### 3b — `packages/server/src/index.ts` — barrel re-export (after L7 `export * from "./lib/auth";`)

```diff
 export * from "./lib/auth";
+export * from "./lib/password";
```

### 3c — `packages/server/src/lib/auth.ts`

Remove unused bcrypt import (L3), add password-module import after `auth-secret`, swap the better-auth `password.{hash,verify}` (L122/125):

```diff
-import * as bcrypt from "bcrypt";
 import { betterAuth } from "better-auth";
```
```diff
 import { betterAuthSecret } from "./auth-secret";
+import { hashPassword, verifyPassword } from "./password";
```
```diff
 			async hash(password) {
-				return bcrypt.hashSync(password, 10);
+				// New/changed passwords are stored with argon2id.
+				return hashPassword(password);
 			},
 			async verify({ hash, password }) {
-				return bcrypt.compareSync(password, hash);
+				// Accepts BOTH argon2id (new) and legacy bcrypt hashes so every
+				// existing login keeps working. better-auth 1.5.4 has no rehash
+				// hook in the password config, so legacy bcrypt hashes migrate to
+				// argon2 the next time the password is set/changed (see
+				// docs/security/password-hashing.md).
+				const { ok } = await verifyPassword({ hash, password });
+				return ok;
 			},
```
(Indentation is TABS. `verify` stays a plain boolean — framework contract; `needsRehash` is intentionally unused here, no DB handle in better-auth 1.5.4.)

### 3d — `packages/server/src/auth/random-password.ts`

```diff
-import bcrypt from "bcrypt";
+import { hashPassword } from "../lib/password";
```
```diff
-	const saltRounds = 10;
-
-	const hashedPassword = await bcrypt.hash(randomPassword, saltRounds);
+	const hashedPassword = await hashPassword(randomPassword);
 	return { randomPassword, hashedPassword };
```

### 3e — `packages/server/src/services/user.ts`

```diff
-import * as bcrypt from "bcrypt";
 import { and, eq } from "drizzle-orm";
```
```diff
 import { auth } from "../lib/auth";
+import { hashPassword } from "../lib/password";
```
```diff
-			password: bcrypt.hashSync(password, 10),
+			password: await hashPassword(password),
 			createdAt: now,
```
(Enclosing function is already async — `await` is fine inside the tx callback.)

### 3f — `apps/dokploy/server/api/routers/user.ts`

```diff
-import * as bcrypt from "bcrypt";
+import { hashPassword, verifyPassword } from "@crane/server";
```
```diff
-				const correctPassword = bcrypt.compareSync(
-					input.currentPassword || "",
-					currentAuth?.password || "",
-				);
+				const { ok: correctPassword } = await verifyPassword({
+					hash: currentAuth?.password || "",
+					password: input.currentPassword || "",
+				});
```
```diff
-						password: bcrypt.hashSync(input.password, 10),
+						password: await hashPassword(input.password),
```
(Current-password check now verifies both formats; the new-password write is argon2 → self-service change implicitly rehashes bcrypt→argon2. Handler is already async. Note argument order: `verifyPassword({ hash, password })`.)

### 3g — Dependencies

`packages/server/package.json` (2-space indent, place before `bcrypt`):
```diff
+    "@node-rs/argon2": "^2.0.2",
     "bcrypt": "5.1.1",
```
`apps/dokploy/package.json` (TAB indent, place before `bcrypt`):
```diff
+		"@node-rs/argon2": "^2.0.2",
 		"bcrypt": "5.1.1",
```
**Keep** `bcrypt 5.1.1` and `@types/bcrypt 5.0.2` (legacy verify + Traefik). **Do NOT** add `@node-rs/argon2` to `pnpm.onlyBuiltDependencies` (it ships prebuilt; no build step).

### 3h — NEW FILE `docs/security/password-hashing.md`

```md
# Password hashing (argon2id) and the bcrypt migration

Crane hashes user passwords with **argon2id** via [`@node-rs/argon2`](https://github.com/napi-rs/node-rs) (prebuilt N-API binaries, no node-gyp). Legacy passwords created before this change were hashed with **bcrypt cost 10** and remain valid.

## Parameters

argon2id, OWASP 2024 profile: `memoryCost=19456` KiB (~19 MiB), `timeCost=2`, `parallelism=1`. Defined once in `packages/server/src/lib/password.ts`.

## Transparent verify-and-rehash

`verifyPassword({ hash, password })` sniffs the stored hash prefix:
- `$argon2*` -> argon2 verify
- `$2a$/$2b$/$2y$` -> legacy bcrypt verify

It returns `{ ok, needsRehash }`; `needsRehash` is `true` only when a legacy bcrypt hash verified successfully.

New and changed passwords are always written with `hashPassword()` (argon2id). The migration is therefore lazy: a legacy bcrypt hash is upgraded the next time that user's password is set or changed.

### better-auth limitation

better-auth 1.5.4 exposes `emailAndPassword.password.{hash,verify}` but has **no rehash hook** and `verify` receives no DB handle, so the login path cannot opportunistically rewrite the stored hash. We therefore keep `verify` a pure boolean that accepts both formats; the self-service password-change router (`apps/dokploy/server/api/routers/user.ts`) performs the effective rehash by overwriting the account row with an argon2 hash after verifying the current password. If a future better-auth version exposes a rehash callback, wire `needsRehash` into it.

## Why bcrypt stays installed

1. Legacy verification in `verifyPassword`.
2. **Traefik basic-auth** (`packages/server/src/utils/traefik/security.ts`) writes `htpasswd`-format entries; Traefik only understands bcrypt/MD5/SHA1, **not** argon2, so that site intentionally keeps `bcrypt.hash(..., 10)`. Do not migrate it.

## docker socket hardening

See `docs/security/docker-socket-hardening.md` (separate deliverable).
```

**Validation:**
```
pnpm install                                  # pulls @node-rs/argon2 prebuilt; confirm NOT in onlyBuiltDependencies
pnpm typecheck                                # all packages (new password.ts + call sites compile)
pnpm build                                    # esbuild server bundle must resolve @node-rs/argon2 via @crane/server
pnpm format-and-lint                          # no unused-import lint from removed bcrypt imports; organizeImports order OK
rg "bcrypt"                                   # bcrypt ONLY in: lib/password.ts, utils/traefik/security.ts, the package.json deps, @types/bcrypt, pnpm-lock.yaml
```
Runtime smoke: (a) new user → stored `account.password` starts `$argon2id$`; (b) legacy `$2b$` user login still succeeds; (c) that legacy user changes password via self-service → stored hash flips to `$argon2id$`; (d) Traefik basic-auth still emits `$2b$`/`$2y$`.

**Rollback:** `git checkout -- packages/server/src/lib/auth.ts packages/server/src/auth/random-password.ts packages/server/src/services/user.ts apps/dokploy/server/api/routers/user.ts packages/server/package.json apps/dokploy/package.json && rm -f packages/server/src/lib/password.ts docs/security/password-hashing.md && git checkout -- packages/server/src/index.ts && pnpm install`.

**Coordination flag:** because argon2 lands here, the `bcrypt 5→6` + `@types/bcrypt 5→6` bumps in Step 5 are **DROPPED**.

---

## STEP 4 — Cosmetic de-brand (text + links only) (risk: low)

Text/links only across four surfaces: UI strings + page `<title>`/meta, i18n locales, email body text, marketing/doc/social URLs. Owner decisions applied: links → `https://github.com/ghaaf-labs/crane`; **remove** cloud/Discord/sponsor blocks; **keep** logo image files + their `raw.githubusercontent.com/Dokploy/...` URLs as-is.

### Per-file exact edits

| File:line | Before | After |
|---|---|---|
| `apps/dokploy/pages/_app.tsx:41` | `<title>Dokploy</title>` | `<title>Crane</title>` |
| `apps/dokploy/components/layouts/onboarding-layout.tsx:14` | `whitelabeling?.appName \|\| "Dokploy"` | `… \|\| "Crane"` |
| `apps/dokploy/components/layouts/onboarding-layout.tsx:44` | `href="https://github.com/dokploy/dokploy"` | `href="https://github.com/ghaaf-labs/crane"` |
| `apps/dokploy/components/layouts/onboarding-layout.tsx:49` | `href="https://x.com/getdokploy"` | `href="https://github.com/ghaaf-labs/crane"` |
| `apps/dokploy/components/layouts/side.tsx:392` | `url: "https://docs.dokploy.com/docs/core",` | `url: "https://github.com/ghaaf-labs/crane",` |
| `apps/dokploy/components/layouts/side.tsx:396-399` | the `{ name:"Support", url:"https://discord.gg/2tBnJ3jDJc", icon:CircleHelp }` entry | **REMOVE** entry (keep `help:[]` valid) |
| `apps/dokploy/server/api/routers/notification.ts` (ntfy action) | `"view, visit Dokploy on Github, https://github.com/dokploy/dokploy, clear=true;"` | `"view, visit Crane on Github, https://github.com/ghaaf-labs/crane, clear=true;"` |
| `apps/dokploy/server/api/routers/notification.ts` (ntfy body) | `"Hi, From Dokploy 👋"` | `"Hi, From Crane 👋"` |
| `…/servers/validate-server.tsx:147` + `…/welcome-stripe/verify.tsx:153` | `label="Dokploy Network Created"` | `label="Crane Network Created"` (bound flag `isDokployNetworkInstalled` UNCHANGED) |
| `…/notifications/handle-notifications.tsx:1529` | `placeholder="Dokploy"` | `placeholder="Crane"` |
| `…/notifications/handle-notifications.tsx:1891` | `<FormLabel>Dokploy Backup</FormLabel>` | `<FormLabel>Crane Backup</FormLabel>` (col `dokployBackup` UNCHANGED) |
| `…/notifications/handle-notifications.tsx:1956` | `<FormLabel>Dokploy Restart</FormLabel>` | `<FormLabel>Crane Restart</FormLabel>` (col `dokployRestart` UNCHANGED) |
| `…/cluster/registry/handle-registry.tsx:489` | `registryName: "Dokploy Registry",` | `registryName: "Crane Registry",` |
| `…/git/gitea/add-gitea-provider.tsx:191` | `<li>Name: Dokploy</li>` | `<li>Name: Crane</li>` |
| `…/git/gitlab/add-gitlab-provider.tsx:159` | `<li>Name: Dokploy</li>` | `<li>Name: Crane</li>` |
| `…/git/github/add-github-provider.tsx:34` | `Dokploy-${…}` default | `Crane-${…}` |
| `…/home/show-home.tsx:22` | `… ?? "Dokploy";` | `… ?? "Crane";` |
| `apps/dokploy/pages/register.tsx:265` | `href="https://dokploy.com"` | `href="https://github.com/ghaaf-labs/crane"` |
| `apps/dokploy/pages/_error.tsx:15` | `… \|\| "Dokploy"` | `… \|\| "Crane"` |
| `apps/dokploy/pages/_error.tsx:89` | `href="https://github.com/Dokploy/dokploy/issues"` | `href="https://github.com/ghaaf-labs/crane/issues"` |
| `…/web-server/update-server.tsx:242` | `href="https://github.com/Dokploy/dokploy/releases"` | `href="https://github.com/ghaaf-labs/crane/releases"` |
| `apps/dokploy/scripts/generate-openapi.ts:80` | `url: "https://github.com/dokploy/dokploy/blob/canary/LICENSE",` | `url: "https://github.com/ghaaf-labs/crane/blob/main/LICENSE",` |
| `apps/dokploy/scripts/generate-openapi.ts:26,108` | `docs.dokploy.com` | `https://github.com/ghaaf-labs/crane` |
| `apps/dokploy/scripts/generate-openapi.ts:76` | `dokploy.com` | `https://github.com/ghaaf-labs/crane` |
| `apps/dokploy/public/locales/ru/settings.json:5,45` | inline word `Dokploy` | `Crane` |
| `apps/dokploy/public/locales/kz/settings.json:4,33` | inline word `Dokploy` | `Crane` |

### Email body text (`packages/server/src/emails/emails/`) — body strings + `alt="Dokploy"` only (NOT export names, NOT logo src URLs)

- `verify-email.tsx:25,60,88,91`; `invitation.tsx:28,65,96,99`; `invoice-notification.tsx:36,148,151,156`; `payment-failed.tsx:36,152,155,160`; `dokploy-backup.tsx:27,58,64,73`; `dokploy-restart.tsx:52` — `Dokploy`→`Crane` body text, `dokploy.com`→repo, **REMOVE** Discord `href="https://discord.gg/2tBnJ3jDJc"` anchor/Button elements (invoice-notification.tsx:156, payment-failed.tsx:160).
- All `alt="Dokploy"` → `alt="Crane"` across email files.

### Remove cloud/Discord/sponsor (owner decision)

- `…/billing/show-billing.tsx:732-738` Discord block (+ `:1082` `dokploy.com`→repo); `…/welcome-subscription.tsx:352` Discord, `:370` repo link, `:385` docs→repo.
- Docs `docs.dokploy.com`→repo at: `side.tsx:392`, `build/show.tsx:264`, `toggle-docker-cleanup.tsx:80`, `setup-server.tsx:194`, `create-ssh-key.tsx:175`, `swarm/empty-states.tsx:20`, `index.tsx:373`, `CONTRIBUTING.md:167`.

### Bulk sweeps (SCOPED, reviewed — never global)

```
# 1) whitelabel fallbacks (9 files)
rg -l 'appName || "Dokploy"' apps/dokploy/pages apps/dokploy/components
#    per file: s/whitelabeling?.appName || "Dokploy"/whitelabeling?.appName || "Crane"/
# 2) local-server display labels (review each, all are display)
rg -n '"Dokploy"|>Dokploy<|"Dokploy Server"|"Dokploy (Local)"' \
   apps/dokploy/components/dashboard/project \
   apps/dokploy/components/dashboard/settings/certificates \
   apps/dokploy/components/dashboard/home
# 3) email alt text
rg -l 'alt="Dokploy"' packages/server/src/emails/emails
#    s/alt="Dokploy"/alt="Crane"/
```
**Exclusions for every sweep:** `--glob '!**/drizzle/**' --glob '!**/node_modules/**' --glob '!**/pnpm-lock.yaml'`; NEVER match `appName="dokploy"`, `isDokployNetworkInstalled`, `getDokployVersion`, `DokployBackupEmail`, `DokployRestartEmail`, `ShowDokployActions`, `ShowWelcomeDokploy`, `dokployRestart`, `dokployBackup`.

**Validation:**
```
pnpm typecheck                # catches JSX/array breakage from Discord/sponsor removals (side.tsx help[], email anchors)
pnpm format-and-lint          # biome
rg -i 'dokploy' apps/dokploy/components apps/dokploy/public/locales packages/server/src/emails --glob '!**/node_modules/**'
#   -> ONLY intentional ABI/code-identifier survivors from the DO-NOT-TOUCH list remain
```

**Rollback:** `git checkout -- apps/dokploy packages/server/src/emails docs/CONTRIBUTING.md` (path-scoped to cosmetic surfaces only; argon2 changes from Step 3 are in different files except `apps/dokploy/server/api/routers/user.ts` and `apps/dokploy/package.json` — DO NOT blanket-checkout those two; roll back cosmetic files individually if Step 3 must be preserved).

**Open questions:** X link repointed to repo (owner said remove Discord/sponsor, didn't name X); mixed branding (Crane text + Dokploy logo) until a later logo pass; source-comment de-brand left out of scope.

---

## STEP 5 — Dependency majors (LAST; batched B1→B7) (risk: high)

Most advisories are TRANSITIVE and clear when the direct parent major is bumped. Run batches **sequentially**, commit per batch, **roll back the whole batch on red**. Per-batch gate:
```
pnpm install && pnpm -r run typecheck && pnpm format-and-lint && pnpm --filter=crane test
```
Add `pnpm build` after B5/B6/B7. Running-app smoke required for B2/B4/B6/B7.

> **Coordination with Step 3:** `bcrypt 5→6` + `@types/bcrypt 5→6` are **DROPPED** (argon2 owns hashing; bcrypt stays pinned at 5.1.1 for legacy + Traefik). Also do NOT touch `pnpm.onlyBuiltDependencies` for bcrypt.

### B1 — safe minors/patches (no code change expected)

zod 4.3.6→4.4.3 (api/schedules/server/dokploy) · semver 7.7.3→7.8.1 (dokploy/server) · yaml 2.8.1→2.9.0 (dokploy/server) · postgres 3.4.4→3.4.9 (dokploy/server) · ssh2 ~1.16→~1.17 [advisory] · shell-quote ^1.8.1→^1.8.4 · slugify ^1.6.6→^1.6.9 · js-cookie ^3.0.5→^3.0.8 [advisory] · adm-zip ^0.5.16→^0.5.17 · node-os-utils 2.0.1→2.0.3 · **hono 4.11.7→4.12.18** (api/schedules) [3 advisories; NOT the node-server v2 major] · @tanstack/react-query ^5.90.21→^5.100.14 · **@trpc/* 11.10.0→11.17.0** (client/next/react-query/server in dokploy + @trpc/server in server, aligned) · react-hook-form ^7.71.2→^7.77.0 · bullmq 5.67.3→5.77.6 (dokploy/schedules) [uuid advisory] · dompurify ^3.3.3→^3.4.7 [advisory] · ioredis 5.4.1→5.11.0 (schedules) · emails `@types/react` 18.2.33→18.3.5 + `@types/react-dom` 18.2.14→18.3.0 · codemirror group (@codemirror/* + @uiw/*) → latest 6.x/4.25.x · misc devDep `@types/*` (lodash/micromatch/node-schedule/ssh2/ws/adm-zip) → latest.

### B2 — better-auth 1.5.4→1.6.13 (auth-critical minor; needs running app)

better-auth + @better-auth/api-key 1.5.4→1.6.13 (BOTH dokploy + server, must match) · @better-auth/cli 1.4.21→1.6.13 (server) · better-call 2.0.2→2.0.3 (server). **No auth config code edits** (issuer/cookies version-only). Smoke: login, 2FA, API keys, session cookie, JWT issuer unchanged.

### B3 — drizzle (code-affecting)

**drizzle-zod 0.5.1→0.8.3 (server only — SPLIT fix; dokploy already 0.8.3).** 0.5→0.8 changed the `createInsertSchema` refinement-callback shape; 33 schema files in `packages/server/src/db/schema` use it → typecheck WILL flag changed callbacks; fix in this batch. · drizzle-orm 0.45.1→0.45.2 (dokploy/schedules/server) [advisory; does NOT regenerate dokployRestart/dokployBackup] · drizzle-kit 0.31.9→0.31.10.

### B4 — octokit / inngest / swagger majors

swagger-ui-react ^5.31.2→^5.32.6 [axios/prismjs/follow-redirects transitively] + @types/swagger-ui-react 4.19→5.18 · octokit SET: @octokit/auth-app 6→8, @octokit/webhooks 13→14, octokit 3→5 (dokploy+server), @octokit/rest 20→22 (server) — provider call-sites change; smoke Git connect/clone · **inngest 3.40.1→4.5.0 (api)** [clears the ONLY critical advisory via protobufjs] — v4 serve handler signature; check `apps/api/src/index.ts` + `service.ts` · redis 4.7.0→6.0.0 (api) [no direct createClient found; isolate if api fails].

### B5 — build/test tooling

**esbuild 0.20.2→0.28.0 ATOMIC across 4 spots:** root devDep, root `pnpm.overrides.esbuild` (anchor appears twice in root package.json — update BOTH), packages/server devDep, apps/dokploy devDep [clears <=0.24.2 advisory; check `esbuild.config.ts`] · @biomejs/biome 2.1.1→2.4.16 (run `format-and-lint:fix`, review formatting-only diff) · vitest 4.0.18→4.1.7 [vite advisory] + vite-tsconfig-paths 4.3.2→6.1.1 (verify `__test__/vitest.config.ts` resolves @crane/*) · tsx 4.16.2→4.22.4 (all 5 manifests). **HOLD** @types/node on 24.x (NOT 25), typescript on 5.x (NOT 6.0.3 — defer).

### B6 — isolated UI/runtime majors (each its own sub-commit)

date-fns 3.6.0→4.4.0 (dokploy/server) **PAIRED** with react-day-picker 8.10.1→10.0.1 (DayPicker prop API rewrite) · recharts 2.15.3→3.8.1 (all charts) · @hono/node-server 1.14.3→2.0.4 (api/schedules) + @hono/zod-validator 0.7.6→0.8.0 (verify `serve()` boot) · plus: nanoid 3→5, lucide-react 0.469→1.17, sonner 1→2, cmdk 0.2→1.1, tailwind-merge 2→3, @stripe/stripe-js 4→9 + stripe 17→22, @xterm/xterm 5→6 + addons, copy-to-clipboard 3→4, react-markdown 9→10, react-confetti-explosion 2→3, @stepperize/react 4→6, boxen 7→8, bl 6→7, toml 3→4, public-ip 6→8, undici 6→8, nodemailer 6.9.14→8.0.10 [advisory], pino 9→10 + pino-pretty 11→13, @faker-js/faker 8→10, dockerode 4→5 + @types/dockerode 3→4.

### B7 — React 18→19 (RISKIEST, ISOLATED, LAST; needs running app)

react + react-dom 18.2.0→19.2.6 across ALL manifests (dokploy/api/schedules/server/emails) · root `resolutions` @types/react 18.3.5→19.2.15 + @types/react-dom 18.3.0→19.2.3 · every `@types/react`/`@types/react-dom` devDep 18→19. Next 16.2.6 already installed (supports React 19 — no Next bump). Breaking: removed defaultProps for fn components, propTypes gone, useRef requires arg, ref-as-prop, stricter hydration. `pnpm install` reveals peer conflicts. **CANNOT** be validated without running app. **If peer hell / runtime breakage → ROLL BACK and stay on React 18** (Next 16 runs on 18 — valid terminal state).

**DEFER (out of scope for mechanical batch):** tailwindcss 3→4 (config/PostCSS rewrite), typescript 5→6. Confirm owner accepts deferring these two despite the "ALL majors" directive.

**Per-batch rollback:** `git reset --hard <pre-batch-commit> && pnpm install`.

**Open questions:** better-auth 1.6 issuer/cookie/x-dokploy-token compat (verify on running instance before B2 merge); inngest 4 serve migration size (fallback: pnpm.overrides protobufjs>=7.5.6); React 19 peer acceptance for radix/codemirror/recharts/react-day-picker.

---

## STEP 6 — Docker-socket hardening doc (risk: safe; ALREADY WRITTEN)

`docs/security/docker-socket-hardening.md` already exists (doc-only, no code). Cross-referenced by `docs/security/password-hashing.md` (Step 3h). No code change. Follow-up code phase (flip Traefik mounts to `:ro`, wire socket proxy, add `DOKPLOY_DOCKER_{CA,CERT,KEY}_PATH`) is explicitly NOT in this runbook.

**Validation:**
```
ls -l docs/security/docker-socket-hardening.md      # exists
git status --porcelain packages/ apps/              # no code modifications attributable to this step
```

---

## FINAL — "verify everything" checklist

Run from repo root after all steps:

```
# 1-4) Four TS typechecks (or the aggregate)
pnpm -r run typecheck                  # OR individually:
pnpm --filter=@crane/server run typecheck
pnpm --filter=crane run typecheck
pnpm --filter=@crane/api run typecheck        # apps/api
pnpm --filter=@crane/schedules run typecheck  # apps/schedules

# 5) Biome
pnpm format-and-lint

# 6) Tests (expect ~462 passing — apps/dokploy vitest suite)
pnpm --filter=crane test

# 7) Go build (Step 1)
cd apps/monitoring && go build ./...

# 8) Residual brand/link scans — expect ONLY ABI/code-identifier survivors
rg -n 'dokploy/dokploy|dokploy/monitoring|hub.docker.com' packages/server apps/dokploy
rg -n 'github.com/mauriciogm/dokploy' apps/monitoring            # MUST be 0
rg -in 'discord\.gg' apps/dokploy packages/server                # MUST be 0 (all removed)
rg -in 'docs\.dokploy\.com|x\.com/getdokploy' apps/dokploy       # MUST be 0
rg -in 'href="https://dokploy\.com"|github\.com/dokploy/dokploy|github\.com/Dokploy/dokploy' apps/dokploy packages/server
#   -> 0 user-facing; allowed survivors only: app.dokploy.com, dokploy.com/security/*.sh, templates.dokploy.com, email logo raw.githubusercontent.com/Dokploy/*
rg -n 'bcrypt' packages/server apps/dokploy --glob '!**/pnpm-lock.yaml'
#   -> ONLY lib/password.ts, utils/traefik/security.ts, package.json deps, @types/bcrypt

# 9) argon2 storage spot-checks (runtime)
#   new user account.password starts $argon2id$ ; legacy $2b$ login works ; self-service change flips to $argon2id$ ; Traefik still emits $2b$/$2y$
```

ABI survivors that MUST still be present after all scans (do not "clean up"): `dokploy` swarm service name, `dokploy-monitoring`/`dokploy-network`/`dokploy-postgres`/`dokploy-traefik` names, `/etc/dokploy/*` paths, `DOKPLOY_*` env, `dokployRestart`/`dokployBackup` columns, `x-dokploy-token` header, JWT issuer, `isDokployNetworkInstalled`, `getDokployVersion`, `DokployBackupEmail`/`DokployRestartEmail` exports, `appName="dokploy"` runtime arg, the kept functional Dokploy URLs and logo assets.
