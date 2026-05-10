import { describe, expect, test } from "bun:test";

import { formatSwitchableRoutes } from "../../src/commands/switchable-output.ts";
import { buildSwitchRegistryKey } from "../../src/state/switch-registry.ts";
import type {
  RunStateFile,
  SwitchRegistryFile,
} from "../../src/state/types.ts";

const run = (worktree: string, port: number): RunStateFile => ({
  runId: `run-${worktree}`,
  rootPid: 123,
  command: ["bun", "dev"],
  workspace: "myapp",
  worktree,
  mode: "local-proxy",
  createdAt: `2026-05-10T00:00:0${port % 10}.000Z`,
  configPath: null,
  proxies: {
    api: {
      port,
      url: `https://api.${worktree}.myapp.test`,
      localUrl: `http://localhost:${port}`,
    },
  },
  proxyPort: 43123,
});

describe("formatSwitchableRoutes", () => {
  test("resolves target run state into incoming, local, and public URLs", () => {
    const key = buildSwitchRegistryKey(
      "myapp",
      ".test",
      "api",
      "/auth/callback/*"
    );
    const registry: SwitchRegistryFile = {
      version: 1,
      entries: {
        [key]: {
          targetWorktree: "fix-xxx",
          updatedAt: "2026-05-10T00:00:00.000Z",
        },
      },
    };
    const routes = formatSwitchableRoutes(registry, [run("fix-xxx", 8001)]);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.incomingUrl).toBe(
      "https://api.myapp.test/auth/callback/*"
    );
    expect(routes[0]?.localTargetUrl).toBe(
      "http://localhost:8001/auth/callback/*"
    );
    expect(routes[0]?.targetPublicUrl).toBe(
      "https://api.fix-xxx.myapp.test/auth/callback/*"
    );
    expect(routes[0]?.unresolved).toBe(false);
  });

  test("marks missing target run state as unresolved", () => {
    const key = buildSwitchRegistryKey(
      "myapp",
      ".test",
      "api",
      "/auth/callback/*"
    );
    const routes = formatSwitchableRoutes(
      {
        version: 1,
        entries: {
          [key]: {
            targetWorktree: "feature-auth",
            updatedAt: "2026-05-10T00:00:00.000Z",
          },
        },
      },
      []
    );
    expect(routes[0]?.unresolved).toBe(true);
    expect(routes[0]?.unresolvedReason).toContain("requests return 502");
  });
});
