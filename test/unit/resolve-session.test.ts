import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../../src/config/load.ts";
import {
  buildEnvByProxy,
  resolveSession,
} from "../../src/core/resolve-session.ts";
import { createTempStateDir, writeFixtureConfig } from "../helpers/index.ts";

describe("resolveSession", () => {
  test("local-port allocates proxies and env keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-rs-"));
    await writeFixtureConfig(
      dir,
      "yaml",
      `mode: local-port
sld: rs-case
worktree: main
proxies:
  web: true
`
    );
    const config = await loadConfig({ cwd: dir });
    const session = await resolveSession({
      cwd: dir,
      config,
      runId: "rid",
      withProxy: false,
    });
    expect(session.mode).toBe("local-port");
    expect(session.proxies.web.port).toBeGreaterThanOrEqual(43100);
    expect(session.proxies.web.port).toBeLessThanOrEqual(43999);
    expect(session.env.ORCHPORT_WEB_URL).toContain(".rs-case.localhost:");
    expect(session.env.ORCHPORT_WORKSPACE).toBe("rs-case");
  });

  test("local-proxy allocates proxy port when config requests it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-rs-"));
    await writeFixtureConfig(
      dir,
      "yaml",
      `mode: local-proxy
sld: rs-proxy
worktree: main
proxy:
  tls: dev
  httpsPort: false
proxies:
  api: true
`
    );
    const state = await createTempStateDir();
    const prev = process.env.ORCHPORT_STATE_DIR;
    process.env.ORCHPORT_STATE_DIR = state;
    try {
      const config = await loadConfig({ cwd: dir });
      const session = await resolveSession({
        cwd: dir,
        config,
        runId: "rid2",
        withProxy: true,
      });
      expect(session.mode).toBe("local-proxy");
      expect(session.proxyPort).toBeDefined();
      expect(session.env.ORCHPORT_PROXY_PORT).toBe(
        String(session.proxyPort ?? "")
      );
      expect(session.env.ORCHPORT_API_URL).toMatch(/^https:\/\//);
    } finally {
      if (prev === undefined) {
        delete process.env.ORCHPORT_STATE_DIR;
      } else {
        process.env.ORCHPORT_STATE_DIR = prev;
      }
    }
  });

  test("buildEnvByProxy merges global env into each proxy and adds proxy-specific keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-rs-"));
    await writeFixtureConfig(
      dir,
      "yaml",
      `mode: local-port
sld: rs-multi
worktree: main
proxies:
  web:
    env:
      WEB_ONLY: "w"
  api:
    env:
      API_ONLY: "a"
env:
  SHARED: "both"
`
    );
    const config = await loadConfig({ cwd: dir });
    const session = await resolveSession({
      cwd: dir,
      config,
      runId: "rid3",
      withProxy: false,
    });
    const by = buildEnvByProxy(session, config);
    expect(by.web.SHARED).toBe("both");
    expect(by.api.SHARED).toBe("both");
    expect(by.web.WEB_ONLY).toBe("w");
    expect(by.api.WEB_ONLY).toBeUndefined();
    expect(by.api.API_ONLY).toBe("a");
    expect(by.web.API_ONLY).toBeUndefined();
    expect(by.web.ORCHPORT_WEB_URL).toBeDefined();
    expect(by.api.ORCHPORT_API_URL).toBeDefined();
    expect(by.api.ORCHPORT_WEB_URL).toBeUndefined();
    expect(by.web.ORCHPORT_API_URL).toBeUndefined();
  });

  test("run target env injects generated PORT and ignores user PORT", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-rs-"));
    await writeFixtureConfig(
      dir,
      "yaml",
      `mode: local-port
sld: rs-port
worktree: main
proxies:
  api:
    range: [45671, 45671]
    strict: true
    env:
      PORT: "user-api"
      API_ONLY: "a"
  web:
    range: [45672, 45672]
    strict: true
    env:
      PORT: "user-web"
env:
  PORT: "user-global"
  SHARED: "both"
`
    );
    const config = await loadConfig({ cwd: dir });
    const session = await resolveSession({
      cwd: dir,
      config,
      runId: "rid4",
      withProxy: false,
      runTarget: "api",
    });
    expect(session.env.PORT).toBe("45671");
    expect(session.env.ORCHPORT_API_PORT).toBe("45671");
    expect(session.env.ORCHPORT_WEB_PORT).toBeUndefined();
    expect(session.env.API_ONLY).toBe("a");
    expect(session.env.SHARED).toBe("both");
  });

  test("buildEnvByProxy injects distinct generated PORT values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-rs-"));
    await writeFixtureConfig(
      dir,
      "yaml",
      `mode: local-port
sld: rs-port-map
worktree: main
proxies:
  api:
    range: [45681, 45681]
    strict: true
  web:
    range: [45682, 45682]
    strict: true
env:
  PORT: "ignored"
`
    );
    const config = await loadConfig({ cwd: dir });
    const session = await resolveSession({
      cwd: dir,
      config,
      runId: "rid5",
      withProxy: false,
    });
    const by = buildEnvByProxy(session, config);
    expect(session.env.PORT).toBeUndefined();
    expect(session.env.ORCHPORT_API_PORT).toBe("45681");
    expect(session.env.ORCHPORT_WEB_PORT).toBe("45682");
    expect(by.api.PORT).toBe("45681");
    expect(by.web.PORT).toBe("45682");
    expect(by.api.ORCHPORT_API_PORT).toBe("45681");
    expect(by.api.ORCHPORT_WEB_PORT).toBeUndefined();
    expect(by.web.ORCHPORT_WEB_PORT).toBe("45682");
    expect(by.web.ORCHPORT_API_PORT).toBeUndefined();
  });
});
