# AGENTS.md

Refer to [docs/plan.md](docs/plan.md) for product requirements and phased scope. For **implementation status** (what is already shipped in this repo), see the **「実装ステータス」** section near the end of that file.

## CLI development

When creating or changing command-line interfaces, follow the **use-gunshi-cli** skill ([.agents/skills/use-gunshi-cli/SKILL.md](.agents/skills/use-gunshi-cli/SKILL.md)) and the Gunshi docs under `node_modules/@gunshi/docs/`.

## Logging

Use **LogTape** only (`@logtape/logtape`, `@logtape/pretty` for TTY formatting). Configure via [src/logging/setup.ts](src/logging/setup.ts). Do not add ad-hoc `console.error` for diagnostics—use `getLogger([...])` and structured `logger.info("msg {k}", { k })` style calls so oxlint stays clean.

**CLI:** global **`--verbose` / `-v`** sets the lowest level to **`trace`** (every `orchport.*` logger: `debug` + `trace` diagnostics, proxy request traces, full argv, session/env key dumps). It also **turns off “production” log formatting** on **`bun build --compile` binaries** so categories and levels stay visible (same as `ORCHPORT_LOG_PRETTY=1` behavior for format). LogTape’s own meta logger stays at **`warning`** in verbose mode so the long “loggers are configured” INFO banner is suppressed. **`--quiet` / `-q`** caps at **`warning`**. **`LOG_LEVEL`** applies only when neither verbose nor quiet is set (invalid values ignored). **`--no-color`** disables ANSI in pretty mode.

User-facing command output (e.g. `orchport env --json`) must stay on **stdout**; logs go to **stderr**. **`orchport env`** defaults to a **cli-table3** Unicode table on a **TTY** (color when **`NO_COLOR`** is unset); **piped** stdout or **`--plain`** prints **`KEY=value`** lines. Use **`--json`**, **`--shell`**, or **`--dotenv`** for scripts.

When **not** launched via `bun` or `node` (e.g. `bun build --compile` binary), or when `NODE_ENV=production`, stderr uses a **plain** formatter: no category prefix (`orchport·cli`), no ANSI colors, and string fields are not wrapped in quotes. Set `ORCHPORT_LOG_PRETTY=1` to force the TTY pretty formatter on the binary for debugging.

## Code conventions

- **TypeScript**: `strict` per [tsconfig.json](tsconfig.json). Avoid type assertions; use guards in [src/utils/pick.ts](src/utils/pick.ts) and [src/config/guards.ts](src/config/guards.ts) where needed.
- **Lint / format**: [oxlint.config.ts](oxlint.config.ts), [oxfmt.config.ts](oxfmt.config.ts); run `bun run lint` and `bun run format` before commit.
- **Imports**: Use explicit `.ts` extensions (Bun + `allowImportingTsExtensions`).
- **Tests**: Pure logic in `test/unit/`; CLI integration in `test/e2e/`. Isolate state with `ORCHPORT_STATE_DIR` or a temp directory.
- **Run + subprocess flags**: If the wrapped command uses options that start with `-`, invoke **`orchport run -- cmd ...`** so Gunshi passes the full argv (see e2e tests).

## Standard environment variables

orchport injects **`ORCHPORT=1`**, **`ORCHPORT_*`** (version, run id, workspace, worktree, per-entry `ORCHPORT_<ENTRY>_PORT|HOST|URL|LOCAL_URL`, proxy ports, etc.). Keys **`ORCHPORT`**, **`ORCHPORT_*`**, and legacy **`orchport` / `orchport_*`** are reserved: user `env` in config cannot override them.

**TLS trust (run only):** when the reverse proxy uses TLS (`proxy.tls: dev` or PEM files), **`orchport run`** also sets **`ORCHPORT_DEV_TLS_CERT_FILE`** to the server certificate PEM path (absolute). If **`NODE_EXTRA_CA_CERTS`** / **`DENO_CERT`** are unset or empty in the parent environment, they are set to the same path so **Node/Bun** (`NODE_EXTRA_CA_CERTS`) and **Deno** (`DENO_CERT`; Deno does not read `NODE_EXTRA_CA_CERTS`) can verify HTTPS to built-in `ORCHPORT_*_URL`. If either variable is already non-empty, orchport does not override (merge PEMs manually if you need both a corporate CA and the proxy cert). **`orchport env`** does not emit these paths (no PEM exists until `run` allocates one).

