# Docker socket hardening

Status: recommendations (no code changed by this document)
Scope: Crane control plane (`@crane/server`) and the containers it provisions
(`dokploy-traefik`, `dokploy-monitoring`) on both the local node and remote
servers.

This document describes the current Docker daemon exposure in Crane, the blast
radius of that exposure, and concrete, codebase-specific mitigations. Every
mount site is cited by file and line so the hardening work can be planned
against real call sites. No runtime/data ABI is changed here — container,
network, and service names (`dokploy-network`, `dokploy-traefik`,
`dokploy-monitoring`), the `/etc/dokploy` paths, and the `DOKPLOY_*` environment
variables are all preserved.

---

## 1. Current exposure

### 1.1 The Crane app process

`packages/server/src/constants/index.ts` builds a single shared `dockerode`
client (`export const docker = getDockerConfig()`, line 84) that the entire
control plane uses. Connection selection (lines 21–82):

1. If `DOKPLOY_DOCKER_HOST` is set, connect to a remote daemon over **plaintext
   TCP** at `DOKPLOY_DOCKER_HOST:DOKPLOY_DOCKER_PORT` (lines 27–36). There is no
   TLS, no `ca`/`cert`/`key`, and no `protocol: "https"` passed to the `Docker`
   constructor.
2. Otherwise auto-detect a local UNIX socket, in order: `DOCKER_HOST`
   (line 41–46), `${HOME}/.rd/docker.sock` (Rancher Desktop, lines 48–53), then
   `/var/run/docker.sock` (lines 55–58). The first that exists wins (lines
   60–76).

The Crane process talks to this client with **full read/write daemon
privileges** — it creates services, runs containers, pulls images, executes
`docker stack`/`docker compose`, and shells over SSH. That is by design for a
PaaS; the point of this document is to contain the components *around* it.

### 1.2 Containers Crane mounts the socket into

| Component | Site | Mount mode | Actually needs |
|-----------|------|-----------|----------------|
| Traefik (standalone container) | `packages/server/src/setup/traefik-setup.ts:89` | **read-write** (`/var/run/docker.sock:/var/run/docker.sock`) | read-only |
| Traefik (Swarm service) | `packages/server/src/setup/traefik-setup.ts:148-149` | **read-write** (bind mount, no `ReadOnly: true`) | read-only |
| Traefik (installer `docker run`) | `packages/server/src/setup/server-setup.ts:696` | **read-write** (`-v /var/run/docker.sock:/var/run/docker.sock`) | read-only |
| Monitoring (per-server container) | `packages/server/src/setup/monitoring-setup.ts:44` | read-only (`:ro`) | read-only ✅ |
| Monitoring (web/local container) | `packages/server/src/setup/monitoring-setup.ts:120` | read-only (`:ro`) | read-only ✅ |

The monitoring containers already follow the right pattern (`:ro`). The three
Traefik mounts do not: Traefik only needs to **watch** the daemon for
service/container/label changes (it is configured as a read-only provider in
`getDefaultTraefikConfig` / `getDefaultServerTraefikConfig`, with
`exposedByDefault: false`, `watch: true` — `traefik-setup.ts:253-375`). It never
needs to create, start, stop, or delete anything. Today it is handed a
read-write socket anyway.

### 1.3 Remote Docker

Two remote transports exist:

- **SSH** — `packages/server/src/utils/servers/remote-docker.ts:9-18` builds a
  `Dockerode` with `protocol: "ssh"` and a private key from the server record.
  This is the good path: the transport is authenticated and encrypted by SSH.
- **Plaintext TCP** — the `DOKPLOY_DOCKER_HOST` branch in
  `constants/index.ts:27-36`. If an operator points this at a remote daemon, the
  full Docker API travels **unauthenticated and unencrypted** over the network.

---

## 2. Blast radius

Write access to the Docker socket (or an equivalent unauthenticated TCP daemon)
is equivalent to **root on the host**. The socket is not a "list my containers"
API; it is a remote shell. With it an attacker can, for example:

- Run a container with `Privileged: true`, `PidMode: "host"`, or
  `Binds: ["/:/host"]` and read or overwrite any file on the host, including
  `/etc/shadow`, SSH keys, and the Crane Postgres data — the same daemon Crane
  uses to provision workloads (`dockerode.createContainer`, `createService`)
  exposes these options to anyone who reaches the socket.
