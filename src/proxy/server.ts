/**
 * @module orchport/proxy/server
 * Local reverse proxy (Host header → 127.0.0.1:entryPort); optional TLS; optional path-based switch routing.
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

/** When set, paths matching `switchable` may proxy to another worktree's entry port (see switches.json). */
export type SwitchRoutingContext = {
  hostToEntry: ReadonlyMap<string, string>;
  entrySwitchable: ReadonlyMap<string, readonly string[]>;
  sld: string;
  tld: string;
  worktree: string;
};

const createProxyFetch =
  (routes: ReadonlyMap<string, number>, switchRouting?: SwitchRoutingContext) =>
  async (req: Request): Promise<Response> => {
    const rawHost = req.headers.get("host") ?? "";
    const host = rawHost.split(":")[0]?.toLowerCase() ?? "";
    const defaultPort = routes.get(host);
    if (defaultPort === undefined) {
      log.warning("No route for host {host}", { host });
      return new Response(`orchport: unknown host ${host}`, { status: 404 });
    }
    const u = new URL(req.url);
    const pathname = u.pathname;

    let targetPort = defaultPort;
    const sr = switchRouting;
    if (sr !== undefined) {
      const entryName = sr.hostToEntry.get(host);
      const patterns = entryName
        ? sr.entrySwitchable.get(entryName)
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
    return fetch(target, {
      method: req.method,
      headers,
      body:
        req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      redirect: "manual",
    });
  };

export type StartReverseProxyOptions = {
  port: number;
  routes: ReadonlyMap<string, number>;
  tls?: ProxyTls;
  switchRouting?: SwitchRoutingContext;
};

/**
 * Reverse proxy on `port`: HTTP, or HTTPS when `tls` is set.
 */
export const startReverseProxy = (
  options: StartReverseProxyOptions
): ProxyServer => {
  const fetch = createProxyFetch(options.routes, options.switchRouting);
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
 * Best-effort extra listener (e.g. port 443). Returns null if bind fails (EACCES, EADDRINUSE, etc.).
 * Uses TLS when `tls` is set; otherwise plain HTTP.
 */
export const tryStartReverseProxyPort = (
  options: StartReverseProxyOptions
): ProxyServer | null => {
  try {
    const fetch = createProxyFetch(options.routes, options.switchRouting);
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
      stop: () => {
        server.stop();
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warning("Could not bind proxy on port {port}: {msg}", {
      port: String(options.port),
      msg,
    });
    return null;
  }
};
