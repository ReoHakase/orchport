import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTempStateDir,
  runOrchport,
  writeFixtureConfig,
} from "../helpers/index.ts";

describe("e2e init", () => {
  test("writes orchport.yaml with starter keys", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "orchport-init-"));
    await mkdir(cwd, { recursive: true });
    const state = await createTempStateDir();
    const r = runOrchport(["init", "--format", "yaml"], {
      cwd,
      env: { ORCHPORT_STATE_DIR: state },
    });
    expect(r.exitCode).toBe(0);
    const text = await readFile(join(cwd, "orchport.yaml"), "utf8");
    expect(text).toContain("sld: my-app");
    expect(text).toContain("proxies:");
  });

  test("refuses overwrite without --force", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "orchport-init-"));
    await writeFixtureConfig(
      cwd,
      "yaml",
      `mode: local-port
sld: existing
proxies:
  web: true
`
    );
    const state = await createTempStateDir();
    const r = runOrchport(["init", "--format", "yaml"], {
      cwd,
      env: { ORCHPORT_STATE_DIR: state },
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toString()).toMatch(/already exists/i);
  });

  test("--force replaces config", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "orchport-init-"));
    await writeFixtureConfig(
      cwd,
      "yaml",
      `mode: local-port
sld: old
proxies:
  web: true
`
    );
    const state = await createTempStateDir();
    const r = runOrchport(["init", "--format", "yaml", "--force"], {
      cwd,
      env: { ORCHPORT_STATE_DIR: state },
    });
    expect(r.exitCode).toBe(0);
    const text = await readFile(join(cwd, "orchport.yaml"), "utf8");
    expect(text).toContain("sld: my-app");
    expect(text).not.toContain("sld: old");
  });
});
