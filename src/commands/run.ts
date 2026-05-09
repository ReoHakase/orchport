import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { getLogger } from "@logtape/logtape";
import { define } from "gunshi";

import { loadConfig } from "../config/load.ts";
import { buildLocalProxyHost } from "../core/local-proxy-host.ts";
import { resolveSession } from "../core/resolve-session.ts";
import type { ResolvedSession } from "../core/resolve-session.ts";
import { forwardSignalsToChild, spawnInherit } from "../process/run-child.ts";
import { generateDevSelfSignedTlsSync } from "../proxy/dev-tls.ts";
import {
  startReverseProxy,
  tryStartReverseProxyPort,
  type ProxyTls,
  type SwitchRoutingContext,
} from "../proxy/server.ts";
import { tryWriteRunState } from "../state/store.ts";
import { claimSwitchSlotsForRun } from "../state/switch-registry.ts";
import type { RunStateFile } from "../state/types.ts";
import { isNestedOrchportMarker } from "../utils/env-keys.ts";
import { OrchportError } from "../utils/errors.ts";
import { pickBoolean, pickString, pickStringArray } from "../utils/pick.ts";
import { entryKeyToEnvPrefix } from "../utils/snake.ts";

const log = getLogger(["orchport", "run"]);

const newRunId = (): string => randomBytes(8).toString("hex");

/** Trust PEM for Node/Bun (`NODE_EXTRA_CA_CERTS`) and Deno (`DENO_CERT`) when proxy serves TLS. */
const applyProxyTlsCertToChildEnv = (
  childEnv: Record<string, string | undefined>,
  certPath: string
): void => {
  const certAbs = resolve(certPath);
  childEnv.ORCHPORT_DEV_TLS_CERT_FILE = certAbs;
  log.trace("run: child ORCHPORT_DEV_TLS_CERT_FILE={path}", { path: certAbs });

  if (!childEnv.NODE_EXTRA_CA_CERTS?.trim()) {
    childEnv.NODE_EXTRA_CA_CERTS = certAbs;
    log.trace("run: child NODE_EXTRA_CA_CERTS set from proxy TLS cert");
  } else {
    log.debug(
      "run: NODE_EXTRA_CA_CERTS already set; not overriding (merge ORCHPORT_DEV_TLS_CERT_FILE manually if needed)"
    );
  }

  if (!childEnv.DENO_CERT?.trim()) {
    childEnv.DENO_CERT = certAbs;
    log.trace("run: child DENO_CERT set from proxy TLS cert");
  } else {
    log.debug(
      "run: DENO_CERT already set; not overriding (merge ORCHPORT_DEV_TLS_CERT_FILE manually for Deno if needed)"
    );
  }
};

const assertTlsFilesExist = (tls: {
  cert: string;
  key: string;
  ca?: string;
}): void => {
  const pairs: [string, string][] = [
    ["cert", tls.cert],
    ["key", tls.key],
  ];
  if (tls.ca) {
    pairs.push(["ca", tls.ca]);
  }
  for (const [label, p] of pairs) {
    if (!existsSync(p)) {
      throw new OrchportError(
        "CONFIG",
        `proxy.tls.${label}: file not found: ${p}`
      );
    }
  }
};

const toProxyTls = (tls: {
  cert: string;
  key: string;
  ca?: string;
}): ProxyTls => ({
  cert: Bun.file(tls.cert),
  key: Bun.file(tls.key),
  ...(tls.ca ? { ca: Bun.file(tls.ca) } : {}),
});

/** Built-in URL scheme only; custom `config.url` is left unchanged. */
const patchBuiltinProxyUrlsToHttp = (
  env: Record<string, string | undefined>,
  session: ResolvedSession
): void => {
  if (session.proxyPort === undefined) {
    return;
  }
  const { sld, tld, worktreeHostPrefix } = session;
  for (const name of Object.keys(session.entries)) {
    const prefix = entryKeyToEnvPrefix(name);
    const host = buildLocalProxyHost(name, worktreeHostPrefix, sld, tld);
    env[`ORCHPORT_${prefix}_URL`] = `http://${host}:${session.proxyPort}`;
  }
};

/** When :443 (or configured standard port) did not bind; keep HTTPS on main proxy port. */
const patchBuiltinProxyUrlsToHttpsMainPort = (
  env: Record<string, string | undefined>,
  session: ResolvedSession,
  mainProxyPort: number
): void => {
  const { sld, tld, worktreeHostPrefix } = session;
  for (const name of Object.keys(session.entries)) {
    const prefix = entryKeyToEnvPrefix(name);
    const host = buildLocalProxyHost(name, worktreeHostPrefix, sld, tld);
    env[`ORCHPORT_${prefix}_URL`] = `https://${host}:${mainProxyPort}`;
  }
};

/**
 * Resolve config, allocate ports, optionally start reverse proxy (and best-effort `proxy.httpsPort`), inject `ORCHPORT_*`, then exec the wrapped command.
 *
 * Options: `--proxy` forces proxy allocation; `--nested` / `--force-env` disable nested pass-through; `--` separates orchport flags from the child command (needed when the child uses `-` flags).
 */