- Mount the host root filesystem into a container and write a cron job or SUID
  binary to gain a persistent host root shell.
- Read every secret Crane manages: the SSH private keys it stores, environment
  variables it injects, Traefik's `acme.json`
  (`/etc/dokploy/traefik/dynamic/acme.json`, set to `600` at
  `traefik-setup.ts:383` — but readable by anyone with the socket), registry
  credentials under `/etc/dokploy/registry`, and the database.
- On a Swarm manager, schedule malicious tasks across **every node** in the
  cluster. The Traefik service is pinned to `node.role==manager`
  (`traefik-setup.ts:154-156`), so its socket is a manager socket — i.e. control
  of the whole swarm.

Why each current mount matters:

- **Traefik with a read-write socket** (`traefik-setup.ts:89`,
  `traefik-setup.ts:148-149`, `server-setup.ts:696`). Traefik is the
  internet-facing component. A Traefik RCE or SSRF, a malicious plugin, or a
  compromised image turns its read-write socket into host/cluster root. Because
  Traefik only needs to *read*, this is gratuitous privilege.
- **Plaintext remote TCP** (`constants/index.ts:27-36`). Anyone who can reach
  `DOKPLOY_DOCKER_HOST:PORT` — same LAN, a compromised neighbor container, a
  mis-scoped security group — gets unauthenticated root-equivalent control of
  that daemon, and can also read/modify Crane's API traffic in flight.
- **Monitoring with `:ro`** (`monitoring-setup.ts:44`, `:120`). Lower risk, but
  read access still leaks container configs, env vars, and image digests, and a
  read-only socket can still enumerate the whole host's workloads. It is the
  right baseline, and a socket proxy (below) reduces it further.

---

## 3. Mitigations

The mitigations are ordered by leverage. (1) and (2) are low-risk, high-value,
and do not touch the data/runtime ABI. (3)–(5) need an operator decision per
deployment.

### 3.1 Make read-only mounts read-only (quick win, no ABI change)

The three Traefik socket mounts should be read-only, matching what monitoring
already does and what Traefik actually requires.

- `packages/server/src/setup/traefik-setup.ts:89` — change the standalone bind
  from `"/var/run/docker.sock:/var/run/docker.sock"` to
  `"/var/run/docker.sock:/var/run/docker.sock:ro"`.
- `packages/server/src/setup/traefik-setup.ts:148-149` — add `ReadOnly: true` to
  the Swarm `Mount` object for the socket (the dockerode `Mount` type supports
  `ReadOnly`).
- `packages/server/src/setup/server-setup.ts:696` — change the installer flag to
  `-v /var/run/docker.sock:/var/run/docker.sock:ro`.

Caveat: a read-only **bind of the socket file** stops a container from
`chmod`/`unlink`-ing the socket, but the Docker API itself has no read-only
mode — a process that can `connect()` to the socket can still issue write API
calls regardless of the mount's `ro` flag. `:ro` is necessary but not
sufficient; the real write/read split is enforced by a socket proxy (§3.2).
Treat `:ro` as defense-in-depth and a correctness signal, and rely on §3.2 for
the actual API restriction.

### 3.2 Front the daemon with a socket proxy + least-privilege allowlist

