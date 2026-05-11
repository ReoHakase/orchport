import { describe, expect, test } from "bun:test";

import type { ResolvedSession } from "../../src/core/resolve-session.ts";
import {
  patchBuiltinProxyUrlsToHttp,
  patchBuiltinProxyUrlsToHttpsMainPort,
  patchUserEnvMatchingEntryUrls,
} from "../../src/proxy/url-patch.ts";

const minimalSession = (): ResolvedSession => ({
  sld: "app",
  tld: ".localhost",
  worktree: "main",
  worktreeHostPrefix: "",
  mode: "local-proxy",
  proxies: {
    web: {
      name: "web",
      port: 3000,
      host: "localhost",
      url: "https://web.app.localhost",
      localUrl: "http://localhost:3000",
    },
  },
  proxyPort: 44_000,
  portReservation: "active",
  env: {},
  configPath: "/x/orchport.yaml",
});

describe("url-patch", () => {
  test("patchBuiltinProxyUrlsToHttp sets http URLs", () => {
    const session = minimalSession();
    const env: Record<string, string | undefined> = {};
    patchBuiltinProxyUrlsToHttp(env, session);
    expect(env.ORCHPORT_WEB_URL).toBe("http://web.app.localhost:44000");
  });

  test("patchUserEnvMatchingEntryUrls syncs user keys", () => {
    const session = minimalSession();
    const env: Record<string, string | undefined> = {
      APP: "https://web.app.localhost",
    };
    patchUserEnvMatchingEntryUrls(
      env,
      session,
      () => "https://web.app.localhost:9999"
    );
    expect(env.APP).toBe("https://web.app.localhost:9999");
  });

  test("patchBuiltinProxyUrlsToHttpsMainPort", () => {
    const session = minimalSession();
    const env: Record<string, string | undefined> = {};
    patchBuiltinProxyUrlsToHttpsMainPort(env, session, 43_001);
    expect(env.ORCHPORT_WEB_URL).toBe("https://web.app.localhost:43001");
  });
});
