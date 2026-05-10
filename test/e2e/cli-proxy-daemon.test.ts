import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isRecord } from "../../src/utils/pick.ts";
import { orchportCliEntry } from "../helpers/index.ts";

describe("e2e proxy daemon", () => {
  test(
    "proxy up → run inherits daemon proxy port → proxy down",
    async () => {
      const projectDir = await mkdtemp(join(tmpdir(), "orchport-pd-"));
      await mkdir(projectDir, { recursive: true });
      const stateDir = await mkdtemp(join(tmpdir(), "orchport-pd-state-"));
      await mkdir(stateDir, { recursive: true });

      const yaml = `mode: local-proxy
sld: daemon-e2e
worktree: main
proxy:
  tls: dev
  httpsPort: false
proxies:
  api: true
`;
      await Bun.write(join(projectDir, "orchport.yaml"), yaml);

      const cli = orchportCliEntry();
      const proxyProc = Bun.spawn({
        cmd: ["bun", cli, "proxy", "up"],
        cwd: projectDir,
        env: {
          ...process.env,
          ORCHPORT_STATE_DIR: stateDir,
          NO_COLOR: "1",
        },
        stdout: "ignore",
        stderr: "ignore",
      });

      const daemonPath = join(stateDir, "proxy", "daemon.json");
      const deadline = Date.now() + 15_000;
      /* Poll until the daemon writes state (startup + TLS can take a moment). */
      while (!existsSync(daemonPath)) {
        if (Date.now() > deadline) {
          proxyProc.kill("SIGKILL");
          throw new Error("daemon.json did not appear");
        }
        /* eslint-disable-next-line no-await-in-loop -- sequential poll delay */
        await new Promise((r) => setTimeout(r, 50));
      }
      const rawDaemon: unknown = JSON.parse(readFileSync(daemonPath, "utf8"));
      if (!isRecord(rawDaemon) || typeof rawDaemon.mainPort !== "number") {
        proxyProc.kill("SIGKILL");
        throw new Error("invalid daemon.json");
      }
      const daemon = { mainPort: rawDaemon.mainPort };

      const runChild = Bun.spawnSync({
        cmd: [
          "bun",
          cli,
          "run",
          "--",
          "bun",
          "-e",
          "console.log(process.env.ORCHPORT_PROXY_PORT || '')",
        ],
        cwd: projectDir,
        env: {
          ...process.env,
          ORCHPORT_STATE_DIR: stateDir,
          NO_COLOR: "1",
        },
        stderr: "pipe",
        stdout: "pipe",
      });
      expect(runChild.exitCode).toBe(0);
      expect(runChild.stdout.toString().trim()).toBe(String(daemon.mainPort));

      const down = Bun.spawnSync({
        cmd: ["bun", cli, "proxy", "down"],
        cwd: projectDir,
        env: {
          ...process.env,
          ORCHPORT_STATE_DIR: stateDir,
          NO_COLOR: "1",
        },
        stderr: "pipe",
        stdout: "pipe",
      });
      expect(down.exitCode).toBe(0);

      await Promise.race([
        proxyProc.exited,
        new Promise<number>((_, reject) =>
          setTimeout(() => reject(new Error("proxy exit timeout")), 10_000)
        ),
      ]);
      expect(existsSync(daemonPath)).toBe(false);
    },
    { timeout: 60_000 }
  );
});
