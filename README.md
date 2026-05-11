<div align="center">

# 🎻 Orchport 🔌

<p>
  <a href="https://www.npmjs.com/package/orchport"><img alt="npm" src="https://img.shields.io/npm/v/orchport?logo=npm&label=npm"></a>
  <a href="https://github.com/ReoHakase/orchport#install"><img alt="Nix flake" src="https://img.shields.io/badge/Nix-flake-5277C3?logo=nixos&logoColor=white"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green.svg"></a>
</p>

  <img src=".github/opengraph.png" alt="Orchport" width="100%" />

**A non-interactive port, URL, and environment resolver for local multi-worktree web development.**

Orchport gives each git worktree a predictable set of local service URLs, avoids dev-server port collisions, and injects the resolved values into the command you run.

</div>

## Why Orchport?

Modern web apps often start more than one local process: a web app, an API, a local database proxy, an email previewer, Storybook, and so on. That gets awkward when several agents, terminals, or git worktrees run the same monorepo at the same time.

Orchport is built for that workflow:

- It allocates ports deterministically inside configured ranges.
- It creates readable URLs such as `https://api.fix-login.myapp.localhost`.
- It exports `ORCHPORT_*` variables for scripts and child processes.
- It can run a local reverse proxy so browser-facing URLs stay stable while backend ports move.
- It never prompts. `orchport run -- <command>` is safe for CI, agents, and one-shot scripts.

