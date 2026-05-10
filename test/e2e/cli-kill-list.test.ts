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
});
