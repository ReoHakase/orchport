/**
 * @module orchport/proxy/server
 * Local reverse proxy (Host header → 127.0.0.1:port); optional TLS; optional path-based switch routing.
 */
import { getLogger } from "@logtape/logtape";

import {
  buildSwitchRegistryKey,
  readSwitchRegistry,
  resolveSwitchTargetPort,
} from "../state/switch-registry.ts";
import { pathnameMatchesSwitchPattern } from "./path-match.ts";

const log = getLogger(["orchport", "proxy"]);

export type ProxyTls = {
  cert: Bun.BunFile;
  key: Bun.BunFile;
  ca?: Bun.BunFile;
};

export type ProxyServer = {
  stop: () => void;
};

/** Result of attempting the optional extra listener (e.g. port 443). */
export type TryExtraProxyResult =
  | { ok: true; server: ProxyServer }
  | { ok: false; errnoCode?: string };

const errnoFromUnknown = (err: unknown): string | undefined => {
  if (typeof err !== "object" || err === null || !("code" in err)) {
    return undefined;
  }
  const code = Reflect.get(err, "code");
  return typeof code === "string" ? code : undefined;
};

/** When set, paths matching configured `switchables` may proxy to another worktree's port (see switches.json). */
export type SwitchRoutingContext = {
  hostToEntry: ReadonlyMap<string, string>;
  proxySwitchables: ReadonlyMap<string, readonly string[]>;
  sld: string;
  tld: string;
  worktree: string;
};

/** Dynamic routes + optional per-host switch routing (daemon merges route files). */
export type ProxyRouteResolver = {
  getRoutes: () => ReadonlyMap<string, number>;
  getSwitchRoutingForHost: (
    hostLower: string
  ) => SwitchRoutingContext | undefined;
  refresh?: () => Promise<void>;
};

const staticRouteResolver = (
  routes: ReadonlyMap<string, number>,
  switchRouting?: SwitchRoutingContext
): ProxyRouteResolver => ({
  getRoutes: () => routes,
  getSwitchRoutingForHost: () => switchRouting,
});

export const createProxyFetch = (options: {
  resolver: ProxyRouteResolver;
  targetFetch?: typeof fetch;
}): ((req: Request) => Promise<Response>) => {
  const targetFetch = options.targetFetch ?? fetch;
  return async (req: Request): Promise<Response> => {
    let routes = options.resolver.getRoutes();
    const rawHost = req.headers.get("host") ?? "";
    const host = rawHost.split(":")[0]?.toLowerCase() ?? "";
    let defaultPort = routes.get(host);
    if (defaultPort === undefined && options.resolver.refresh !== undefined) {
      await options.resolver.refresh();
      routes = options.resolver.getRoutes();
      defaultPort = routes.get(host);
    }
    if (defaultPort === undefined) {
      log.warning("No route for host {host}", { host });
      return new Response(`orchport: unknown host ${host}`, { status: 404 });
    }
    const u = new URL(req.url);
    const pathname = u.pathname;

    let targetPort = defaultPort;
    const sr = options.resolver.getSwitchRoutingForHost(host);
    if (sr !== undefined) {
      const entryName = sr.hostToEntry.get(host);
      const patterns = entryName
        ? sr.proxySwitchables.get(entryName)
        : undefined;
      if (entryName && patterns !== undefined && patterns.length > 0) {
        const matched = patterns.find((pattern) =>
          pathnameMatchesSwitchPattern(pathname, pattern)
        );
        if (matched !== undefined) {
          const key = buildSwitchRegistryKey(
            sr.sld,
            sr.tld,
            entryName,
            matched
          );
          const reg = await readSwitchRegistry();
          const slot = reg.entries[key];
          const targetWt = slot?.targetWorktree;
          if (targetWt !== undefined && targetWt !== sr.worktree) {
            const rp = await resolveSwitchTargetPort(targetWt, entryName);
            if (rp === null) {
              log.warning(
                "switch: no run state for worktree={wt} entry={entry} key={key}",
                { wt: targetWt, entry: entryName, key }
              );
              return new Response(
                `orchport: switch target not running (worktree ${targetWt}, entry ${entryName})`,
                { status: 502 }
              );
            }
            targetPort = rp;
            log.trace("proxy: path switch key={key} -> 127.0.0.1:{port}", {
              key,
              port: String(rp),
            });
          }
        }
      }
    }

    log.trace("proxy: {method} host={host} -> 127.0.0.1:{port}{path}", {
      method: req.method,
      host,
      port: String(targetPort),
      path: `${pathname}${u.search}`,
    });
    const target = `http://127.0.0.1:${targetPort}${pathname}${u.search}`;
    const headers = new Headers(req.headers);
    headers.set("host", `127.0.0.1:${targetPort}`);
    return targetFetch(target, {
      method: req.method,
      headers,
      body:
        req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      redirect: "manual",
    });
  };
};

export type StartReverseProxyOptions = {
  port: number;
  routes: ReadonlyMap<string, number>;
  tls?: ProxyTls;
  switchRouting?: SwitchRoutingContext;
  /** When set (daemon), overrides static `routes` / `switchRouting`. */
  routeResolver?: ProxyRouteResolver;
};

/**
 * Reverse proxy on `port`: HTTP, or HTTPS when `tls` is set.
 */
export const startReverseProxy = (
  options: StartReverseProxyOptions
): ProxyServer => {
  const fetch =
    options.routeResolver !== undefined
      ? createProxyFetch({ resolver: options.routeResolver })
      : createProxyFetch({
          resolver: staticRouteResolver(options.routes, options.switchRouting),
        });
  const server = Bun.serve({
    port: options.port,
    hostname: "127.0.0.1",
    fetch,
    ...(options.tls ? { tls: options.tls } : {}),
  });
  log.info(
    options.tls
      ? "Reverse proxy (HTTPS) listening on localhost:{port}"
      : "Reverse proxy listening on localhost:{port}",
    { port: String(options.port) }
  );
  return {
    stop: () => {
      server.stop();
    },
  };
};

/**
 * Best-effort extra listener (e.g. port 443).
 * Uses TLS when `tls` is set; otherwise plain HTTP.
 */
export const tryStartReverseProxyPort = (
  options: StartReverseProxyOptions
): TryExtraProxyResult => {
  try {
    const fetch =
      options.routeResolver !== undefined
        ? createProxyFetch({ resolver: options.routeResolver })
        : createProxyFetch({
            resolver: staticRouteResolver(
              options.routes,
              options.switchRouting
            ),
          });
    const server = Bun.serve({
      port: options.port,
      hostname: "127.0.0.1",
      fetch,
      ...(options.tls ? { tls: options.tls } : {}),
    });
    log.info(
      options.tls
        ? "Extra reverse proxy (HTTPS) listening on localhost:{port}"
        : "Extra reverse proxy listening on localhost:{port}",
      { port: String(options.port) }
    );
    return {
      ok: true,
      server: {
        stop: () => {
          server.stop();
        },
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warning("Could not bind proxy on port {port}: {msg}", {
      port: String(options.port),
      msg,
    });
    return { ok: false, errnoCode: errnoFromUnknown(err) };
  }
};
