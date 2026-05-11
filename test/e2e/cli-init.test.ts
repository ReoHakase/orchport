import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTempStateDir,
  runOrchport,
  writeFixtureConfig,
} from "../helpers/index.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const formats = ["yaml", "json", "ts"] as const;

const configName = (format: (typeof formats)[number]): string =>
  format === "ts"
    ? "orchport.config.ts"
    : format === "yaml"
      ? "orchport.yaml"
      : "orchport.json";

const linkLocalPackage = async (cwd: string): Promise<void> => {
  const nodeModules = join(cwd, "node_modules");
  await mkdir(nodeModules, { recursive: true });
  await symlink(repoRoot, join(nodeModules, "orchport"), "dir");
};

describe("e2e init", () => {
  test("defaults to TypeScript config", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "orchport-init-"));
    await mkdir(cwd, { recursive: true });
    await linkLocalPackage(cwd);
    const state = await createTempStateDir();
    const r = runOrchport(["init"], {
      cwd,
      env: { ORCHPORT_STATE_DIR: state },
    });
    expect(r.exitCode).toBe(0);
    const text = await readFile(join(cwd, "orchport.config.ts"), "utf8");
    expect(text).toContain('import { defineConfig } from "orchport";');
    expect(text).toContain("local-proxy");
  });

  test.each(formats)(
    "writes %s config matching the current schema",
    async (format) => {
      const cwd = await mkdtemp(join(tmpdir(), "orchport-init-"));
      await mkdir(cwd, { recursive: true });
      if (format === "ts") {
        await linkLocalPackage(cwd);
      }
      const state = await createTempStateDir();
      const r = runOrchport(["init", "--format", format], {
        cwd,
        env: { ORCHPORT_STATE_DIR: state },
      });
      expect(r.exitCode).toBe(0);
      const text = await readFile(join(cwd, configName(format)), "utf8");
      expect(text).toContain("my-app");
      expect(text).toContain("local-proxy");
      expect(text).toContain("APP_BASE_URL");
      expect(text).not.toContain("ORCHPORT_WEB_PORT");
      expect(text).not.toContain("ORCHPORT_API_PORT");

      const env = runOrchport(["env", "--json"], {
        cwd,
        env: { ORCHPORT_STATE_DIR: state },
      });
      expect(env.exitCode).toBe(0);
      const parsed: unknown = JSON.parse(env.stdout.toString());
      expect(parsed).toMatchObject({
        global: {
          ORCHPORT_SLD: "my-app",
          ORCHPORT_MODE: "local-proxy",
          APP_BASE_URL: expect.stringContaining("https://web."),
          NEXT_PUBLIC_API_BASE_URL: expect.stringContaining("https://api."),
        },
        proxies: {
          web: {},
          api: {},
        },
      });
    }
  );

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
