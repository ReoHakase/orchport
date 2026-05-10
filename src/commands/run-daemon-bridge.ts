/**
 * When `orchport proxy up` is running, `orchport run` registers routes instead of binding listeners.
 */
import { existsSync } from "node:fs";

import type { LoadedConfig } from "../config/schema.ts";
import { applyDaemonEnvToChild } from "../core/daemon-env.ts";
import type { ResolvedSession } from "../core/resolve-session.ts";
import type { SwitchRoutingContext } from "../proxy/server.ts";
import { readProxyDaemonState } from "../state/proxy-daemon.ts";
import {
  deleteProxyRouteRegistration,
  writeProxyRouteRegistration,
} from "../state/proxy-routes.ts";
import { pidAlive } from "../utils/process.ts";
import { applyProxyTlsCertToChildEnv } from "./run-tls-env.ts";

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
