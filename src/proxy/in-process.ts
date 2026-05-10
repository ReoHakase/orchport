/**
 * In-process reverse proxy + optional privileged HTTPS listener (`orchport run` default path).
 */
import { existsSync } from "node:fs";

import { getLogger } from "@logtape/logtape";

import type { LoadedConfig } from "../config/schema.ts";
import { buildLocalProxyHost } from "../core/local-proxy-host.ts";
import type { ResolvedSession } from "../core/resolve-session.ts";
import { ErrorCode, OrchportError } from "../utils/errors.ts";
import { pickBoolean } from "../utils/pick.ts";
import { generateDevSelfSignedTlsSync } from "./dev-tls.ts";
import {
  startReverseProxy,
  tryStartReverseProxyPort,
  type ProxyTls,
  type SwitchRoutingContext,
} from "./server.ts";
import {
  patchBuiltinProxyUrlsToHttp,
  patchBuiltinProxyUrlsToHttpsMainPort,
  patchUserEnvMatchingEntryUrls,
} from "./url-patch.ts";

const log = getLogger(["orchport", "run", "proxy"]);

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
          hint: "Set paths relative to the config file or use absolute paths; files must exist before `orchport run`.",
          context: { label, path: p },
        }
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

export type StartInProcessProxyOptions = {
  childEnv: Record<string, string | undefined>;
  session: ResolvedSession;
  config: LoadedConfig;
  routes: Map<string, number>;
  switchRouting: SwitchRoutingContext | undefined;
  /** Gunshi ctx.values (for `elevate`). */
  values: object;
  elevatedRunMarker: string;
  tryReexecWithSudo: () => void;
};

export type StartInProcessProxyResult = {
  proxyStops: Array<() => void>;
  devTlsCleanup: (() => void) | null;
  fileTls: { cert: string; key: string; ca?: string } | undefined;
};

export const startInProcessLocalProxy = (
  opts: StartInProcessProxyOptions
): StartInProcessProxyResult => {
  const {
    childEnv,
    session,
    config,
    routes,
    switchRouting,
    values,
    elevatedRunMarker,
    tryReexecWithSudo,
  } = opts;

  const proxyStops: Array<() => void> = [];
  let devTlsCleanup: (() => void) | null = null;
  const tlsCfg = config.proxy?.tls;
  let fileTls: { cert: string; key: string; ca?: string } | undefined;

  if (session.proxyPort === undefined || routes.size === 0) {
    return { proxyStops, devTlsCleanup, fileTls };
  }

  if (tlsCfg === "dev") {
    const hostnames = Object.keys(session.proxies).map((name) =>
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
        if (session.proxyPort !== undefined) {
          patchUserEnvMatchingEntryUrls(childEnv, session, (name) => {
            const host = buildLocalProxyHost(
              name,
              session.worktreeHostPrefix,
              session.sld,
              session.tld
            );
            return `http://${host}:${session.proxyPort}`;
          });
        }
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
    const extraResult = tryStartReverseProxyPort({
      port: extraHttpsPort,
      routes,
      switchRouting,
      ...(extraTls ? { tls: extraTls } : {}),
    });
    if (extraResult.ok) {
      proxyStops.push(extraResult.server.stop);
      childEnv.ORCHPORT_HTTPS_PROXY_PORT = String(extraHttpsPort);
    } else {
      const elevateRequested = pickBoolean(values, "elevate") ?? false;
      log.trace(
        "run: extra listener bind failed port={port} errno={errno} elevate={elevate}",
        {
          port: String(extraHttpsPort),
          errno: extraResult.errnoCode ?? "unknown",
          elevate: String(elevateRequested),
        }
      );
      if (
        elevateRequested &&
        extraHttpsPort < 1024 &&
        process.env[elevatedRunMarker] !== "1" &&
        typeof process.getuid === "function" &&
        process.getuid() !== 0
      ) {
        log.info(
          "run: privileged extra listener on port {port} bind failed (errno={errno}); re-executing via sudo -E (password may be prompted)",
          {
            port: String(extraHttpsPort),
            errno: extraResult.errnoCode ?? "unknown",
          }
        );
        tryReexecWithSudo();
      }
      if (fileTls && typeof config.url !== "function") {
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
        patchUserEnvMatchingEntryUrls(childEnv, session, (name) => {
          const host = buildLocalProxyHost(
            name,
            session.worktreeHostPrefix,
            session.sld,
            session.tld
          );
          return `https://${host}:${session.proxyPort}`;
        });
        delete childEnv.ORCHPORT_HTTPS_PROXY_PORT;
      }
    }
  }

  return { proxyStops, devTlsCleanup, fileTls };
};
