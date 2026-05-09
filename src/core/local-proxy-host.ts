/**
 * @module orchport/core/local-proxy-host
 * Hostnames for `local-proxy` mode (must match built-in URL rules in resolve-session).
 */

/**
 * Lowercase hostname: `<entry>.<worktreeHostPrefix><sld><tld>`
 * (e.g. `api.main.acme.localhost` with `tld` `.localhost`).
 */
export const buildLocalProxyHost = (
  entryName: string,
  worktreeHostPrefix: string,
  sld: string,
  tld: string
): string => `${entryName}.${worktreeHostPrefix}${sld}${tld}`.toLowerCase();
