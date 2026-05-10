/**
 * Shared helpers for CLI integration tests.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

export const orchportCliEntry = (): string => join(repoRoot, "src", "index.ts");

/** Fresh empty state directory under the OS temp dir. */
export const createTempStateDir = async (): Promise<string> => {
  const d = await mkdtemp(join(tmpdir(), "orchport-test-"));
  await mkdir(d, { recursive: true });
  return d;
};

/** Writes an orchport config file (`orchport.yaml` / `.json` / `.config.ts`) under `dir`. */
export const writeFixtureConfig = async (
  dir: string,
  format: "yaml" | "json" | "ts",
  content: string
): Promise<void> => {
  await mkdir(dir, { recursive: true });
  const name =
    format === "ts"
      ? "orchport.config.ts"
      : format === "yaml"
        ? "orchport.yaml"
        : "orchport.json";
  await writeFile(join(dir, name), content, "utf8");
};

export const runOrchport = (
  args: string[],
  options: { cwd: string; env?: Record<string, string> }
): ReturnType<typeof Bun.spawnSync> => {
  const env = { ...process.env, ...options.env, NO_COLOR: "1" };
  return Bun.spawnSync({
    cmd: ["bun", orchportCliEntry(), ...args],
    cwd: options.cwd,
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
};
