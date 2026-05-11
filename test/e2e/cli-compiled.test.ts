import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  closeServer,
  createTempStateDir,
  holdTcpPort,
  runOrchport,
  writeFixtureConfig,
} from "../helpers/index.ts";

const compiledBin = (): string | null => {
  const bin = process.env.ORCHPORT_E2E_BIN?.trim();
  return bin !== undefined && bin !== "" ? resolve(bin) : null;
};

const writeConfig = async (): Promise<string> => {
  const cwd = await mkdtemp(join(tmpdir(), "orchport-compiled-"));
  await mkdir(cwd, { recursive: true });
  await writeFixtureConfig(
    cwd,
    "yaml",
    `mode: local-proxy
sld: compiled-e2e
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

describe("compiled binary e2e subset", () => {
  test("compiled --version matches package.json", () => {
    const bin = compiledBin();
    if (bin === null) {
      return;
    }
    const raw: unknown = JSON.parse(readFileSync("package.json", "utf8"));
    if (
      typeof raw !== "object" ||
      raw === null ||
      !("version" in raw) ||
      typeof raw.version !== "string"
    ) {
      throw new Error("package version missing");
    }
    const r = runOrchport(["--version"], { cwd: process.cwd() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString().trim()).toBe(raw.version);
  });

  test("compiled sudo re-exec uses ORCHPORT_SUDO_ARGV0 and avoids bunfs argv", async () => {
    const bin = compiledBin();
    if (
      bin === null ||
      (typeof process.getuid === "function" && process.getuid() === 0)
    ) {
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
          ORCHPORT_SUDO_ARGV0: bin,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      });
      expect(r.exitCode).toBe(42);
      expect(existsSync(marker)).toBe(true);
      const sudoArgs = readFileSync(marker, "utf8");
      expect(sudoArgs).toContain(bin);
      expect(sudoArgs).not.toContain("bunfs");
    } finally {
      if (held !== null) {
        await closeServer(held);
      }
    }
  });
});
