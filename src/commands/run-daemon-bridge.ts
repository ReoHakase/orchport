/**
 * When `orchport proxy up` is running, `orchport run` registers routes instead of binding listeners.
 */
import { existsSync } from "node:fs";

import type { LoadedConfig } from "../config/schema.ts";
import { applyDaemonEnvToChild } from "../core/daemon-env.ts";
import { buildLocalProxyHost } from "../core/local-proxy-host.ts";
import type { ResolvedSession } from "../core/resolve-session.ts";
import type { SwitchRoutingContext } from "../proxy/server.ts";
import {
  patchBuiltinProxyUrlsToHttpsMainPort,
  patchUserEnvMatchingEntryUrls,
} from "../proxy/url-patch.ts";
import { readProxyDaemonState } from "../state/proxy-daemon.ts";
import {
  deleteProxyRouteRegistration,
  writeProxyRouteRegistration,
} from "../state/proxy-routes.ts";
import { ErrorCode, OrchportError } from "../utils/errors.ts";
import { pidAlive } from "../utils/process.ts";
import { applyProxyTlsCertToChildEnv } from "./run-tls-env.ts";

const expectedDaemonTlsHosts = (session: ResolvedSession): string[] =>
  Object.keys(session.proxies).map((name) =>
    buildLocalProxyHost(
      name,
      session.worktreeHostPrefix,
      session.sld,
      session.tld
    )
  );

const assertDaemonTlsCoversSession = (
  session: ResolvedSession,
  daemonHosts: readonly string[] | undefined
): void => {
  if (daemonHosts === undefined || daemonHosts.length === 0) {
    throw new OrchportError(
      ErrorCode.DEV_TLS,
      "Running proxy daemon dev TLS certificate does not expose hostname coverage",
      {
        hint: "Restart `orchport proxy up` with the current orchport version, use file-based TLS that covers all daemon hosts, or run without the daemon.",
      }
    );
  }
  {
    const covered = new Set(daemonHosts.map((h) => h.toLowerCase()));
    const missing = expectedDaemonTlsHosts(session).filter(
      (h) => !covered.has(h.toLowerCase())
    );
    if (missing.length === 0) {
      return;
    }
    throw new OrchportError(
      ErrorCode.DEV_TLS,
      `Running proxy daemon dev TLS certificate does not cover ${missing.join(", ")}`,
      {
        hint: "Restart `orchport proxy up` for this workspace/worktree, use file-based TLS that covers all daemon hosts, or run without the daemon.",
        context: { host: missing[0] ?? "" },
      }
    );
  }
};

export const applyDaemonProxyIfRunning = async (options: {
  childEnv: Record<string, string | undefined>;
  session: ResolvedSession;
  config: LoadedConfig;
  routes: ReadonlyMap<string, number>;
  switchRouting: SwitchRoutingContext | undefined;
  runId: string;
}): Promise<boolean> => {
  const daemon = readProxyDaemonState();
  if (daemon === null || !pidAlive(daemon.pid)) {
    return false;
  }

  if (daemon.tls && daemon.tlsKind === undefined) {
    throw new OrchportError(
      ErrorCode.DEV_TLS,
      "Running proxy daemon TLS mode is ambiguous",
      {
        hint: "Restart `orchport proxy up` with the current orchport version so TLS host coverage is recorded.",
      }
    );
  }

  if (daemon.tlsKind === "dev") {
    assertDaemonTlsCoversSession(options.session, daemon.tlsHosts);
  }

  await writeProxyRouteRegistration({
    runId: options.runId,
    routes: options.routes,
    switchRouting: options.switchRouting,
  });

  applyDaemonEnvToChild(
    options.childEnv,
    options.session,
    options.config,
    daemon
  );

  if (
    daemon.tls &&
    daemon.httpsPort === null &&
    typeof options.config.url !== "function"
  ) {
    patchBuiltinProxyUrlsToHttpsMainPort(
      options.childEnv,
      options.session,
      daemon.mainPort
    );
    patchUserEnvMatchingEntryUrls(options.childEnv, options.session, (name) => {
      const host = buildLocalProxyHost(
        name,
        options.session.worktreeHostPrefix,
        options.session.sld,
        options.session.tld
      );
      return `https://${host}:${daemon.mainPort}`;
    });
  }

  if (daemon.certPath !== null && daemon.certPath !== "") {
    const p = daemon.certPath;
    if (existsSync(p)) {
      applyProxyTlsCertToChildEnv(options.childEnv, p);
    }
  }

  return true;
};

export const cleanupDaemonRouteRegistration = async (
  runId: string
): Promise<void> => {
  await deleteProxyRouteRegistration(runId);
};
