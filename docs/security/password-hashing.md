# Password hashing (argon2id) and the bcrypt migration

Crane hashes user passwords with **argon2id** via [`@node-rs/argon2`](https://github.com/napi-rs/node-rs) (prebuilt N-API binaries, no node-gyp). Legacy passwords created before this change were hashed with **bcrypt cost 10** and remain valid.

## Parameters

argon2id, OWASP 2024 profile: `memoryCost=19456` KiB (~19 MiB), `timeCost=2`, `parallelism=1`. Defined once in `packages/server/src/lib/password.ts`.

## Transparent verify-and-rehash

`verifyPassword({ hash, password })` sniffs the stored hash prefix:

- `$argon2*` → argon2 verify
- `$2a$/$2b$/$2y$` → legacy bcrypt verify

It returns `{ ok, needsRehash }`; `needsRehash` is `true` only when a legacy bcrypt hash verified successfully.

New and changed passwords are always written with `hashPassword()` (argon2id). The migration is therefore lazy: a legacy bcrypt hash is upgraded the next time that user's password is set or changed.

### better-auth limitation

better-auth exposes `emailAndPassword.password.{hash,verify}` but has **no rehash hook** and `verify` receives no DB handle, so the login path cannot opportunistically rewrite the stored hash. We therefore keep `verify` a pure boolean that accepts both formats; the self-service password-change router (`apps/dokploy/server/api/routers/user.ts`) performs the effective rehash by overwriting the account row with an argon2 hash after verifying the current password. If a future better-auth version exposes a rehash callback, wire `needsRehash` into it.

## Why bcrypt stays installed

1. Legacy verification in `verifyPassword`.
2. **Traefik basic-auth** (`packages/server/src/utils/traefik/security.ts`) writes `htpasswd`-format entries; Traefik only understands bcrypt/MD5/SHA1, **not** argon2, so that site intentionally keeps `bcrypt.hash(..., 10)`. Do not migrate it.

## Docker socket hardening

See [`docker-socket-hardening.md`](./docker-socket-hardening.md) (separate deliverable).
