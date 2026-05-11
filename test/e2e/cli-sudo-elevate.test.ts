import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  closeServer,
  createTempStateDir,
  holdTcpPort,
  runOrchport,
  writeFixtureConfig,
} from "../helpers/index.ts";

const writeConfig = async (): Promise<string> => {
  const cwd = await mkdtemp(join(tmpdir(), "orchport-sudo-"));
  await mkdir(cwd, { recursive: true });
  await writeFixtureConfig(
    cwd,
    "yaml",
    `mode: local-proxy
sld: sudo-e2e
worktree: main
proxy:
  tls: dev
proxies:
  web: true
`
  );
  return cwd;
};

const writeFakeSudo = async (dir: string, marker: string): Promise<string> => {
  const fakeBin = join(dir, "fakebin");
  await mkdir(fakeBin, { recursive: true });
  const sudo = join(fakeBin, "sudo");
  await writeFile(
    sudo,
    `#!/usr/bin/env sh
printf '%s\\n' "$*" > "${marker}"
exit 42
`,
    "utf8"
  );
  await chmod(sudo, 0o755);
  return fakeBin;
};

const tryHold443 = async (): Promise<Server | null> => {
  try {
    return await holdTcpPort(443);
  } catch {
    return null;
  }
};

describe("e2e sudo elevation intent", () => {
  test("run --elevate invokes sudo once when privileged extra listener cannot bind", async () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      return;
    }
    const cwd = await writeConfig();
    const state = await createTempStateDir();
    const marker = join(state, "sudo-marker.txt");
    const fakeBin = await writeFakeSudo(state, marker);
    const held = await tryHold443();
    try {
      const r = runOrchport(["run", "--elevate", "--", "true"], {
        cwd,
        env: {
          ORCHPORT_STATE_DIR: state,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      });
      expect(r.exitCode).toBe(42);
      expect(existsSync(marker)).toBe(true);
    } finally {
      if (held !== null) {
        await closeServer(held);
      }
    }
  });

  test("elevated marker prevents sudo re-exec loop", async () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      return;
    }
    const cwd = await writeConfig();
    const state = await createTempStateDir();
    const marker = join(state, "sudo-marker-loop.txt");
    const fakeBin = await writeFakeSudo(state, marker);
    const held = await tryHold443();
    try {
      const r = runOrchport(["run", "--elevate", "--", "true"], {
        cwd,
        env: {
          ORCHPORT_STATE_DIR: state,
          ORCHPORT_ELEVATED_RUN: "1",
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      });
      expect(r.exitCode).toBe(0);
      expect(existsSync(marker)).toBe(false);
    } finally {
      if (held !== null) {
        await closeServer(held);
      }
    }
  });
});
