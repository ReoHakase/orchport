/**
 * In-process reverse proxy + optional privileged HTTPS listener (`orchport run` default path).
 */
import { getLogger } from "@logtape/logtape";

import type { LoadedConfig } from "../config/schema.ts";
import { buildLocalProxyHost } from "../core/local-proxy-host.ts";
import type { ResolvedSession } from "../core/resolve-session.ts";
import { pickBoolean } from "../utils/pick.ts";
import {
  startReverseProxy,
  tryStartReverseProxyPort,
  type SwitchRoutingContext,
} from "./server.ts";
import {
  isValidTcpPort,
  resolveProxyTlsMaterial,
  selectExtraProxyPort,
  toProxyTls,
} from "./tls-material.ts";
import {
  patchBuiltinProxyUrlsToHttp,
  patchBuiltinProxyUrlsToHttpsMainPort,
  patchUserEnvMatchingEntryUrls,
} from "./url-patch.ts";

const log = getLogger(["orchport", "run", "proxy"]);

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
  let fileTls: { cert: string; key: string; ca?: string } | undefined;

  if (session.proxyPort === undefined || routes.size === 0) {
    return { proxyStops, devTlsCleanup, fileTls };
  }

  {
    const material = resolveProxyTlsMaterial({
      config,
      sld: session.sld,
      tld: session.tld,
      worktreeHostPrefix: session.worktreeHostPrefix,
    });
    devTlsCleanup = material.devTlsCleanup;
    fileTls = material.fileTls;
  }
  if (config.proxy?.tls === "dev") {
    log.trace("Generating ephemeral dev TLS (openssl)");
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

  const extraHttpsPort = selectExtraProxyPort({
    httpsPort: config.proxy?.httpsPort,
    tlsActive: fileTls !== undefined,
  });
  if (config.proxy?.httpsPort === false) {
    log.debug("Skipping extra listener (proxy.httpsPort: false)");
  } else if (extraHttpsPort === 443 && fileTls) {
    log.debug(
      "Trying default extra HTTPS listener on port 443 (set proxy.httpsPort: false to skip, or a port number to override)"
    );
  }

  if (isValidTcpPort(extraHttpsPort)) {
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