Run a [`tecnativa/docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy)
(HAProxy in front of the daemon socket) and give each component a network
endpoint to the proxy instead of the raw socket. The proxy translates each
Docker API path into an env-var toggle, defaulting to deny.

Recommended topology, on `dokploy-network`:

- **`docker-socket-proxy-ro`** — a read-only proxy for Traefik and monitoring.
  Enable only the read endpoints Traefik's provider needs and nothing else:

  ```yaml
  # least-privilege read-only proxy (Traefik + monitoring)
  image: tecnativa/docker-socket-proxy
  environment:
    CONTAINERS: 1        # GET /containers (Traefik docker provider)
    SERVICES:   1        # GET /services   (Traefik swarm provider)
    TASKS:      1        # GET /tasks      (swarm task discovery)
    NETWORKS:   1        # GET /networks
    NODES:      1        # swarm node info
    SWARM:      0
    INFO:       1
    EVENTS:     1        # GET /events watch stream
    PING:       1
    VERSION:    1
    # everything else stays at the proxy default of 0 (deny):
    POST:       0        # deny all writes/mutations
    EXEC:       0
    CONTAINERS_CREATE: 0
    BUILD:      0
    IMAGES:     0        # Traefik does not pull
    VOLUMES:    0
    SECRETS:    0
    CONFIGS:    0
    DISTRIBUTION: 0
    PLUGINS:    0
    SESSION:    0
    AUTH:       0
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
  ```

  Then point Traefik at the proxy instead of the socket. In
  `getDefaultTraefikConfig` / `getDefaultServerTraefikConfig`
  (`traefik-setup.ts:253` and `:323`) the providers would use
  `endpoint: "tcp://docker-socket-proxy-ro:2375"`, and the socket bind in
  `traefik-setup.ts:89` / `:148-149` / `server-setup.ts:696` would be removed
  from the Traefik container entirely. Monitoring (`monitoring-setup.ts:44`,
  `:120`) can target the same read-only proxy; if it needs host `/sys`, `/proc`,
  `/etc/os-release` (it mounts those today), keep those host mounts but drop the
  raw docker socket in favor of the proxy endpoint.

- The **Crane control-plane process** legitimately needs write access (it
  provisions everything). If you want to contain even that, run a separate
  **`docker-socket-proxy-rw`** with `POST: 1`, `CONTAINERS_CREATE: 1`,
  `SERVICES: 1`, `IMAGES: 1`, `EXEC: 1`, etc. enabled, expose it only on
  `dokploy-network` (never published to a host port), and set
  `DOKPLOY_DOCKER_HOST=docker-socket-proxy-rw` / `DOKPLOY_DOCKER_PORT=2375` so
  `getDockerConfig` (`constants/index.ts:27-36`) routes through it. This keeps
  the raw socket off the application container's filesystem so an app-layer RCE
  cannot bind-mount the host root or escape the allowlist. Note that a write
  proxy with `CONTAINERS_CREATE`/`POST` enabled is still root-equivalent — its
  value is auditability, a single chokepoint, and removing the bare socket from
  the app container, not full privilege reduction.

Only the read-only proxy is a true privilege reduction; the write proxy is a
chokepoint/audit boundary.

### 3.3 Split write-needing vs read-only components

Use the table in §1.2 as the split:

- **Read-only consumers** — Traefik (`traefik-setup.ts`) and monitoring
  (`monitoring-setup.ts`). These get the read-only proxy (§3.2) and never the
  raw socket. Traefik in particular is the highest-value target (internet-facing)
  and the easiest to demote, since its config is already a read-only watch
  provider.
- **Write consumer** — only the Crane control-plane process
  (`constants/index.ts` `docker` client). Keep write capability concentrated in
  exactly one component, behind the optional write proxy, on an internal
  network, never on a published port.

This prevents a compromise of the edge (Traefik) or the observability sidecar
(monitoring) from escalating to daemon write access.

### 3.4 TLS + client-certificate auth for remote Docker

The plaintext-TCP branch (`constants/index.ts:27-36`) must not be used over an
untrusted network as written — it has no encryption and no authentication.
Options, best first:

1. **Prefer the SSH transport** that already exists
   (`remote-docker.ts:9-18`, `protocol: "ssh"`). It is authenticated and
   encrypted out of the box and is the recommended path for remote servers.
2. **If TCP is required, require mutual TLS.** Configure the remote daemon with
   `--tlsverify --tlscacert --tlscert --tlskey` on port `2376`, and pass the
   client materials to the `dockerode` constructor in `getDockerConfig`:

   ```ts
   // constants/index.ts getDockerConfig(), DOKPLOY_DOCKER_HOST branch
   return new Docker({
     host: DOKPLOY_DOCKER_HOST,
     port: DOKPLOY_DOCKER_PORT ?? 2376,
     protocol: "https",
     ca:   fs.readFileSync(process.env.DOKPLOY_DOCKER_CA_PATH!),
     cert: fs.readFileSync(process.env.DOKPLOY_DOCKER_CERT_PATH!),
     key:  fs.readFileSync(process.env.DOKPLOY_DOCKER_KEY_PATH!),
     ...versionOption,
   });
   ```

   This keeps the `DOKPLOY_DOCKER_HOST`/`DOKPLOY_DOCKER_PORT` ABI intact and adds
   new, optional `DOKPLOY_DOCKER_{CA,CERT,KEY}_PATH` env vars (additive, no
   breaking change). The remote daemon's mutual-TLS port plays the role of the
   client-cert allowlist: only holders of a cert signed by the configured CA can
   issue any API call.
3. Never expose a TCP daemon (TLS or not) to the public internet; bind it to a
   private interface / VPN / WireGuard, and use a host firewall to restrict
   source addresses.

`2375` = plaintext (avoid), `2376` = TLS (use). Document loudly that
`DOKPLOY_DOCKER_HOST` without TLS is for trusted local sockets/loopback only.

### 3.5 Rootless Docker / user namespaces

Reduce what "root in the socket" can reach on the host:

- **Rootless Docker** — run the daemon as an unprivileged user
  (`dockerd-rootless.sh`). The socket then lives under
  `$XDG_RUNTIME_DIR/docker.sock`, which `getDockerConfig` already supports via
  the `DOCKER_HOST` candidate (`constants/index.ts:41-46`) — set
  `DOCKER_HOST=unix:///run/user/<uid>/docker.sock` and the existing
  auto-detection picks it up with no code change. A container escape then yields
  the *unprivileged* user, not host root. Caveats relevant to this codebase:
  the `host` networking and host bind-mounts the monitoring container relies on
  (`monitoring-setup.ts:50` `NetworkMode: "host"`, `/sys`, `/proc`,
  `/etc/os-release`) and some Swarm features behave differently under rootless —
  validate the monitoring + Traefik paths before adopting it cluster-wide.
- **`userns-remap`** — if full rootless is too disruptive, enable
  `"userns-remap": "default"` in `/etc/docker/daemon.json`. Container UID 0 maps
  to an unprivileged host UID, so a socket-write escape lands as a subordinate
  UID rather than real root. This is less invasive than rootless and compatible
  with the current container layout; the main gotcha is bind-mount ownership of
  the `/etc/dokploy` tree, which must be readable/writable by the remapped UID
  range.
- Either way, keep `Privileged`/`PidMode: host`/`CapAdd` disabled — note they
  are present-but-commented in `monitoring-setup.ts:30-32` and `:106-108`; they
  must stay off.

---

## 4. Suggested rollout order

1. **§3.1** — flip the three Traefik mounts to `:ro` / `ReadOnly: true`. Tiny,
   reversible, no ABI impact. (Defense-in-depth; see the caveat — it does not by
   itself restrict the API.)
2. **§3.2 read-only proxy** — front Traefik and monitoring with
   `docker-socket-proxy-ro` and remove their raw socket binds. This is the step
   that actually removes write capability from the edge.
3. **§3.4** — make SSH the default for remote servers; gate any TCP use behind
   mutual TLS on `2376` via the new optional env vars.
4. **§3.2 write proxy + §3.5** — optionally route the control plane through a
   write proxy and adopt rootless / `userns-remap` to shrink the host blast
   radius of the one component that must keep write access.

## 5. Cited mount sites (quick reference)

- `packages/server/src/constants/index.ts:27-36` — remote plaintext-TCP daemon
  (`DOKPLOY_DOCKER_HOST`), no TLS.
- `packages/server/src/constants/index.ts:41-58` — local socket auto-detection
  (`DOCKER_HOST`, `~/.rd/docker.sock`, `/var/run/docker.sock`).
- `packages/server/src/setup/traefik-setup.ts:89` — Traefik standalone, socket
  **rw**.
- `packages/server/src/setup/traefik-setup.ts:148-149` — Traefik Swarm service,
  socket **rw**.
- `packages/server/src/setup/server-setup.ts:696` — installer `docker run`,
  socket **rw**.
- `packages/server/src/setup/monitoring-setup.ts:44` — monitoring per-server,
  socket `:ro`.
- `packages/server/src/setup/monitoring-setup.ts:120` — monitoring web/local,
  socket `:ro`.
- `packages/server/src/utils/servers/remote-docker.ts:9-18` — remote daemon over
  SSH (preferred remote transport).
