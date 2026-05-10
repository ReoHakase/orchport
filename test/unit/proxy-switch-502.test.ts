import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pickPortInRange } from "../../src/ports/allocate.ts";
import { normalizeSwitchPattern } from "../../src/proxy/path-match.ts";
import { ProxyRouteWatcher } from "../../src/proxy/route-watcher.ts";
import { startReverseProxy } from "../../src/proxy/server.ts";
import { buildSwitchRegistryKey } from "../../src/state/switch-registry.ts";

describe("proxy switch routing", () => {
  test("returns 502 when switch target worktree has no run state", async () => {
    const state = await mkdtemp(join(tmpdir(), "orchport-sw502-"));
    const prevState = process.env.ORCHPORT_STATE_DIR;
    process.env.ORCHPORT_STATE_DIR = state;
    try {
      await mkdir(join(state, "runs"), { recursive: true });

      const pattern = normalizeSwitchPattern("/callback/*");
      const key = buildSwitchRegistryKey("sw", ".localhost", "web", pattern);
      await writeFile(
        join(state, "switches.json"),
        `${JSON.stringify(
          {
            version: 1,
            entries: {
              [key]: {
                targetWorktree: "other",
                updatedAt: new Date().toISOString(),
              },
            },
          },
          null,
          2
        )}\n`
      );

      const routesDir = join(state, "proxy", "routes");
      await mkdir(routesDir, { recursive: true });

      const host = "web.sw.localhost";
      const backendPort = await pickPortInRange({
        sld: "sw",
        worktree: "main",
        entryName: "be",
        min: 43200,
        max: 43299,
        avoid: new Set(),
      });

      const backend = Bun.serve({
        port: backendPort,
        hostname: "127.0.0.1",
        fetch: () => new Response("ok"),
      });

      await writeFile(
        join(routesDir, "reg.json"),
        `${JSON.stringify(
          {
            version: 1,
            runId: "r1",
            pid: process.pid,
            routes: { [host]: backendPort },
            switchRouting: {
              hostToEntry: { [host]: "web" },
              proxySwitchables: { web: [pattern] },
              sld: "sw",
              tld: ".localhost",
              worktree: "main",
            },
            createdAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`
      );

      const watcher = new ProxyRouteWatcher(routesDir);
      await watcher.rebuild();

      const proxyPort = await pickPortInRange({
        sld: "sw",
        worktree: "main",
        entryName: "px",
        min: 43200,
        max: 43299,
        avoid: new Set([backendPort]),
      });

      const proxy = startReverseProxy({
        port: proxyPort,
        routes: new Map(),
        routeResolver: watcher.getResolver(),
      });

      try {
        const res = await fetch(`http://127.0.0.1:${proxyPort}/callback/x`, {
          headers: { Host: `${host}:${proxyPort}` },
        });
        expect(res.status).toBe(502);
      } finally {
        proxy.stop();
        backend.stop();
      }
    } finally {
      if (prevState === undefined) {
        delete process.env.ORCHPORT_STATE_DIR;
      } else {
        process.env.ORCHPORT_STATE_DIR = prevState;
      }
    }
  });
});
