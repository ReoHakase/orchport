/**
 * Rewrite child `ORCHPORT_*` when routing through an external `orchport proxy` daemon.
 */
import type { LoadedConfig } from "../config/schema.ts";
import type { ResolvedSession } from "../core/resolve-session.ts";
import type { ProxyDaemonStateFile } from "../state/types.ts";
import { entryKeyToEnvPrefix } from "../utils/snake.ts";
import { buildEntryUrl } from "./url-builder.ts";

export const applyDaemonEnvToChild = (
  childEnv: Record<string, string | undefined>,
  session: ResolvedSession,
  config: LoadedConfig,
  daemon: ProxyDaemonStateFile
): void => {
  childEnv.ORCHPORT_PROXY_PORT = String(daemon.mainPort);
  if (daemon.httpsPort !== null) {
    childEnv.ORCHPORT_HTTPS_PROXY_PORT = String(daemon.httpsPort);
  } else {
    delete childEnv.ORCHPORT_HTTPS_PROXY_PORT;
  }
  const proxyPort = daemon.mainPort;
  for (const name of Object.keys(session.proxies)) {
    const e = session.proxies[name];
    const prefix = entryKeyToEnvPrefix(name);
    childEnv[`ORCHPORT_${prefix}_URL`] = buildEntryUrl({
      config,
      proxy: e,
      sld: session.sld,
      tld: session.tld,
      worktree: session.worktree,
      worktreeHostPrefix: session.worktreeHostPrefix,
      proxyPort,
    });
    childEnv[`ORCHPORT_${prefix}_LOCAL_URL`] = e.localUrl;
    childEnv[`ORCHPORT_${prefix}_PORT`] = String(e.port);
    childEnv[`ORCHPORT_${prefix}_HOST`] = e.host;
  }
};