**Nested runs:** when the parent has set **`ORCHPORT=1`** (or legacy **`orchport=1`**), `orchport run` pass-through skips re-resolution unless `--nested` or `--force-env`.

## Workspace and readable URLs

- Default **workspace** is the **git repository root folder name** (`git rev-parse --show-toplevel`), then falls back to the current directory basename.
- **`worktreeHostPrefix`**: on the **origin default branch** (`refs/remotes/origin/HEAD`), built-in hostnames omit the worktree segment (`web.myrepo.localhost` not `web.main.myrepo.localhost`). Optional TS **`url` function** receives `worktreeHostPrefix` if you override URLs. `env` templates still use `\${entries.*}` etc.

## Path switch (`switchable` / `orchport switch`)

- Entries may set **`switchable`**: path pattern(s)—exact path or trailing **`/prefix/*`** only (no `**`). OAuth callbacks can share a stable host while routing specific paths to another worktree’s backend.
- Ownership is stored in **`switches.json`** under `ORCHPORT_STATE_DIR` / XDG state. On **`orchport run`** with local-proxy, slots are **claimed** for the current worktree; if another worktree already owns a slot, **`orchport run` exits with an error** unless **`--force-switch`** (global) is set.
- **`orchport switch <worktree-slug>`** rewrites all configured `switchable` slots to point at that worktree (no proxy restart). The proxy resolves the target **port** from the **latest matching run state** for that worktree + entry; if none, the request returns **502**.

## Local proxy, TLS, and fallbacks

- **`ORCHPORT_*_LOCAL_URL`** is always **`http://localhost:<entry.port>`** (direct to the process). It does not depend on the reverse proxy or TLS.
- With **TLS** and **`proxy.httpsPort` not `false`**, built-in **`ORCHPORT_*_URL`** use **`https://<host>`** (implicit **:443**) and **`ORCHPORT_HTTPS_PROXY_PORT=443`** (or your custom port). The **main** listener remains on **`ORCHPORT_PROXY_PORT`** (high port). **`orchport run`** tries to bind the standard port; if that fails, URLs are rewritten to **`https://<host>:<ORCHPORT_PROXY_PORT>`** and **`ORCHPORT_HTTPS_PROXY_PORT`** is cleared.
- **`mode: local-proxy`** allocates a high **main proxy port** (HTTP by default). With **`proxy.tls: dev`**, orchport runs **`openssl`** once, writes ephemeral PEMs under the OS temp dir, and serves **HTTPS** for each entry’s `*.localhost` hostname—no cert files to maintain. Requires **`openssl` on PATH** (macOS/Linux CI typically have it). Browser warnings for self-signed are expected unless you trust the cert. PEMs are removed after the child exits; until then **`orchport run`** exposes the cert path via **`ORCHPORT_DEV_TLS_CERT_FILE`** and optionally **`NODE_EXTRA_CA_CERTS`** / **`DENO_CERT`** (see Standard environment variables).
- With **`proxy.tls`** as **`{ cert, key }`** (PEM paths, resolved relative to the config file), the main listener uses **HTTPS** the same way. Paths must exist at startup or `orchport run` fails with a config error.
- If **TLS setup fails at runtime** (e.g. bad material), orchport **logs a warning**, falls back to **HTTP** on the same main port, and rewrites built-in **`ORCHPORT_*_URL`** to `http://` (skipped when the config uses a custom TypeScript **`url` function**).
- **`proxy.httpsPort`**: optional extra listener. When **TLS is active** (`dev` or file PEMs) and this is **omitted**, orchport **tries port 443** by default (DX). Set **`httpsPort: false`** to skip the extra listener, or a **number** to use another port. **HTTPS** on the extra listener when TLS is active; otherwise **plain HTTP** (legacy). Binding **443** often needs elevated privileges; failure is a warning only and the main proxy keeps running.
- **No sudo / no TTY** is required for the default path: high ports + `tls: dev` or optional PEM files. Prefer **`bun run build:compile`** + ad-hoc codesign on macOS so the binary is not SIGKILL’d (see `scripts/build-compile.ts`).

Minimal **`https://api.<worktreeHostPrefix><workspace>.localhost` → `http://localhost:8000`** (workspace defaults from the git repo root name if omitted):

```yaml
mode: local-proxy
proxy:
  tls: dev
entries:
  api:
    port: 8000
```

## Docs

When adding commands, flags, or env vars, update **docs/plan.md** (status / behavior) and, if user-facing examples change, **docs/target.md**.
