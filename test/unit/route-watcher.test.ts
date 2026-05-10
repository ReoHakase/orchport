import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ProxyRouteWatcher } from "../../src/proxy/route-watcher.ts";

describe("ProxyRouteWatcher", () => {
  test("merges routes and drops stale pid files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-rw-"));
    const stalePath = join(dir, "stale.json");
    await writeFile(
      stalePath,
      `${JSON.stringify(
        {
          version: 1,
          runId: "stale",
          pid: 999999999,
          routes: { "gone.localhost": 1111 },
          createdAt: new Date().toISOString(),
        },
        null,
        2
      )}\n`
    );
    const livePath = join(dir, "live.json");
    await writeFile(
      livePath,
      `${JSON.stringify(
        {
          version: 1,
          runId: "live",
          pid: process.pid,
          routes: { "api.demo.localhost": 8222 },
          createdAt: new Date().toISOString(),
        },
        null,
        2
      )}\n`
    );

    const w = new ProxyRouteWatcher(dir);
    await w.rebuild();
    const routes = w.getResolver().getRoutes();
    expect(routes.get("api.demo.localhost")).toBe(8222);
    expect(routes.has("gone.localhost")).toBe(false);
  });
});
