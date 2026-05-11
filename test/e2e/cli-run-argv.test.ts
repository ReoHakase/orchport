import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTempStateDir,
  runOrchport,
  writeFixtureConfig,
} from "../helpers/index.ts";

const writeConfig = async (): Promise<string> => {
  const cwd = await mkdtemp(join(tmpdir(), "orchport-run-argv-"));
  await mkdir(cwd, { recursive: true });
  await writeFixtureConfig(
    cwd,
    "yaml",
    `mode: local-port
sld: argv-e2e
worktree: main
proxies:
  web: true
`
  );
  return cwd;
};

describe("e2e run child argv", () => {
  test("child --version is not intercepted by orchport", async () => {
    const cwd = await writeConfig();
    const state = await createTempStateDir();
    const r = runOrchport(
      ["run", "--", "sh", "-c", 'printf "%s" "$1"', "_", "--version"],
      { cwd, env: { ORCHPORT_STATE_DIR: state } }
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe("--version");
  });

  test("child --verbose is not treated as global verbose", async () => {
    const cwd = await writeConfig();
    const state = await createTempStateDir();
    const r = runOrchport(
      ["run", "--", "sh", "-c", 'printf "%s" "$1"', "_", "--verbose"],
      { cwd, env: { ORCHPORT_STATE_DIR: state } }
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe("--verbose");
    expect(r.stderr.toString()).not.toContain("full argv:");
  });

  test("literal child delimiter is preserved after orchport separator", async () => {
    const cwd = await writeConfig();
    const state = await createTempStateDir();
    const r = runOrchport(
      [
        "run",
        "--",
        "sh",
        "-c",
        'printf "%s|%s|%s" "$1" "$2" "$3"',
        "_",
        "child",
        "--",
        "--flag",
      ],
      { cwd, env: { ORCHPORT_STATE_DIR: state } }
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe("child|--|--flag");
  });

  test("quiet suppresses orchport advice on child failure", async () => {
    const cwd = await writeConfig();
    const state = await createTempStateDir();
    const r = runOrchport(["--quiet", "run", "--", "sh", "-c", "exit 7"], {
      cwd,
      env: { ORCHPORT_STATE_DIR: state },
    });
    expect(r.exitCode).toBe(7);
    expect(r.stderr.toString()).not.toContain("Next:");
    expect(r.stderr.toString()).not.toContain("inspect the child command");
  });
});
