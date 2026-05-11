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

  test("resolver refresh picks up a newly written route on demand", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-rw-refresh-"));
    const w = new ProxyRouteWatcher(dir);
    await w.rebuild();
    const resolver = w.getResolver();
    expect(resolver.getRoutes().has("web.demo.localhost")).toBe(false);
    await writeFile(
      join(dir, "live.json"),
      `${JSON.stringify(
        {
          version: 1,
          runId: "live",
          pid: process.pid,
          routes: { "web.demo.localhost": 8333 },
          createdAt: new Date().toISOString(),
        },
        null,
        2
      )}\n`
    );
    await resolver.refresh?.();
    expect(resolver.getRoutes().get("web.demo.localhost")).toBe(8333);
  });

  test("newer duplicate host registration wins deterministically", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-rw-dupe-"));
    await writeFile(
      join(dir, "b.json"),
      `${JSON.stringify(
        {
          version: 1,
          runId: "newer",
          pid: process.pid,
          routes: { "web.demo.localhost": 8555 },
          createdAt: "2026-01-01T00:00:01.000Z",
        },
        null,
        2
      )}\n`
    );
    await writeFile(
      join(dir, "a.json"),
      `${JSON.stringify(
        {
          version: 1,
          runId: "older",
          pid: process.pid,
          routes: { "web.demo.localhost": 8444 },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        null,
        2
      )}\n`
    );

    const w = new ProxyRouteWatcher(dir);
    await w.rebuild();
    expect(w.getResolver().getRoutes().get("web.demo.localhost")).toBe(8555);
  });
});
