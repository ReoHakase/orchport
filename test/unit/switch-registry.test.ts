import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSwitchRegistryKey,
  claimSwitchSlotsForRun,
  readSwitchRegistry,
  setSwitchTargetsFromConfig,
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
        proxies: {
          api: {
            range: "auto",
            strategy: "deterministic",
            strict: false,
            switchables: ["/x/*"],
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
          proxies: {
            api: {
              range: "auto",
              strategy: "deterministic",
              strict: false,
              switchables: ["/x/*"],
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
      if (prev === undefined) {
        delete process.env.ORCHPORT_STATE_DIR;
      } else {
        process.env.ORCHPORT_STATE_DIR = prev;
      }
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
        proxies: {
          api: {
            range: "auto",
            strategy: "deterministic",
            strict: false,
            switchables: ["/y/*"],
          },
        },
        force: false,
      });
      await claimSwitchSlotsForRun({
        sld: "b",
        tld: ".localhost",
        worktree: "feat",
        runId: "r2",
        proxies: {
          api: {
            range: "auto",
            strategy: "deterministic",
            strict: false,
            switchables: ["/y/*"],
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
      if (prev === undefined) {
        delete process.env.ORCHPORT_STATE_DIR;
      } else {
        process.env.ORCHPORT_STATE_DIR = prev;
      }
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
      if (prev === undefined) {
        delete process.env.ORCHPORT_STATE_DIR;
      } else {
        process.env.ORCHPORT_STATE_DIR = prev;
      }
    }
  });

  test("corrupt switches.json is a structured parse error", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "orchport-sw-corrupt-"));
    const prev = process.env.ORCHPORT_STATE_DIR;
    process.env.ORCHPORT_STATE_DIR = stateDir;
    try {
      await writeFile(join(stateDir, "switches.json"), "{ nope", "utf8");
      await expect(readSwitchRegistry()).rejects.toThrow(OrchportError);
    } finally {
      if (prev === undefined) {
        delete process.env.ORCHPORT_STATE_DIR;
      } else {
        process.env.ORCHPORT_STATE_DIR = prev;
      }
    }
  });

  test("concurrent switch writes preserve all configured slots", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "orchport-sw-concurrent-"));
    const prev = process.env.ORCHPORT_STATE_DIR;
    process.env.ORCHPORT_STATE_DIR = stateDir;
    try {
      await Promise.all([
        setSwitchTargetsFromConfig({
          sld: "c",
          tld: ".localhost",
          targetWorktree: "one",
          proxies: {
            api: {
              range: "auto",
              strategy: "deterministic",
              strict: false,
              switchables: ["/api/*"],
            },
          },
        }),
        setSwitchTargetsFromConfig({
          sld: "c",
          tld: ".localhost",
          targetWorktree: "two",
          proxies: {
            web: {
              range: "auto",
              strategy: "deterministic",
              strict: false,
              switchables: ["/web/*"],
            },
          },
        }),
      ]);
      const reg = await readSwitchRegistry();
      expect(
        reg.entries[buildSwitchRegistryKey("c", ".localhost", "api", "/api/*")]
          ?.targetWorktree
      ).toBe("one");
      expect(
        reg.entries[buildSwitchRegistryKey("c", ".localhost", "web", "/web/*")]
          ?.targetWorktree
      ).toBe("two");
    } finally {
      if (prev === undefined) {
        delete process.env.ORCHPORT_STATE_DIR;
      } else {
        process.env.ORCHPORT_STATE_DIR = prev;
      }
    }
  });
});