export const runCommand = define({
  name: "run",
  description: "Resolve ports/env and run a command",
  args: {
    nested: {
      type: "boolean",
      description: "Force nested resolution (disable pass-through)",
      default: false,
    },
    forceEnv: {
      type: "boolean",
      description: "Force full env resolution even when ORCHPORT=1",
      default: false,
    },
    proxy: {
      type: "boolean",
      description: "Start local reverse proxy (Host -> entry ports)",
      default: false,
    },
    command: {
      type: "positional",
      multiple: true,
      description: "Command and arguments to run",
    },
  },
  run: async (ctx) => {
    const cwd = ctx.env.cwd ?? process.cwd();
    const values = ctx.values;
    const nested = pickBoolean(values, "nested") ?? false;
    const forceEnv = pickBoolean(values, "forceEnv") ?? false;
    const proxyFlag = pickBoolean(values, "proxy") ?? false;
    const fromArgs = pickStringArray(values, "command") ?? [];
    const rest = ctx.rest ?? [];
    const cmd = [...fromArgs, ...rest];
    if (cmd.length === 0) {
      throw new Error(
        "run requires a command (e.g. orchport run -- turbo dev)"
      );
    }

    const passThrough =
      isNestedOrchportMarker(process.env) && !forceEnv && !nested;

    if (passThrough) {
      log.info("run: nested pass-through (skipping resolution) cmd={cmd}", {
        cmd: cmd.join(" "),
      });
      log.trace("run: ORCHPORT marker present; child inherits env");
      const envCopy: Record<string, string | undefined> = {};
      for (const k of Object.keys(process.env)) {
        const v = process.env[k];
        envCopy[k] = v;
      }
      const child = spawnInherit({
        cmd,
        env: envCopy,
        cwd,
      });
      const detach = forwardSignalsToChild(child);
      const code = await child.exited;
      detach();
      process.exitCode = code;
      return;
    }

    log.debug("run: resolving cwd={cwd}", { cwd });
    const config = await loadConfig({
      cwd,
      config: pickString(values, "config"),
    });

    const withProxy = proxyFlag || config.mode === "local-proxy";
    log.debug("run: withProxy={p} proxyFlag={f} configMode={m}", {
      p: String(withProxy),
      f: String(proxyFlag),
      m: config.mode ?? "local-port",
    });

    const runId = newRunId();
    log.debug("run: runId={runId}", { runId });
    const sldCli = pickString(values, "sld");
    const session = await resolveSession({
      cwd,
      config,
      sldCli,
      tldCli: pickString(values, "tld"),
      worktreeCli: pickString(values, "worktree"),
      runId,
      withProxy,
    });

    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      ...session.env,
      ORCHPORT_ROOT_PID: String(process.pid),
    };

    const routes = new Map<string, number>();
    if (session.proxyPort !== undefined) {
      for (const [name, e] of Object.entries(session.entries)) {
        const host = buildLocalProxyHost(
          name,
          session.worktreeHostPrefix,
          session.sld,
          session.tld
        );
        routes.set(host, e.port);
        log.trace("run: route {host} -> 127.0.0.1:{port}", {
          host,
          port: String(e.port),
        });
      }
    }

    let switchRouting: SwitchRoutingContext | undefined;
    if (session.proxyPort !== undefined && routes.size > 0) {
      const hostToEntry = new Map<string, string>();
      const entrySwitchable = new Map<string, readonly string[]>();
      let anySwitchable = false;
      for (const name of Object.keys(session.entries)) {
        const host = buildLocalProxyHost(
          name,
          session.worktreeHostPrefix,
          session.sld,
          session.tld
        );
        hostToEntry.set(host, name);
        const sw = config.entries[name]?.switchable;
        if (sw !== undefined && sw.length > 0) {
          anySwitchable = true;
          entrySwitchable.set(name, sw);
        }
      }
      if (anySwitchable) {
        await claimSwitchSlotsForRun({
          sld: session.sld,
          tld: session.tld,
          worktree: session.worktree,
          runId,
          entries: config.entries,
          force: pickBoolean(values, "forceSwitch") ?? false,
        });
        switchRouting = {
          hostToEntry,
          entrySwitchable,
          sld: session.sld,
          tld: session.tld,
          worktree: session.worktree,
        };
      }
    }

    const proxyStops: Array<() => void> = [];
    let devTlsCleanup: (() => void) | null = null;
    const tlsCfg = config.proxy?.tls;
    let fileTls: { cert: string; key: string; ca?: string } | undefined;

    if (session.proxyPort !== undefined && routes.size > 0) {
      if (tlsCfg === "dev") {
        const hostnames = Object.keys(session.entries).map((name) =>
          buildLocalProxyHost(
            name,
            session.worktreeHostPrefix,
            session.sld,
            session.tld
          )
        );
        log.trace("Generating ephemeral dev TLS (openssl)");
        const gen = generateDevSelfSignedTlsSync(hostnames);
        devTlsCleanup = gen.cleanup;
        fileTls = { cert: gen.certPath, key: gen.keyPath };
      } else if (tlsCfg && typeof tlsCfg === "object") {
        assertTlsFilesExist(tlsCfg);
        fileTls = tlsCfg;
      }

      if (fileTls) {
        const bundle = toProxyTls(fileTls);
        log.trace("Main proxy: HTTPS on port {port}", {
          port: String(session.proxyPort),
        });
        try {
          proxyStops.push(
            startReverseProxy({
              port: session.proxyPort,
              routes,
              tls: bundle,
              switchRouting,
            }).stop
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warning("TLS reverse proxy failed, falling back to HTTP: {msg}", {
            msg,
          });
          proxyStops.push(
            startReverseProxy({
              port: session.proxyPort,
              routes,
              switchRouting,
            }).stop
          );
          if (typeof config.url !== "function") {
            patchBuiltinProxyUrlsToHttp(childEnv, session);
            delete childEnv.ORCHPORT_HTTPS_PROXY_PORT;
          }
        }
      } else {
        log.trace("Main proxy: HTTP on port {port}", {
          port: String(session.proxyPort),
        });
        proxyStops.push(
          startReverseProxy({
            port: session.proxyPort,
            routes,
            switchRouting,
          }).stop
        );
      }

      const httpsPortOpt = config.proxy?.httpsPort;
      let extraHttpsPort: number | undefined;
      if (httpsPortOpt === false) {
        log.debug("Skipping extra listener (proxy.httpsPort: false)");
      } else if (typeof httpsPortOpt === "number") {
        extraHttpsPort = httpsPortOpt;
      } else if (fileTls) {
        extraHttpsPort = 443;
        log.debug(
          "Trying default extra HTTPS listener on port 443 (set proxy.httpsPort: false to skip, or a port number to override)"
        );
      }

      if (
        extraHttpsPort !== undefined &&
        extraHttpsPort >= 1 &&
        extraHttpsPort <= 65535
      ) {
        log.trace("Extra listener: port {port} tls={tls}", {
          port: String(extraHttpsPort),
          tls: String(Boolean(fileTls)),
        });
        const extraTls = fileTls ? toProxyTls(fileTls) : undefined;
        const extra = tryStartReverseProxyPort({
          port: extraHttpsPort,
          routes,
          switchRouting,
          ...(extraTls ? { tls: extraTls } : {}),
        });
        if (extra) {
          proxyStops.push(extra.stop);
          childEnv.ORCHPORT_HTTPS_PROXY_PORT = String(extraHttpsPort);
        } else if (fileTls && typeof config.url !== "function") {
          log.warning(
            "Extra HTTPS on port {port} not available; ORCHPORT_*_URL use main proxy TLS port {main}",
            {
              port: String(extraHttpsPort),
              main: String(session.proxyPort),
            }
          );
          patchBuiltinProxyUrlsToHttpsMainPort(
            childEnv,
            session,
            session.proxyPort
          );
          delete childEnv.ORCHPORT_HTTPS_PROXY_PORT;
        }
      }
    }

    if (fileTls) {
      applyProxyTlsCertToChildEnv(childEnv, fileTls.cert);
    }

    const runState: RunStateFile = {
      runId,
      rootPid: process.pid,
      command: cmd,
      workspace: session.sld,
      worktree: session.worktree,
      mode: session.mode,
      createdAt: new Date().toISOString(),
      configPath: session.configPath,
      entries: Object.fromEntries(
        Object.keys(session.entries).map((k) => {
          const v = session.entries[k];
          const prefix = entryKeyToEnvPrefix(k);
          return [
            k,
            {
              port: v.port,
              url: childEnv[`ORCHPORT_${prefix}_URL`] ?? v.url,
              localUrl: childEnv[`ORCHPORT_${prefix}_LOCAL_URL`] ?? v.localUrl,
            },
          ];
        })
      ),
      proxyPort: session.proxyPort,
    };
    const persisted = await tryWriteRunState(runState);
    if (!persisted) {
      childEnv.ORCHPORT_VOLATILE_STATE = "1";
      log.warning("run: state not persisted (ORCHPORT_VOLATILE_STATE=1)");
    } else {
      log.debug("run: wrote state runId={runId}", { runId });
    }

    log.info("run: spawning child cmd={cmd} runId={runId}", {
      cmd: cmd.join(" "),
      runId,
    });
    log.trace("run: child env ORCHPORT_* count={n}", {
      n: String(
        Object.keys(childEnv).filter(
          (k) => k.startsWith("ORCHPORT") && childEnv[k] !== undefined
        ).length
      ),
    });
    const child = spawnInherit({ cmd, env: childEnv, cwd });
    const detach = forwardSignalsToChild(child);
    const code = await child.exited;
    log.info("run: child exited code={code} runId={runId}", {
      code: String(code),
      runId,
    });
    detach();
    for (let i = proxyStops.length - 1; i >= 0; i--) {
      proxyStops[i]();
    }
    log.debug("run: stopped {n} proxy listener(s)", {
      n: String(proxyStops.length),
    });
    if (devTlsCleanup) {
      devTlsCleanup();
      log.trace("run: dev TLS temp files removed");
    }
    process.exitCode = code;
  },
});
