/**
 * Rewrite env URLs when the reverse proxy falls back to HTTP or a non-standard HTTPS port.
 */
import { getLogger } from "@logtape/logtape";

import { buildLocalProxyHost } from "../core/local-proxy-host.ts";
import type { ResolvedSession } from "../core/resolve-session.ts";
import { isReservedOrchportEnvKey } from "../utils/env-keys.ts";
import { entryKeyToEnvPrefix } from "../utils/snake.ts";

const log = getLogger(["orchport", "run", "env-patch"]);

/** Built-in URL scheme only; custom `config.url` is left unchanged. */
export const patchBuiltinProxyUrlsToHttp = (
  env: Record<string, string | undefined>,
  session: ResolvedSession
): void => {
  if (session.proxyPort === undefined) {
    return;
  }
  const { sld, tld, worktreeHostPrefix } = session;
  for (const name of Object.keys(session.proxies)) {
    const prefix = entryKeyToEnvPrefix(name);
    const host = buildLocalProxyHost(name, worktreeHostPrefix, sld, tld);
    env[`ORCHPORT_${prefix}_URL`] = `http://${host}:${session.proxyPort}`;
  }
};

/** When :443 (or configured standard port) did not bind; keep HTTPS on main proxy port. */
export const patchBuiltinProxyUrlsToHttpsMainPort = (
  env: Record<string, string | undefined>,
  session: ResolvedSession,
  mainProxyPort: number
): void => {
  const { sld, tld, worktreeHostPrefix } = session;
  for (const name of Object.keys(session.proxies)) {
    const prefix = entryKeyToEnvPrefix(name);
    const host = buildLocalProxyHost(name, worktreeHostPrefix, sld, tld);
    env[`ORCHPORT_${prefix}_URL`] = `https://${host}:${mainProxyPort}`;
  }
};

/**
 * When built-in `ORCHPORT_*_URL` values are rewritten at runtime, sync user `env` values that
 * exactly matched the session-resolved entry URL (e.g. `TURSO_DATABASE_URL` from `${db.url}`).
 */
export const patchUserEnvMatchingEntryUrls = (
  env: Record<string, string | undefined>,
  session: ResolvedSession,
  newUrlForEntry: (name: string) => string
): void => {
  for (const name of Object.keys(session.proxies)) {
    const oldUrl = session.proxies[name].url;
    const newUrl = newUrlForEntry(name);
    if (oldUrl === newUrl) {
      continue;
    }
    for (const key of Object.keys(env)) {
      if (isReservedOrchportEnvKey(key)) {
        continue;
      }
      if (env[key] === oldUrl) {
        env[key] = newUrl;
        log.trace("run: patched user env {key} after entry URL rewrite", {
          key,
        });
      }
    }
  }
};
