/**
 * Shared helpers for CLI integration tests.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve as resolvePath } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

export const orchportCliEntry = (): string => join(repoRoot, "src", "index.ts");

export const orchportCliCommand = (): string[] => {
  const bin = process.env.ORCHPORT_E2E_BIN?.trim();
  if (bin !== undefined && bin !== "") {
    return [isAbsolute(bin) ? bin : resolvePath(repoRoot, bin)];
  }
  return ["bun", orchportCliEntry()];
};

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
    cmd: [...orchportCliCommand(), ...args],
    cwd: options.cwd,
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
};

export const holdTcpPort = async (
  port: number,
  host = "127.0.0.1"
): Promise<Server> =>
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });

export const closeServer = async (server: Server): Promise<void> =>
  await new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
