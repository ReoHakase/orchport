/**
 * Privileged long-lived reverse proxy (`orchport proxy up`).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

import { getLogger } from "@logtape/logtape";
import { define } from "gunshi";

import {
  formatCliFailLine,
  formatCliOkLine,
  formatCliSuccess,
} from "../cli/format.ts";
import { loadConfig } from "../config/load.ts";
import { buildLocalProxyHost } from "../core/local-proxy-host.ts";
import { resolveProxyIdentity } from "../core/proxy-identity.ts";
import { pickPortInRange } from "../ports/allocate.ts";
import { generateDevSelfSignedTlsSync } from "../proxy/dev-tls.ts";
import { ProxyRouteWatcher } from "../proxy/route-watcher.ts";
import {
  startReverseProxy,
  tryStartReverseProxyPort,
  type ProxyTls,
} from "../proxy/server.ts";
import {
  deleteProxyDaemonStateFile,
  isProxyDaemonRunning,
  pidAlive,
  readProxyDaemonState,
  writeProxyDaemonState,
} from "../state/proxy-daemon.ts";
import { proxyRoutesDir } from "../state/proxy-routes.ts";
import type { ProxyDaemonStateFile } from "../state/types.ts";
import { ErrorCode, OrchportError } from "../utils/errors.ts";
import { pickBoolean, pickString } from "../utils/pick.ts";
import {
  normalizeProcessArgv,
  tryReexecWithSudo,
} from "../utils/sudo-reexec.ts";

const log = getLogger(["orchport", "proxy", "daemon"]);

/** Prevents infinite sudo re-exec loops for `orchport proxy up`. */
const ORCHPORT_ELEVATED_PROXY = "ORCHPORT_ELEVATED_PROXY";

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const toProxyTls = (tls: {
  cert: string;
  key: string;
  ca?: string;
}): ProxyTls => ({
  cert: Bun.file(tls.cert),
  key: Bun.file(tls.key),
  ...(tls.ca ? { ca: Bun.file(tls.ca) } : {}),
});

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
        ErrorCode.CONFIG_TLS_FILE,
        `proxy.tls.${label}: file not found: ${p}`,
        {
          hint: "Paths are resolved relative to the config file.",
          context: { label, path: p },
        }
      );
    }
  }
};

/** Poll until `daemon.json` reflects the spawned child PID or the child dies / timeout. */
const waitForDaemonReady = async (
  childPid: number
): Promise<ProxyDaemonStateFile> => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const s = readProxyDaemonState();
    if (s !== null && s.pid === childPid && pidAlive(s.pid)) {
      return s;
    }
    try {
      process.kill(childPid, 0);
    } catch {
      throw new OrchportError(
        ErrorCode.PROXY_BIND,
        "orchport proxy daemon exited before it became ready",
        {
          hint: "Run `orchport proxy up --foreground` to see errors in the terminal.",
        }
      );
    }
    /* sequential poll delay */
    /* eslint-disable-next-line no-await-in-loop */
    await sleep(50);
  }
  try {
    process.kill(childPid, "SIGTERM");
  } catch {
    /* ignore */
  }
  throw new OrchportError(
    ErrorCode.PROXY_BIND,
    "Timed out waiting for orchport proxy daemon to start",
    {
      hint: "Try `orchport proxy up --foreground` to debug, or check port conflicts.",
    }
  );
};

