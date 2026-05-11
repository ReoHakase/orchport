---
name: orchport
description: Use when configuring Orchport in a downstream project, especially Turborepo or monorepo dev workflows, orchport.config.* files, ORCHPORT_* environment variables, local-proxy/TLS setup, switchables for OAuth callbacks, or debugging port and state-directory issues.
---

# Orchport

Use this skill when adding or maintaining Orchport in another repository. Focus on the target project's existing scripts and dev-server contracts; do not impose a new package manager, task runner, or framework layout.

## First Pass

Before editing, inspect the target repo for:

- `package.json` scripts and package manager.
- `turbo.json`, workspace config, or other monorepo task config.
- Existing `orchport.config.ts`, `orchport.yaml`, or `orchport.json`.
- Dev servers and their current port conventions.
- Auth callback, CORS, and public URL environment variables.
- README or agent docs that mention local development.

Prefer the smallest change that makes current dev commands work through Orchport.

## Config Defaults

- Prefer `orchport.config.ts` with `defineConfig` in typed JavaScript/TypeScript projects.
- Use YAML or JSON only when the target repo already prefers those formats.
- Use `mode: "local-proxy"` when browser-facing URLs should be stable and readable.
- Use `proxy: { tls: "dev", httpsPort: false }` when the repo needs HTTPS locally but should not require privileged port 443.
- Name proxies after services, such as `web`, `api`, `db`, `email`, or `storybook`.
- Keep `range` close to each service's current default port when possible.
- Add `env` templates for public URLs that must stay consistent, such as `APP_BASE_URL`, `NEXT_PUBLIC_API_BASE_URL`, `API_PUBLIC_URL`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, `CORS_ORIGIN`, and database URLs.

Example:

```ts
import { defineConfig } from "orchport";

export default defineConfig({
  sld: "myapp",
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
      switchables: ["/auth/callback/*"],
    },
    db: { range: [5000, 5099], strategy: "deterministic" },
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

## Script Patterns

For a whole monorepo dev command, wrap the root task:

```json
{
  "scripts": {
    "dev:orchport": "orchport run -- turbo dev",
    "env:orchport": "orchport env"
  }
}
```

Individual packages should read their generated service port, for example `ORCHPORT_WEB_PORT` or `ORCHPORT_API_PORT`.

For a single service, target the proxy name:

```json
{
  "scripts": {
    "dev:api": "orchport run api -- turbo dev --filter=@acme/api"
  }
}
```

In `orchport run <proxy> -- ...`, Orchport injects that proxy's flat environment, including `PORT`, so service code can keep reading `process.env.PORT`.

Keep `--` before wrapped commands that may receive dash-prefixed options.

## Subcommand Usage

Use these command shapes when documenting or wiring Orchport:

| Command                                  | Use                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `orchport init`                          | Create `orchport.config.ts`; use `--format yaml` or `--format json` only when that matches the repo. |
| `orchport doctor`                        | Verify config loading plus state-directory read/write access.                                        |
| `orchport env`                           | Show resolved env without running a child command; TTY output is grouped by proxy.                   |
| `orchport env --json`                    | Machine-readable resolved env for scripts and tests.                                                 |
| `orchport env <proxy> --plain`           | Show the exact flat env for `orchport run <proxy> -- ...`.                                           |
| `orchport run -- <command>`              | Resolve all proxies, start the local proxy when configured, and run the repo dev command.            |
| `orchport run <proxy> -- <command>`      | Run one service with that proxy's flat env, including `PORT`.                                        |
| `orchport list` / `orchport list --json` | Inspect recorded runs. Use `--stale` to find dead run records.                                       |
| `orchport kill <target>`                 | Stop a recorded run by entry name, port, or run id fragment.                                         |
| `orchport kill --stale`                  | Remove dead run records without signalling live processes.                                           |
| `orchport switch <worktree>`             | Route configured `switchables` paths to another worktree.                                            |
| `orchport proxy up\|down\|status`        | Manage a long-lived proxy daemon for `local-proxy` configs.                                          |

## Environment and TLS

- `ORCHPORT_<NAME>_PORT` is the local listen port for a proxy.
- `ORCHPORT_<NAME>_URL` is the public proxy URL.
- `ORCHPORT_<NAME>_LOCAL_URL` is always direct `http://localhost:<port>`.
- `ORCHPORT_*` and lowercase legacy `orchport_*` names are reserved and should not be set by user config.
- With TLS, `orchport run` exposes `ORCHPORT_DEV_TLS_CERT_FILE` and sets `NODE_EXTRA_CA_CERTS` / `DENO_CERT` only when the parent did not already set them.
- `orchport env` does not emit runtime certificate paths because no certificate exists until `run`.

## Switchables

Use `switchables` for stable OAuth callback URLs across worktrees:

- Patterns are exact paths or trailing `/prefix/*` only.
- `orchport run` claims switchable slots for the current worktree.
- Use `orchport switch <worktree>` to route matching callback paths to another worktree without restarting the proxy.
- If another worktree owns a slot, use `--force-switch` only when taking over is intentional.

## Output Examples

Use short, realistic examples in docs. Keep stdout examples separate from stderr logs.

Human `orchport env` output is grouped by global values and proxy-specific values:

```txt
mode local-proxy  sld myapp  worktree fix-login

global
Variable                  Value
───────────────────────────────────────────────────────────
ORCHPORT                  1
APP_BASE_URL              https://web.fix-login.myapp.localhost

api
Variable                  Value
───────────────────────────────────────────────────────────
PORT                      4001
ORCHPORT_API_URL          https://api.fix-login.myapp.localhost
ORCHPORT_API_LOCAL_URL    http://localhost:4001
```

`orchport env api --plain` shows the flat env a targeted run receives:

```txt
PORT=4001
ORCHPORT=1
ORCHPORT_API_PORT=4001
ORCHPORT_API_URL=https://api.fix-login.myapp.localhost
ORCHPORT_API_LOCAL_URL=http://localhost:4001
```

`orchport list` should show enough information to identify the run and direct URLs:

```txt
web  fix-login  pid 12345  https://web.fix-login.myapp.localhost  http://localhost:3001
api  fix-login  pid 12346  https://api.fix-login.myapp.localhost  http://localhost:4001
```

`orchport switch fix-login` should make callback routing explicit:

```txt
Switchable
https://api.myapp.localhost/auth/callback/* -> http://localhost:4001/auth/callback/*
```

## Validation

After changes, run the cheapest checks that prove the integration:

```bash
orchport doctor
orchport env
orchport env --json
orchport run -- <existing-dev-command>
```

Also check README, package scripts, and agent docs for drift when command names, proxy names, URLs, or environment variables change.
