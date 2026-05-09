import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSwitchRegistryKey,
  claimSwitchSlotsForRun,
  readSwitchRegistry,
} from "../../src/state/switch-registry.ts";
import { OrchportError } from "../../src/utils/errors.ts";

describe("switch registry", () => {
  test("buildSwitchRegistryKey is stable", () => {
    expect(
      buildSwitchRegistryKey("myapp", ".test", "api", "/auth/callback/*")
    ).toBe("myapp|.test|api|/auth/callback/*");
  });

  test("claimSwitchSlotsForRun conflicts without force", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "orchport-sw-"));
    const prev = process.env.ORCHPORT_STATE_DIR;
    process.env.ORCHPORT_STATE_DIR = stateDir;
    try {
      await claimSwitchSlotsForRun({
        sld: "a",
        tld: ".localhost",
        worktree: "main",
        runId: "r1",
        entries: {
          api: {
            range: "auto",
            strategy: "deterministic",
            strict: false,
            switchable: ["/x/*"],
          },
        },
        force: false,
      });
      await expect(
        claimSwitchSlotsForRun({
          sld: "a",
          tld: ".localhost",
          worktree: "other",
          runId: "r2",
          entries: {
            api: {
              range: "auto",
              strategy: "deterministic",
              strict: false,
              switchable: ["/x/*"],
            },
          },
          force: false,
        })
      ).rejects.toThrow(OrchportError);
      const reg = await readSwitchRegistry();
      expect(
        reg.entries[buildSwitchRegistryKey("a", ".localhost", "api", "/x/*")]
          ?.targetWorktree
      ).toBe("main");
    } finally {
      process.env.ORCHPORT_STATE_DIR = prev;
    }
  });

  test("claimSwitchSlotsForRun force overwrites", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "orchport-sw2-"));
    const prev = process.env.ORCHPORT_STATE_DIR;
    process.env.ORCHPORT_STATE_DIR = stateDir;
    try {
      await claimSwitchSlotsForRun({
        sld: "b",
        tld: ".localhost",
        worktree: "main",
        runId: "r1",
        entries: {
          api: {
            range: "auto",
            strategy: "deterministic",
            strict: false,
            switchable: ["/y/*"],
          },
        },
        force: false,
      });
      await claimSwitchSlotsForRun({
        sld: "b",
        tld: ".localhost",
        worktree: "feat",
        runId: "r2",
        entries: {
          api: {
            range: "auto",
            strategy: "deterministic",
            strict: false,
            switchable: ["/y/*"],
          },
        },
        force: true,
      });
      const reg = await readSwitchRegistry();
      expect(
        reg.entries[buildSwitchRegistryKey("b", ".localhost", "api", "/y/*")]
          ?.targetWorktree
      ).toBe("feat");
    } finally {
      process.env.ORCHPORT_STATE_DIR = prev;
    }
  });

  test("parseSwitchRegistry via read file roundtrip", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "orchport-sw3-"));
    const prev = process.env.ORCHPORT_STATE_DIR;
    process.env.ORCHPORT_STATE_DIR = stateDir;
    try {
      await writeFile(
        join(stateDir, "switches.json"),
        JSON.stringify({
          version: 1,
          entries: {
            k: { targetWorktree: "wt", updatedAt: "2020-01-01" },
          },
        }),
        "utf8"
      );
      const reg = await readSwitchRegistry();
      expect(reg.entries.k?.targetWorktree).toBe("wt");
    } finally {
      process.env.ORCHPORT_STATE_DIR = prev;
    }
  });
});
