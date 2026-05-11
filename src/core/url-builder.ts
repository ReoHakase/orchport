/**
 * Public URL for a resolved proxy (matches built-in ORCHPORT_*_URL rules).
 */
import type { LoadedConfig, ResolvedProxyShape } from "../config/schema.ts";
import { buildLocalProxyHost } from "./local-proxy-host.ts";

export const buildEntryUrl = (options: {
  config: LoadedConfig;
  proxy: ResolvedProxyShape;
  sld: string;
  tld: string;
  worktree: string;
  worktreeHostPrefix: string;
  mode?: "local-port" | "local-proxy";
  proxyPort?: number;
}): string => {
  const {
    config,
    proxy,
    sld,
    tld,
    worktree,
    worktreeHostPrefix,
    mode = config.mode ?? "local-port",
    proxyPort,
  } = options;

  if (typeof config.url === "function") {
    return config.url({
      proxy,
      sld,
      tld,
      workspace: sld,
      worktree,
      worktreeHostPrefix,
      mode,
    });
  }

  if (mode === "local-proxy" && proxyPort) {
    const host = buildLocalProxyHost(proxy.name, worktreeHostPrefix, sld, tld);
    const tls = config.proxy?.tls;
    const useTls =
      tls !== false &&
      (tls === "dev" || (typeof tls === "object" && tls !== null));
    if (!useTls) {
      return `http://${host}:${proxyPort}`;
    }
    /** Standard public port (443 default) when not opted out; main listener stays on `proxyPort`. */
    const hp = config.proxy?.httpsPort;
    if (hp === false) {
      return `https://${host}:${proxyPort}`;
    }
    const pub = typeof hp === "number" ? hp : 443;
    if (pub === 443) {
      return `https://${host}`;
    }
    return `https://${host}:${pub}`;
  }

  return `http://${proxy.name}.${worktreeHostPrefix}${sld}${tld}:${proxy.port}`;
};
