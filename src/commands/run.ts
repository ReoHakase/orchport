import { randomBytes } from "node:crypto";

import { getLogger } from "@logtape/logtape";
import { define } from "gunshi";

import {
  bold,
  cliUseColor,
  formatNextLine,
  muted,
  statusIcon,
  type CliUiOptions,
} from "../cli/format.ts";
import { loadConfig } from "../config/load.ts";
import { buildLocalProxyHost } from "../core/local-proxy-host.ts";
import { resolveSession } from "../core/resolve-session.ts";
import { forwardSignalsToChild, spawnInherit } from "../process/run-child.ts";
import { startInProcessLocalProxy } from "../proxy/in-process.ts";
import type { SwitchRoutingContext } from "../proxy/server.ts";
import { tryWriteRunState } from "../state/store.ts";
import { claimSwitchSlotsForRun } from "../state/switch-registry.ts";
import type { RunStateFile } from "../state/types.ts";
import { isNestedOrchportMarker } from "../utils/env-keys.ts";
import { ErrorCode, OrchportError } from "../utils/errors.ts";
import { pickBoolean, pickString, pickStringArray } from "../utils/pick.ts";
import { entryKeyToEnvPrefix } from "../utils/snake.ts";
import { tryReexecWithSudo } from "../utils/sudo-reexec.ts";
import {
  applyDaemonProxyIfRunning,
  cleanupDaemonRouteRegistration,
} from "./run-daemon-bridge.ts";
import { applyProxyTlsCertToChildEnv } from "./run-tls-env.ts";

const log = getLogger(["orchport", "run"]);

/** Prevents infinite sudo re-exec loops when `--elevate` is used. */
const ORCHPORT_ELEVATED_RUN = "ORCHPORT_ELEVATED_RUN";

const newRunId = (): string => randomBytes(8).toString("hex");

const reexecRunWithSudo = (): void => {
  tryReexecWithSudo(ORCHPORT_ELEVATED_RUN);
};

const writeRunLine = (enabled: boolean, text: string): void => {
  if (enabled) {
    process.stderr.write(`${text}\n`);
  }
};

