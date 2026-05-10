import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RunStateFile } from "../../src/state/types.ts";
import { createTempStateDir, runOrchport } from "../helpers/index.ts";

describe("e2e kill / list", () => {
  test("list shows stale run; --stale removes state", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "orchport-kl-"));
    await mkdir(cwd, { recursive: true });
    const state = await createTempStateDir();
    await mkdir(join(state, "runs"), { recursive: true });
    const run: RunStateFile = {
      runId: "run-stale-1",
      rootPid: 999999999,
      command: ["sleep", "999"],
      workspace: "ws",
      worktree: "main",
      mode: "local-port",
      createdAt: new Date().toISOString(),
      configPath: null,
      proxies: {
        api: {
          port: 9001,
          url: "http://localhost:9001",
          localUrl: "http://localhost:9001",
        },
      },
    };
    await writeFile(
      join(state, "runs", `${run.runId}.json`),
      `${JSON.stringify(run, null, 2)}\n`
    );

    const list1 = runOrchport(["list", "--json"], {
      cwd,
      env: { ORCHPORT_STATE_DIR: state },
    });
    expect(list1.exitCode).toBe(0);
    const parsed1: unknown = JSON.parse(list1.stdout.toString());
    if (!Array.isArray(parsed1)) {
      throw new Error("list --json must return an array");
    }
    expect(parsed1.length).toBe(1);

    const killStale = runOrchport(["kill", "--stale"], {
      cwd,
      env: { ORCHPORT_STATE_DIR: state },
    });
    expect(killStale.exitCode).toBe(0);

    const list2 = runOrchport(["list", "--json"], {
      cwd,
      env: { ORCHPORT_STATE_DIR: state },
    });
    expect(list2.exitCode).toBe(0);
    const parsed2: unknown = JSON.parse(list2.stdout.toString());
    if (!Array.isArray(parsed2)) {
      throw new Error("list --json must return an array");
    }
    expect(parsed2.length).toBe(0);
  });

  test("list human output shows switches and stale guidance", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "orchport-kl-"));
    await mkdir(cwd, { recursive: true });
    const state = await createTempStateDir();
    await mkdir(join(state, "runs"), { recursive: true });
    const running: RunStateFile = {
      runId: "d36ae5c465f784d9",
      rootPid: process.pid,
      command: ["sleep", "999"],
      workspace: "myapp",
      worktree: "fix-xxx",
      mode: "local-proxy",
      createdAt: "2026-05-10T00:00:02.000Z",
      configPath: null,
      proxies: {
        api: {
          port: 8001,
          url: "https://api.fix-xxx.myapp.test",
          localUrl: "http://localhost:8001",
        },
        web: {
          port: 3001,
          url: "https://web.fix-xxx.myapp.test",
          localUrl: "http://localhost:3001",
        },
      },
      proxyPort: 43123,
    };
    const stopped: RunStateFile = {
      runId: "a91f2c7b10aaaaaa",
      rootPid: 999999999,
      command: ["sleep", "999"],
      workspace: "myapp",
      worktree: "feat-yyy",
      mode: "local-proxy",
      createdAt: "2026-05-10T00:00:01.000Z",
      configPath: null,
      proxies: {
        api: {
          port: 8999,
          url: "https://api.feat-yyy.myapp.test",
          localUrl: "http://localhost:8999",
        },
      },
      proxyPort: 43124,
    };
    await Promise.all(
      [running, stopped].map((run) =>
        writeFile(
          join(state, "runs", `${run.runId}.json`),
          `${JSON.stringify(run, null, 2)}\n`
        )
      )
    );
    await writeFile(
      join(state, "switches.json"),
      `${JSON.stringify(
        {
          version: 1,
          entries: {
            "myapp|.test|api|/auth/callback/*": {
              targetWorktree: "fix-xxx",
              updatedAt: "2026-05-10T00:00:03.000Z",
            },
          },
        },
        null,
        2
      )}\n`
    );

    const r = runOrchport(["list"], {
      cwd,
      env: { ORCHPORT_STATE_DIR: state },
    });
    expect(r.exitCode).toBe(0);
    const out = r.stdout.toString();
    expect(out).toContain("Switches");
    expect(out).not.toContain("Switc…");
    expect(out).toContain("Proxies");
    expect(out).not.toContain("Proxi…");
    expect(out).toContain("api");
    expect(out).toContain("web");
    expect(out).toContain("8001");
    expect(out).toContain("3001");
    expect(out).toContain("yes");
    expect(out).not.toContain("api:8001");
    expect(out).toContain("──────────");
    expect(out).not.toContain("----------");
    expect(out).not.toContain("┌");
    expect(out).toContain("│");
    expect(out).toContain("Switchable");
    expect(out).toContain(
      "https://api.myapp.test/auth/callback/* → http://localhost:8001/auth/callback/*"
    );
    expect(out).toContain("orchport kill --stale");
  });
});
