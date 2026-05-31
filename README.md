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

Quality gates:

```bash
pnpm typecheck            # tsc --noEmit across all packages
pnpm format-and-lint      # biome check .
pnpm test                 # vitest (apps/dokploy/__test__)
```

## 🤝 Contributing

See the [Contributing Guide](CONTRIBUTING.md). New code must be Apache-2.0-compatible and must not reintroduce the removed `/proprietary` layer or Dokploy branding.

## 📝 License

[Apache License 2.0](./LICENSE). Portions derived from Dokploy (Apache-2.0); see [`NOTICE`](./NOTICE).