/** If the first token is a configured proxy name, treat it as `orchport run <proxy> -- cmd…`. */
const parseRunTarget = (
  tokens: string[],
  proxyNames: ReadonlySet<string>
): { runTarget?: string; childCmd: string[] } => {
  const parts = tokens.filter((t) => t !== "--");
  if (parts.length === 0) {
    return { childCmd: [] };
  }
  const first = parts[0];
  if (first !== undefined && proxyNames.has(first)) {
    if (parts.length < 2) {
      throw new OrchportError(
        ErrorCode.RUN_NO_COMMAND,
        `orchport run ${first} requires a command (e.g. orchport run ${first} -- bun dev)`,
        {
          hint: "Put the child command after the proxy name (after `--` if it uses flags).",
        }
      );
    }
    return { runTarget: first, childCmd: parts.slice(1) };
  }
  return { childCmd: parts };
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
      toKebab: true,
      description: "Force full env resolution even when ORCHPORT=1",
      default: false,
    },
    proxy: {
      type: "boolean",
      description: "Start local reverse proxy (Host -> entry ports)",
      default: false,
    },
    elevate: {
      type: "boolean",
      description:
        "If the extra HTTPS listener fails on a privileged port (<1024), re-exec once via sudo -E (Bun may mis-report errno as EADDRINUSE or omit code). No-op on Windows or when already root.",
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
    const quiet = pickBoolean(values, "quiet") ?? false;
    const humanStderr = !quiet;
    const ui: CliUiOptions = {
      color: cliUseColor(process.stderr, {
        noColor: pickBoolean(values, "noColor") ?? false,
      }),
    };
    const fromArgs = pickStringArray(values, "command") ?? [];
    const rest = ctx.rest ?? [];
    const cmdTokens = [...fromArgs, ...rest];
    if (cmdTokens.length === 0) {
      throw new OrchportError(
        ErrorCode.RUN_NO_COMMAND,
        "run requires a command (e.g. orchport run -- turbo dev)",
        {
          hint: "Put the child command after `--` when it uses flags starting with `-`.",
        }
      );
    }

    const passThrough =
      isNestedOrchportMarker(process.env) && !forceEnv && !nested;

    if (passThrough) {
      writeRunLine(
        humanStderr,
        `${statusIcon("info", ui)} nested orchport environment detected; passing through`
      );
      log.info("run: nested pass-through (skipping resolution) cmd={cmd}", {
        cmd: cmdTokens.join(" "),
      });
      log.trace("run: ORCHPORT marker present; child inherits env");
      const envCopy: Record<string, string | undefined> = {};
      for (const k of Object.keys(process.env)) {
        const v = process.env[k];
        envCopy[k] = v;
      }
      const child = spawnInherit({
        cmd: cmdTokens,
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

    const { runTarget, childCmd } = parseRunTarget(
      cmdTokens,
      new Set(Object.keys(config.proxies))
    );
    if (childCmd.length === 0) {
      throw new OrchportError(
        ErrorCode.RUN_NO_COMMAND,
        "run requires a command (e.g. orchport run -- turbo dev)",
        {
          hint: "Put the child command after `--` when it uses flags starting with `-`.",
        }
      );
    }

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
      runTarget,
    });
    writeRunLine(
      humanStderr,
      `${bold(runTarget === undefined ? "orchport run" : `orchport run ${runTarget}`, ui)}`
    );
    writeRunLine(
      humanStderr,
      `${statusIcon("info", ui)} workspace ${session.sld} / worktree ${session.worktree}`
    );

    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      ...session.env,
      ORCHPORT_ROOT_PID: String(process.pid),
    };

    const routes = new Map<string, number>();
    if (session.proxyPort !== undefined) {
      for (const [name, e] of Object.entries(session.proxies)) {
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
      const proxySwitchables = new Map<string, readonly string[]>();
      let anySwitchable = false;
      for (const name of Object.keys(session.proxies)) {
        const host = buildLocalProxyHost(
          name,
          session.worktreeHostPrefix,
          session.sld,
          session.tld
        );
        hostToEntry.set(host, name);
        const sw = config.proxies[name]?.switchables;
        if (sw !== undefined && sw.length > 0) {
          anySwitchable = true;
          proxySwitchables.set(name, sw);
        }
      }
      if (anySwitchable) {
        await claimSwitchSlotsForRun({
          sld: session.sld,
          tld: session.tld,
          worktree: session.worktree,
          runId,
          proxies: config.proxies,
          force: pickBoolean(values, "forceSwitch") ?? false,
        });
        switchRouting = {
          hostToEntry,
          proxySwitchables,
          sld: session.sld,
          tld: session.tld,
          worktree: session.worktree,
        };
      }
    }

    let proxyStops: Array<() => void> = [];
    let devTlsCleanup: (() => void) | null = null;
    let fileTls: { cert: string; key: string; ca?: string } | undefined;

    const usedDaemon = await applyDaemonProxyIfRunning({
      childEnv,
      session,
      config,
      routes,
      switchRouting,
      runId,
    });

    if (!usedDaemon && session.proxyPort !== undefined && routes.size > 0) {
      const r = startInProcessLocalProxy({
        childEnv,
        session,
        config,
        routes,
        switchRouting,
        values,
        elevatedRunMarker: ORCHPORT_ELEVATED_RUN,
        tryReexecWithSudo: reexecRunWithSudo,
      });
      proxyStops = r.proxyStops;
      devTlsCleanup = r.devTlsCleanup;
      fileTls = r.fileTls;
    }

    if (session.proxyPort !== undefined) {
      const scheme =
        Object.values(childEnv).some(
          (value) => typeof value === "string" && value.startsWith("https://")
        ) || fileTls !== undefined
          ? "HTTPS"
          : "HTTP";
      writeRunLine(
        humanStderr,
        `${statusIcon("info", ui)} proxy ${scheme} on :${childEnv.ORCHPORT_PROXY_PORT ?? String(session.proxyPort)}`
      );
      if (
        session.env.ORCHPORT_HTTPS_PROXY_PORT !== undefined &&
        childEnv.ORCHPORT_HTTPS_PROXY_PORT === undefined
      ) {
        writeRunLine(
          humanStderr,
          `${statusIcon("warn", ui)} extra HTTPS :${session.env.ORCHPORT_HTTPS_PROXY_PORT} unavailable; public URLs use :${childEnv.ORCHPORT_PROXY_PORT ?? String(session.proxyPort)}`
        );
      }
    }

    if (fileTls) {
      applyProxyTlsCertToChildEnv(childEnv, fileTls.cert);
    }

    const runState: RunStateFile = {
      runId,
      rootPid: process.pid,
      command: childCmd,
      workspace: session.sld,
      worktree: session.worktree,
      mode: session.mode,
      createdAt: new Date().toISOString(),
      configPath: session.configPath,
      proxies: Object.fromEntries(
        Object.keys(session.proxies).map((k) => {
          const v = session.proxies[k];
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
      proxyPort:
        childEnv.ORCHPORT_PROXY_PORT !== undefined
          ? Number(childEnv.ORCHPORT_PROXY_PORT)
          : session.proxyPort,
    };
    const persisted = await tryWriteRunState(runState);
    if (!persisted) {
      childEnv.ORCHPORT_VOLATILE_STATE = "1";
      log.warning("run: state not persisted (ORCHPORT_VOLATILE_STATE=1)");
    } else {
      log.debug("run: wrote state runId={runId}", { runId });
    }

    log.info("run: spawning child cmd={cmd} runId={runId}", {
      cmd: childCmd.join(" "),
      runId,
    });
    writeRunLine(
      humanStderr,
      `${statusIcon("info", ui)} command ${childCmd.join(" ")}`
    );
    writeRunLine(humanStderr, `${muted(`run ${runId}`, ui)}\n`);
    log.trace("run: child env ORCHPORT_* count={n}", {
      n: String(
        Object.keys(childEnv).filter(
          (k) => k.startsWith("ORCHPORT") && childEnv[k] !== undefined
        ).length
      ),
    });
    const child = spawnInherit({ cmd: childCmd, env: childEnv, cwd });
    const detach = forwardSignalsToChild(child);
    const code = await child.exited;
    log.info("run: child exited code={code} runId={runId}", {
      code: String(code),
      runId,
    });
    const ok = code === 0;
    writeRunLine(
      humanStderr,
      `${statusIcon(ok ? "ok" : "error", ui)} child exited ${code}  ${muted(`run ${runId}`, ui)}`
    );
    if (!ok) {
      process.stderr.write(
        formatNextLine(
          "inspect the child command output above and rerun after fixing it.",
          ui
        )
      );
    }
    detach();
    if (usedDaemon) {
      await cleanupDaemonRouteRegistration(runId);
    }
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
