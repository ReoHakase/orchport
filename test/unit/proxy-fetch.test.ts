import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { normalizeSwitchPattern } from "../../src/proxy/path-match.ts";
import {
  createProxyFetch,
  type ProxyRouteResolver,
} from "../../src/proxy/server.ts";
import { buildSwitchRegistryKey } from "../../src/state/switch-registry.ts";
import { createTempStateDir } from "../helpers/index.ts";

const resolverFor = (
  routes: ReadonlyMap<string, number>,
  switchRouting?: ReturnType<ProxyRouteResolver["getSwitchRoutingForHost"]>
): ProxyRouteResolver => ({
  getRoutes: () => routes,
  getSwitchRoutingForHost: () => switchRouting,
});

describe("createProxyFetch", () => {
  test("unknown Host returns 404 without forwarding", async () => {
    const proxyFetch = createProxyFetch({
      resolver: resolverFor(new Map([["known.localhost", 5555]])),
      targetFetch: async () => {
        throw new Error("unexpected forward");
      },
    });

    const res = await proxyFetch(
      new Request("http://127.0.0.1/", {
        headers: { Host: "missing.localhost" },
      })
    );

    expect(res.status).toBe(404);
    expect(await res.text()).toContain("missing.localhost");
  });

  test("normalizes Host headers with ports before routing", async () => {
    let forwardedUrl = "";
    let forwardedHost = "";
    const proxyFetch = createProxyFetch({
      resolver: resolverFor(new Map([["api.localhost", 43210]])),
      targetFetch: async (input, init) => {
        forwardedUrl = String(input);
        forwardedHost = new Headers(init?.headers).get("host") ?? "";
        return new Response("ok");
      },
    });

    const res = await proxyFetch(
      new Request("http://127.0.0.1/path?q=1", {
        headers: { Host: "api.localhost:9999" },
      })
    );

    expect(res.status).toBe(200);
    expect(forwardedUrl).toBe("http://127.0.0.1:43210/path?q=1");
    expect(forwardedHost).toBe("127.0.0.1:43210");
  });

  test("switchable route with missing target returns 502 without forwarding", async () => {
    const state = await createTempStateDir();
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

      const proxyFetch = createProxyFetch({
        resolver: resolverFor(new Map([["web.sw.localhost", 43210]]), {
          hostToEntry: new Map([["web.sw.localhost", "web"]]),
          proxySwitchables: new Map([["web", [pattern]]]),
          sld: "sw",
          tld: ".localhost",
          worktree: "main",
        }),
        targetFetch: async () => {
          throw new Error("unexpected forward");
        },
      });

      const res = await proxyFetch(
        new Request("http://127.0.0.1/callback/x", {
          headers: { Host: "web.sw.localhost:9999" },
        })
      );

      expect(res.status).toBe(502);
    } finally {
      if (prevState === undefined) {
        delete process.env.ORCHPORT_STATE_DIR;
      } else {
        process.env.ORCHPORT_STATE_DIR = prevState;
      }
    }
  });
});