export const proxyCommand = define({
  name: "proxy",
  description:
    "Manage the privileged reverse proxy daemon (usually `sudo orchport proxy up`)",
  args: {
    verb: {
      type: "positional",
      description: "up | down | status",
    },
    json: {
      type: "boolean",
      description: "Machine-readable status output",
      default: false,
    },
    foreground: {
      type: "boolean",
      description:
        "Stay in the foreground until Ctrl+C (default: detach as a background daemon)",
      default: false,
    },
    elevate: {
      type: "boolean",
      description:
        "If the privileged HTTPS listener bind fails, re-exec once via sudo -E (non-interactive; TTY sessions retry automatically when needed)",
      default: false,
    },
  },
  run: async (ctx) => {
    const cwd = ctx.env.cwd ?? process.cwd();
    const values = ctx.values;
    const verb = pickString(values, "verb")?.trim().toLowerCase();
    const jsonOut = pickBoolean(values, "json") === true;
    const tty = process.stdout.isTTY === true && !jsonOut;

    if (verb === "down") {
      const s = readProxyDaemonState();
      if (s === null) {
        throw new OrchportError(
          ErrorCode.PROXY_DAEMON_NOT_RUNNING,
          "No orchport proxy daemon state found",
          {
            hint: "Start one with `orchport proxy up` (proxy is not running).",
          }
        );
      }
      try {
        process.kill(s.pid, "SIGTERM");
      } catch {
        /* ignore */
      }
      deleteProxyDaemonStateFile();
      if (!jsonOut) {
        process.stdout.write(
          formatCliSuccess(`sent SIGTERM to orchport proxy (pid ${s.pid})`, {
            tty,
          })
        );
      } else {
        process.stdout.write(
          `${JSON.stringify({ ok: true, pid: s.pid, signal: "SIGTERM" })}\n`
        );
      }
      return;
    }

    if (verb === "status") {
      const s = readProxyDaemonState();
      const alive = s !== null && pidAlive(s.pid);
      if (jsonOut) {
        process.stdout.write(
          `${JSON.stringify({
            running: alive,
            state: s,
          })}\n`
        );
        return;
      }
      if (s === null) {
        process.stdout.write(
          formatCliFailLine("daemon", "not configured (no daemon.json)", {
            tty,
          })
        );
        return;
      }
      process.stdout.write(
        formatCliOkLine(
          "daemon",
          alive
            ? `pid ${s.pid} main :${s.mainPort} https ${s.httpsPort ?? "off"}`
            : `pid ${s.pid} (not running)`,
          { tty }
        )
      );
      return;
    }

    if (verb !== "up") {
      throw new OrchportError(
        ErrorCode.CLI_USAGE,
        "Usage: orchport proxy <up|down|status>",
        {
          hint: "Example: `orchport proxy up` (background) or `orchport proxy up --foreground`",
        }
      );
    }

    if (isProxyDaemonRunning()) {
      throw new OrchportError(
        ErrorCode.PROXY_DAEMON_ALREADY_RUNNING,
        "orchport proxy daemon is already running",
        {
          hint: "Stop it with `orchport proxy down` or send SIGTERM to the recorded pid.",
        }
      );
    }

    const config = await loadConfig({
      cwd,
      config: pickString(values, "config"),
    });
    const mode = config.mode ?? "local-port";
    if (mode !== "local-proxy") {
      throw new OrchportError(
        ErrorCode.CLI_USAGE,
        "orchport proxy up requires `mode: local-proxy` in config",
        {
          hint: "Set mode to local-proxy or use in-process `orchport run` without the daemon.",
        }
      );
    }

    const id = resolveProxyIdentity({
      cwd,
      config,
      sldCli: pickString(values, "sld"),
      tldCli: pickString(values, "tld"),
      worktreeCli: pickString(values, "worktree"),
    });

    const [pMin, pMax] = config.portRange ?? [43100, 43999];
    const proxyPort = await pickPortInRange({
      sld: id.sld,
      worktree: id.worktree,
      entryName: "__orchport_daemon__",
      min: pMin,
      max: pMax,
      avoid: new Set(),
    });

    const tlsCfg = config.proxy?.tls;
    let fileTls: { cert: string; key: string; ca?: string } | undefined;
    let devTlsCleanup: (() => void) | null = null;
    if (tlsCfg === "dev") {
      const hostnames = Object.keys(config.proxies).map((name) =>
        buildLocalProxyHost(name, id.worktreeHostPrefix, id.sld, id.tld)
      );
      const gen = generateDevSelfSignedTlsSync(hostnames);
      devTlsCleanup = gen.cleanup;
      fileTls = { cert: gen.certPath, key: gen.keyPath };
    } else if (tlsCfg && typeof tlsCfg === "object") {
      assertTlsFilesExist(tlsCfg);
      fileTls = tlsCfg;
    }

    let extraHttpsPort: number | undefined;
    const httpsPortOpt = config.proxy?.httpsPort;
    if (httpsPortOpt === false) {
      log.debug("Skipping extra listener (proxy.httpsPort: false)");
    } else if (typeof httpsPortOpt === "number") {
      extraHttpsPort = httpsPortOpt;
    } else if (fileTls) {
      extraHttpsPort = 443;
    }

    const privilegedExtra =
      extraHttpsPort !== undefined &&
      extraHttpsPort < 1024 &&
      typeof process.getuid === "function" &&
      process.getuid() !== 0 &&
      process.env[ORCHPORT_ELEVATED_PROXY] !== "1";

    const interactive =
      process.stdin.isTTY === true && process.stdout.isTTY === true;
    const elevateCli = pickBoolean(values, "elevate") === true;

    if (privilegedExtra && (interactive || elevateCli)) {
      log.info(
        "proxy: privileged HTTPS listener on port {port}; re-exec via sudo -E",
        { port: String(extraHttpsPort) }
      );
      tryReexecWithSudo(ORCHPORT_ELEVATED_PROXY);
    }

    const foreground = pickBoolean(values, "foreground") === true;
    if (!foreground) {
      let cmd = normalizeProcessArgv();
      if (!cmd.includes("--foreground")) {
        cmd.push("--foreground");
      }
      const exe = cmd[0];
      if (exe === undefined || exe === "") {
        throw new OrchportError(
          ErrorCode.PROXY_BIND,
          "Cannot spawn proxy daemon (argv[0] missing)",
          {
            hint: "Try `orchport proxy up --foreground`, set ORCHPORT_SUDO_ARGV0=./dist/orchport when using `bun` + embedded path, or run `bun build --compile --outfile ./dist/orchport`.",
          }
        );
      }
      const child = spawn(exe, cmd.slice(1), {
        cwd: process.cwd(),
        detached: true,
        env: process.env,
        stdio: "ignore",
      });
      child.unref();
      const cpid = child.pid;
      if (cpid === undefined) {
        throw new OrchportError(
          ErrorCode.PROXY_BIND,
          "Could not spawn orchport proxy daemon process",
          { hint: "Try `orchport proxy up --foreground` to see errors." }
        );
      }
      const st = await waitForDaemonReady(cpid);
      if (!jsonOut) {
        process.stdout.write(
          formatCliSuccess(
            `orchport proxy daemon started (pid ${st.pid}, main :${st.mainPort}, https ${st.httpsPort ?? "off"})`,
            { tty }
          )
        );
      } else {
        process.stdout.write(`${JSON.stringify({ ok: true, state: st })}\n`);
      }
      return;
    }

    const routesDir = proxyRoutesDir();
    await mkdir(routesDir, { recursive: true });

    const watcher = new ProxyRouteWatcher(routesDir);
    watcher.startWatching();
    const resolver = watcher.getResolver();

    const emptyRoutes = new Map<string, number>();
    const bundle = fileTls ? toProxyTls(fileTls) : undefined;

    const proxyStops: Array<() => void> = [];
    proxyStops.push(
      startReverseProxy({
        port: proxyPort,
        routes: emptyRoutes,
        routeResolver: resolver,
        ...(bundle ? { tls: bundle } : {}),
      }).stop
    );

    let httpsPort: number | null = null;

    if (
      extraHttpsPort !== undefined &&
      extraHttpsPort >= 1 &&
      extraHttpsPort <= 65535
    ) {
      const extraTls = fileTls ? toProxyTls(fileTls) : undefined;
      const extraResult = tryStartReverseProxyPort({
        port: extraHttpsPort,
        routes: emptyRoutes,
        routeResolver: resolver,
        ...(extraTls ? { tls: extraTls } : {}),
      });
      if (extraResult.ok) {
        proxyStops.push(extraResult.server.stop);
        httpsPort = extraHttpsPort;
      } else {
        const retrySudo =
          extraHttpsPort < 1024 &&
          process.env[ORCHPORT_ELEVATED_PROXY] !== "1" &&
          typeof process.getuid === "function" &&
          process.getuid() !== 0 &&
          (elevateCli ||
            (process.stdin.isTTY === true && process.stdout.isTTY === true));
        if (retrySudo) {
          log.info(
            "proxy: extra listener bind failed (errno={errno}); re-exec via sudo -E",
            { errno: extraResult.errnoCode ?? "unknown" }
          );
          tryReexecWithSudo(ORCHPORT_ELEVATED_PROXY);
        }
      }
    }

    const state: ProxyDaemonStateFile = {
      version: 1,
      pid: process.pid,
      mainPort: proxyPort,
      httpsPort,
      tls: Boolean(fileTls),
      certPath: fileTls?.cert ?? null,
      startedAt: new Date().toISOString(),
    };
    await writeProxyDaemonState(state);

    log.info("proxy daemon listening main={main} https={https} (pid={pid})", {
      main: String(proxyPort),
      https: httpsPort !== null ? String(httpsPort) : "off",
      pid: String(process.pid),
    });

    await new Promise<void>((resolveShutdown) => {
      const shutdown = (): void => {
        for (let i = proxyStops.length - 1; i >= 0; i--) {
          proxyStops[i]();
        }
        watcher.stop();
        if (devTlsCleanup !== null) {
          devTlsCleanup();
        }
        deleteProxyDaemonStateFile();
        resolveShutdown();
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
  },
});
