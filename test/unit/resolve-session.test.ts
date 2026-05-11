import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../../src/config/load.ts";
import {
  buildEnvByProxy,
  resolveSession,
} from "../../src/core/resolve-session.ts";
import {
  closeServer,
  createTempStateDir,
  holdTcpPort,
  writeFixtureConfig,
} from "../helpers/index.ts";

const requireServerPort = (address: ReturnType<Server["address"]>): number => {
  if (
    typeof address !== "object" ||
    address === null ||
    typeof address.port !== "number"
  ) {
    throw new Error("expected TCP server address");
  }
  return address.port;
};

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

  test("proxy.port numeric value is the required main proxy port", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-rs-proxy-port-"));
    const held = await holdTcpPort(0);
    const port = requireServerPort(held.address());
    await closeServer(held);
    await writeFixtureConfig(
      dir,
      "yaml",
      `mode: local-port
sld: rs-proxy-port
worktree: main
proxy:
  port: ${port}
  tls: false
proxies:
  web: true
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
        runId: "rid-proxy-port",
        withProxy: true,
      });
      expect(session.proxyPort).toBe(port);
      expect(session.env.ORCHPORT_WEB_URL).toBe(
        `http://web.rs-proxy-port.localhost:${port}`
      );
    } finally {
      if (prev === undefined) {
        delete process.env.ORCHPORT_STATE_DIR;
      } else {
        process.env.ORCHPORT_STATE_DIR = prev;
      }
    }
  });

  test("proxy.port fails clearly when unavailable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-rs-proxy-port-busy-"));
    const held = await holdTcpPort(0);
    const port = requireServerPort(held.address());
    await writeFixtureConfig(
      dir,
      "yaml",
      `mode: local-port
sld: rs-proxy-port-busy
worktree: main
proxy:
  port: ${port}
  tls: false
proxies:
  web: true
`
    );
    const state = await createTempStateDir();
    const prev = process.env.ORCHPORT_STATE_DIR;
    process.env.ORCHPORT_STATE_DIR = state;
    try {
      const config = await loadConfig({ cwd: dir });
      await expect(
        resolveSession({
          cwd: dir,
          config,
          runId: "rid-proxy-port-busy",
          withProxy: true,
        })
      ).rejects.toThrow("Configured proxy port");
    } finally {
      await closeServer(held);
      if (prev === undefined) {
        delete process.env.ORCHPORT_STATE_DIR;
      } else {
        process.env.ORCHPORT_STATE_DIR = prev;
      }
    }
  });

  test("concurrent resolutions reserve distinct auto ports in one state dir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-rs-concurrent-"));
    await writeFixtureConfig(
      dir,
      "yaml",
      `mode: local-port
sld: rs-concurrent
worktree: main
portRange: [45801, 45803]
proxies:
  web: true
`
    );
    const state = await createTempStateDir();
    const prev = process.env.ORCHPORT_STATE_DIR;
    process.env.ORCHPORT_STATE_DIR = state;
    try {
      const config = await loadConfig({ cwd: dir });
      const [a, b] = await Promise.all([
        resolveSession({
          cwd: dir,
          config,
          runId: "rid-concurrent-a",
          withProxy: false,
        }),
        resolveSession({
          cwd: dir,
          config,
          runId: "rid-concurrent-b",
          withProxy: false,
        }),
      ]);
      expect(a.proxies.web.port).not.toBe(b.proxies.web.port);
      expect(a.proxies.web.port).toBeGreaterThanOrEqual(45801);
      expect(a.proxies.web.port).toBeLessThanOrEqual(45803);
      expect(b.proxies.web.port).toBeGreaterThanOrEqual(45801);
      expect(b.proxies.web.port).toBeLessThanOrEqual(45803);
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
