import { existsSync } from "node:fs";

import type { LoadedConfig } from "../config/schema.ts";
import { buildLocalProxyHost } from "../core/local-proxy-host.ts";
import { ErrorCode, OrchportError } from "../utils/errors.ts";
import { generateDevSelfSignedTlsSync } from "./dev-tls.ts";
import type { ProxyTls } from "./server.ts";

export type ProxyTlsFiles = {
  cert: string;
  key: string;
  ca?: string;
};

export type ResolvedProxyTlsMaterial = {
  fileTls: ProxyTlsFiles | undefined;
  devTlsCleanup: (() => void) | null;
};

export const assertTlsFilesExist = (
  tls: ProxyTlsFiles,
  hint = "Set paths relative to the config file or use absolute paths; files must exist before starting the proxy."
): void => {
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
          hint,
          context: { label, path: p },
        }
      );
    }
  }
};

export const toProxyTls = (tls: ProxyTlsFiles): ProxyTls => ({
  cert: Bun.file(tls.cert),
  key: Bun.file(tls.key),
  ...(tls.ca ? { ca: Bun.file(tls.ca) } : {}),
});

export const resolveProxyTlsMaterial = (options: {
  config: LoadedConfig;
  sld: string;
  tld: string;
  worktreeHostPrefix: string;
}): ResolvedProxyTlsMaterial => {
  const tlsCfg = options.config.proxy?.tls;
  if (tlsCfg === "dev") {
    const hostnames = Object.keys(options.config.proxies).map((name) =>
      buildLocalProxyHost(
        name,
        options.worktreeHostPrefix,
        options.sld,
        options.tld
      )
    );
    const gen = generateDevSelfSignedTlsSync(hostnames);
    return {
      fileTls: { cert: gen.certPath, key: gen.keyPath },
      devTlsCleanup: gen.cleanup,
    };
  }
  if (tlsCfg && typeof tlsCfg === "object") {
    assertTlsFilesExist(tlsCfg);
    return { fileTls: tlsCfg, devTlsCleanup: null };
  }
  return { fileTls: undefined, devTlsCleanup: null };
};

export const selectExtraProxyPort = (options: {
  httpsPort: false | number | undefined;
  tlsActive: boolean;
}): number | undefined => {
  if (options.httpsPort === false) {
    return undefined;
  }
  if (typeof options.httpsPort === "number") {
    return options.httpsPort;
  }
  return options.tlsActive ? 443 : undefined;
};

export const isValidTcpPort = (port: number | undefined): port is number =>
  port !== undefined && port >= 1 && port <= 65535;