> [!NOTE]
> Tools such as [Vercel Labs / portless](https://github.com/vercel-labs/portless) are useful for interactive local proxying. Orchport focuses on non-interactive commands, reproducible env injection, and git-worktree-aware naming.

## Install

Use npm for most projects:

```bash
npm install -g orchport
```

Or pin it per project:

```bash
npm install -D orchport
```

With Bun:

```bash
bun add -D orchport
bun pm trust orchport
```

With Nix flakes:

```bash
nix profile install github:ReoHakase/orchport
```

Orchport is distributed as a precompiled Bun single-file executable created with `bun build --compile`. The npm package does not compile Orchport on the user's machine; it is a small shim that downloads the matching binary from GitHub Releases during `postinstall` and verifies it with `SHA256SUMS`. Bun blocks dependency lifecycle scripts unless a package is trusted, so Bun projects must run `bun pm trust orchport` once to allow that `postinstall` download.

The Nix flake also packages those prebuilt release binaries. It does not rebuild the TypeScript source with Bun in the Nix sandbox.

If you install manually, download the `orchport-vX.Y.Z-<target>.tar.gz` asset and verify it against the release checksums.

## Agent Skill

If you want an agent to understand how to add and maintain Orchport in another project, install the public Orchport skill:

```bash
apm install ReoHakase/orchport/skills/orchport
```

Or with the Agent Skills CLI:

```bash
npx skills add ReoHakase/orchport --skill orchport
```

This installs guidance for configuring `orchport.config.*`, wiring Turborepo or monorepo dev scripts, using `ORCHPORT_*` variables, local proxy/TLS behavior, and `switchables` for OAuth callback routing.

## Quick Start

Generate a config:

```bash
orchport init
```

Check that Orchport can read the config and state directory:

```bash
orchport doctor
```

Inspect the resolved environment:

```bash
orchport env
orchport env --json
```

Run your dev command with resolved ports and URLs:

```bash
orchport run -- turbo dev
```

If the wrapped command accepts arguments that start with `-`, keep the `--` separator:

```bash
orchport run -- pnpm exec vite --host 0.0.0.0
```

## Turborepo Setup

Orchport works well as a thin wrapper around `turbo dev`. The main choice is how each package receives its port.

### Pattern 1: One Turbo Process for Everything

Use this when your normal workflow is `turbo dev` from the repository root.

Root `package.json`:

```json
{
  "scripts": {
    "dev": "turbo dev",
    "dev:orchport": "orchport run -- turbo dev",
    "env:orchport": "orchport env"
  }
}
```

Each package's `dev` script should read its own generated `ORCHPORT_<PROXY>_PORT` variable.

`apps/web/package.json`:

```json
{
  "scripts": {
    "dev": "next dev --port ${ORCHPORT_WEB_PORT:-3000}"
  }
}
```

`apps/api/package.json`:

```json
{
  "scripts": {
    "dev": "PORT=${ORCHPORT_API_PORT:-3001} bun run src/index.ts"
  }
}
```

`packages/email/package.json`:

```json
{
  "scripts": {
    "dev": "react-email dev --port ${ORCHPORT_EMAIL_PORT:-3002}"
  }
}
```

For portability, prefer reading the environment in the app code when possible:

```ts
const port = Number(process.env.ORCHPORT_API_PORT ?? process.env.PORT ?? 3001);
```

Then run:

```bash
npm run dev:orchport
```

### Pattern 2: One Orchport Target per Service

Use this when you start one package at a time, or when an agent is assigned to a single service.

Root `package.json`:

```json
{
  "scripts": {
    "dev:web": "orchport run web -- turbo dev --filter=@acme/web",
    "dev:api": "orchport run api -- turbo dev --filter=@acme/api",
    "dev:email": "orchport run email -- turbo dev --filter=@acme/email"
  }
}
```

When you pass a proxy name after `run`, Orchport injects that proxy's environment as the flat command environment. In that mode, service code can read `PORT` directly:

```ts
const port = Number(process.env.PORT ?? 3001);
```

### Example `orchport.config.ts`

```ts
import { defineConfig } from "orchport";

export default defineConfig({
  sld: "acme",
  tld: "localhost",
  mode: "local-proxy",
  proxy: {
    tls: "dev",
    httpsPort: false,
  },
  proxies: {
    web: { range: [3000, 3099], strategy: "smaller" },
    api: {
      range: [4000, 4099],
      strategy: "smaller",
      switchables: ["/auth/callback/*", "/api/auth/callback/*"],
    },
    db: { range: [5000, 5099], strategy: "deterministic" },
    email: true,
  },
  env: {
    APP_BASE_URL: "${web.url}",
    NEXT_PUBLIC_API_BASE_URL: "${api.url}",
    API_PUBLIC_URL: "${api.url}",
    BETTER_AUTH_URL: "${api.url}",
    TRUSTED_ORIGINS: "${web.url}",
    CORS_ORIGIN: "${web.url}",
    TURSO_DATABASE_URL: "${db.url}",
  },
});
```

With the example above, a worktree named `fix-login` gets URLs like:

```txt
https://web.fix-login.acme.localhost
https://api.fix-login.acme.localhost
https://db.fix-login.acme.localhost
```

On the origin default branch, Orchport omits the worktree segment, so the main branch can keep shorter URLs such as `https://web.acme.localhost`.

### What to Put in `turbo.json`

No special Turborepo task type is required. Keep long-running dev tasks persistent and uncached:

```json
{
  "tasks": {
    "dev": {
      "cache": false,
      "persistent": true
    },
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    }
  }
}
```

Orchport should wrap the command that starts those tasks; Turbo still owns task scheduling, filters, and logs.

## Configuration

Orchport searches upward from the current directory for one of:

- `orchport.config.ts`
- `orchport.yaml`
- `orchport.json`

### Root Options

| Key         | Type                              | Default / behavior                                                                                                                                  |
| ----------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sld`       | string                            | Second-level label for hosts, for example `*.myapp.localhost`. Defaults to the git repository root directory name, then the current directory name. |
| `tld`       | string                            | Host suffix. Defaults to `.localhost`; leading `.` is optional.                                                                                     |
| `worktree`  | string                            | Defaults to the current git worktree name.                                                                                                          |
| `mode`      | `"local-port"` or `"local-proxy"` | `local-port` resolves ports only. `local-proxy` also starts or uses a reverse proxy and emits public URLs.                                          |
| `portRange` | `[number, number]`                | Default range for automatic allocation and fallback: `[43100, 43999]`.                                                                              |
| `proxy`     | object                            | Reverse proxy options for `local-proxy`. `tls` defaults to `"dev"` unless explicitly disabled.                                                      |
| `proxies`   | object                            | Required service map. A key such as `web` produces `ORCHPORT_WEB_*` variables.                                                                      |
| `env`       | object or function                | Extra environment values. Strings can interpolate `${web.url}`, `${api.port}`, and similar proxy values.                                            |

YAML and JSON still accept the legacy key `workspace` as an alias for `sld`. If both are present and disagree, loading fails.

### Proxy Entries

Each `proxies` entry can be `true`, `{}`, or a full object.

| Key           | Type                                          | Behavior                                                                                                                    |
| ------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `range`       | `"auto"` or `[number, number]`                | Port range for this service. `"auto"` uses the root `portRange`.                                                            |
| `strategy`    | `"deterministic"`, `"smaller"`, or `"larger"` | Allocation order. `deterministic` hashes `sld`, `worktree`, and proxy name.                                                 |
| `strict`      | boolean                                       | If `true`, fail when a fixed or ranged port cannot be used. If `false`, fall back to the root `portRange` when possible.    |
| `switchables` | string[]                                      | Path patterns that can be routed to another worktree with `orchport switch`. Supports exact paths and trailing `/prefix/*`. |
| `env`         | object                                        | Extra environment values for this proxy when using `orchport run <proxy> -- ...`.                                           |

## Commands

| Command                      | Purpose                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orchport init`              | Create a starter TypeScript config. Use `--format yaml` or `--format json` only when the repo already prefers those formats.                                      |
| `orchport doctor`            | Check config loading and state-directory read/write access.                                                                                                       |
| `orchport env`               | Print resolved environment values without running a child process. TTY output is grouped by proxy; use `--json`, `--shell`, `--dotenv`, or `--plain` for scripts. |
| `orchport run`               | Resolve config, allocate ports, optionally start the proxy, then run a child command.                                                                             |
| `orchport run <proxy>`       | Run a child command with one proxy's flat environment, including `PORT`.                                                                                          |
| `orchport list`              | Show recorded runs.                                                                                                                                               |
| `orchport kill`              | Send a signal to processes recorded by prior runs.                                                                                                                |
| `orchport switch <worktree>` | Point configured `switchables` paths at another worktree.                                                                                                         |
| `orchport proxy up`          | Start a long-lived local proxy for `local-proxy` configs.                                                                                                         |
| `orchport proxy down`        | Stop the recorded proxy daemon.                                                                                                                                   |
| `orchport proxy status`      | Show proxy daemon status.                                                                                                                                         |

Global options go before the subcommand:

| Option              | Meaning                                                                        |
| ------------------- | ------------------------------------------------------------------------------ |
| `--config <path>`   | Use a specific config file.                                                    |
| `--sld <name>`      | Override the host label.                                                       |
| `--tld <suffix>`    | Override the host suffix.                                                      |
| `--worktree <name>` | Override the worktree name.                                                    |
| `--version`         | Print the Orchport version.                                                    |
| `--verbose`, `-v`   | Enable trace-level diagnostics for `orchport.*` loggers.                       |
| `--quiet`, `-q`     | Show warnings and errors only.                                                 |
| `--no-color`        | Disable ANSI color.                                                            |
| `--force-switch`    | Let `orchport run` claim switchable paths currently owned by another worktree. |
| `--json`            | Print fatal CLI errors as JSON on stderr.                                      |

## Environment Variables

Orchport always injects `ORCHPORT=1` plus generated `ORCHPORT_*` values.

Common generated variables include:

| Variable                    | Meaning                                        |
| --------------------------- | ---------------------------------------------- |
| `ORCHPORT_SLD`              | Resolved host label.                           |
| `ORCHPORT_TLD`              | Resolved host suffix.                          |
| `ORCHPORT_WORKTREE`         | Resolved worktree slug.                        |
| `ORCHPORT_RUN_ID`           | Current run identifier.                        |
| `ORCHPORT_<NAME>_PORT`      | Allocated local port for a proxy.              |
| `ORCHPORT_<NAME>_HOST`      | Public host for a proxy.                       |
| `ORCHPORT_<NAME>_URL`       | Public URL for a proxy.                        |
| `ORCHPORT_<NAME>_LOCAL_URL` | Direct `http://localhost:<port>` URL.          |
| `ORCHPORT_PROXY_PORT`       | Main reverse proxy port in `local-proxy` mode. |
| `ORCHPORT_HTTPS_PROXY_PORT` | Extra HTTPS listener port when one is active.  |

`ORCHPORT`, `ORCHPORT_*`, and legacy lowercase `orchport` / `orchport_*` names are reserved. User config cannot override them.

When `orchport run <proxy> -- ...` targets one proxy, Orchport also injects `PORT` for that service. That makes it easy to start frameworks that already read `PORT`.

## Local Proxy and TLS

In `mode: "local-proxy"`, Orchport can provide browser-facing URLs while your apps still listen on local ports.

```ts
export default defineConfig({
  mode: "local-proxy",
  proxy: { tls: "dev" },
  proxies: { web: true, api: true },
});
```

With `tls: "dev"`, Orchport generates an ephemeral self-signed certificate with `openssl`, writes it under the OS temp directory, and removes it when the child exits. Browsers may warn unless you trust the certificate.

During `orchport run`, TLS configs also expose:

- `ORCHPORT_DEV_TLS_CERT_FILE`
- `NODE_EXTRA_CA_CERTS`, when the parent did not already set it
- `DENO_CERT`, when the parent did not already set it

This lets Node, Bun, and Deno clients trust Orchport's generated local HTTPS URLs. `orchport env` does not emit these paths because no runtime certificate exists until `run`.

By default, TLS mode tries to bind an extra HTTPS listener on port `443` for nicer URLs. Set `proxy.httpsPort: false` to skip that and always use the high proxy port:

```ts
proxy: {
  tls: "dev",
  httpsPort: false
}
```

If the extra listener cannot bind, Orchport keeps running on the main proxy port and rewrites generated public URLs accordingly.

## Path Switching for OAuth Callbacks

OAuth providers often allow only a small set of callback URLs. With multiple worktrees, registering one callback URL per branch is painful.

`switchables` solves that by keeping the public callback URL stable while routing matching paths to another worktree's backend.

```ts
proxies: {
  api: {
    range: [4000, 4099],
    switchables: ["/auth/callback/*"]
  }
}
```

Run the proxy and services as usual, then switch callback traffic:

```bash
orchport switch fix-login
```

Behavior:

- Patterns are exact paths such as `/auth/callback` or trailing-prefix patterns such as `/auth/callback/*`.
- `**` and middle `*` wildcards are rejected.
- Ownership is stored in `switches.json` under the Orchport state directory.
- `orchport run` claims configured switchable slots for the current worktree.
- If another worktree owns a slot, `orchport run` fails unless `--force-switch` is set.
- If the selected worktree has no matching run state, the proxy returns `502` for that switched path.

## State Directory and Agent Sandboxes

Orchport stores run records, switch ownership, and proxy daemon state under:

```txt
$XDG_STATE_HOME/orchport
```

If `XDG_STATE_HOME` is unset, the default is:

```txt
~/.local/state/orchport
```

Override it when needed:

```bash
ORCHPORT_STATE_DIR=/tmp/orchport-state orchport run -- turbo dev
```

Agent sandboxes such as Cursor, Codex, and Claude Code often restrict writes outside the workspace. If Orchport cannot write state, add the absolute state directory path to the agent's writable paths. `orchport doctor` prints the resolved path and verifies read/write access.

## Port Allocation

Orchport probes candidate ports by briefly listening on `127.0.0.1`.

| Setting                     | Behavior                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `strategy: "smaller"`       | Try from the range minimum upward.                                                                     |
| `strategy: "larger"`        | Try from the range maximum downward.                                                                   |
| `strategy: "deterministic"` | Hash `sld`, `worktree`, and proxy name to choose a stable starting point, then wrap through the range. |
| `strict: true`              | Fail if the configured port or range is unavailable.                                                   |
| `strict: false`             | Warn and fall back to the root `portRange` when possible.                                              |

The default root range is `[43100, 43999]`.

## Troubleshooting

### `No free port in range ...`

The configured range is exhausted or the sandbox cannot bind local sockets. Increase the range, stop stale dev servers, or run `orchport doctor` to check the environment.

### `Requested port ... is not available`

The entry is strict and the requested port is already in use. Free that port, change the range, or set `strict: false`.

### Browser TLS warnings

`proxy.tls: "dev"` uses an ephemeral self-signed certificate. Trust it locally if you want a warning-free browser session, or set `proxy.tls: false` for HTTP.

### Node or Bun cannot fetch `https://*.localhost`

Use `orchport run`, not only `orchport env`, so Orchport can create the certificate and inject `NODE_EXTRA_CA_CERTS`.

### Nested runs skip resolution

If `ORCHPORT=1` is already present, `orchport run` assumes it is inside another Orchport process and skips re-resolution. Use `--nested` or `--force-env` on `run` when you intentionally want a nested run.

## Development

This repository uses Bun:

```bash
bun install
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run build
bun run build:compile
./dist/orchport --version
```

Release notes and version bumps are managed with Changesets:

```bash
bun changeset
bun run version-packages
```

Do not edit `CHANGELOG.md` directly; add a `.changeset/*.md` entry for release-facing changes.
