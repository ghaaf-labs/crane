# Crane

**Crane** is a free, self-hostable Platform as a Service (PaaS) that simplifies the deployment and management of applications and databases.

It is an **Apache-2.0** hard fork of [Dokploy](https://github.com/dokploy/dokploy) (v0.29.6). This fork removes the upstream open-core `/proprietary` (DSAL) layer so the entire codebase is single-license Apache-2.0, and is progressively being rewritten from TypeScript toward Rust. See [`AGENTS.md`](./AGENTS.md) for the project overview and contributor guide, and [`docs/`](./docs) for the engineering review, relicensing plan, and Rust migration roadmap.

> Crane is not affiliated with or endorsed by Dokploy. "Dokploy" and its logo are trademarks of Dokploy Technology, Inc.

## ✨ Features

- **Applications**: Deploy any type of application (Node.js, PHP, Python, Go, Ruby, etc.).
- **Databases**: Create and manage MySQL, PostgreSQL, MongoDB, MariaDB, libSQL, and Redis.
- **Backups**: Automate database backups to external storage.
- **Docker Compose**: Native support for managing complex applications.
- **Multi Node**: Scale applications across nodes with Docker Swarm.
- **Templates**: Deploy open-source templates (Plausible, PocketBase, Cal.com, etc.) in one click.
- **Traefik Integration**: Automatic routing and load balancing.
- **Real-time Monitoring**: CPU, memory, storage, and network usage per resource.
- **Docker Management**: Deploy and manage Docker containers.
- **CLI/API**: Manage applications and databases from the command line or API.
- **Notifications**: Deployment success/failure alerts (Slack, Discord, Telegram, Email, etc.).
- **Multi Server**: Deploy and manage applications on remote servers.
- **Self-Hosted**: Run it on your own VPS.

> **Note:** OAuth/SSO sign-in and the enterprise features (custom roles, audit-log viewer, whitelabeling, license keys) from upstream's `/proprietary` layer have been removed. Authentication is email/password; OAuth/SSO are planned to be rebuilt in Rust.

## 🚀 Development

Requirements: Node `^24.4.0`, pnpm `10.22.0`, a PostgreSQL instance, and Docker.

```bash
pnpm install
cp apps/dokploy/.env.example apps/dokploy/.env   # set BETTER_AUTH_SECRET (openssl rand -hex 32)
pnpm crane:setup                                 # run migrations
pnpm crane:dev                                   # start the app (Next + tRPC + WS)
```

Quality gates (all green):

```bash
pnpm typecheck            # tsc --noEmit across all packages
pnpm format-and-lint      # biome check .
pnpm test                 # vitest (462 unit tests; *.real.test.ts need Docker+Swarm)
```

Auth notes: `BETTER_AUTH_SECRET` is **required** (the app fails closed without it — `openssl rand -hex 32`); passwords hash with **argon2id**; set `SECURE_COOKIES=true` when serving over HTTPS.

## 📦 Container images

Images publish to GitHub Container Registry under the fork's namespace:

- `ghcr.io/ghaaf-labs/crane` — the main app
- `ghcr.io/ghaaf-labs/crane-monitoring` — the Go metrics service
- `ghcr.io/ghaaf-labs/crane-{cloud,schedule,server}` — supporting services

## 📚 Documentation

- [`AGENTS.md`](./AGENTS.md) — project overview, monorepo layout, build/test, hard rules, conventions.
- [`docs/REVIEW.md`](./docs/REVIEW.md) — full engineering review (architecture, security, deps, quality, devops, schema, Rust).
- [`docs/RUST-MIGRATION-ROADMAP.md`](./docs/RUST-MIGRATION-ROADMAP.md) — the phased TypeScript→Rust plan.
- [`docs/security/`](./docs/security) — [password hashing](./docs/security/password-hashing.md) (argon2id) and [docker-socket hardening](./docs/security/docker-socket-hardening.md).
- [`docs/relicense/`](./docs/relicense) — the relicensing/de-brand runbooks and the [remaining-fixes plan](./docs/relicense/REMAINING-FIXES-PLAN.md).

## ✅ Fork status

Relicensed to single Apache-2.0 (the `/proprietary` layer removed); de-branded to **Crane** (internal `@crane/*` packages, GHCR images, user-facing text/links); a round of security hardening landed; self-update + CI retargeted to GHCR. **Pending:** the OAuth/SSO rebuild (in Rust), the heavier dependency-major upgrades, and a long-tail i18n/brand-asset pass — see the [remaining-fixes plan](./docs/relicense/REMAINING-FIXES-PLAN.md). Runtime/data identifiers (`/etc/dokploy` paths, `DOKPLOY_*` env, docker/network names, DB columns) are intentionally unchanged to keep existing deployments working.

## 🤝 Contributing

See the [Contributing Guide](CONTRIBUTING.md). New code must be Apache-2.0-compatible and must not reintroduce the removed `/proprietary` layer or Dokploy branding.

## 📝 License

[Apache License 2.0](./LICENSE). Portions derived from Dokploy (Apache-2.0); see [`NOTICE`](./NOTICE).
