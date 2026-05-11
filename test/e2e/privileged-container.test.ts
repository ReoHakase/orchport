import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isRecord } from "../../src/utils/pick.ts";
import {
  createTempStateDir,
  orchportCliCommand,
  runOrchport,
  writeFixtureConfig,
} from "../helpers/index.ts";

const enabled = (): boolean => process.env.ORCHPORT_PRIVILEGED_E2E === "1";

const isRoot = (): boolean =>
  typeof process.getuid === "function" && process.getuid() === 0;

const writeConfig = async (sld: string): Promise<string> => {
  const cwd = await mkdtemp(join(tmpdir(), "orchport-priv-"));
  await mkdir(cwd, { recursive: true });
  await writeFixtureConfig(
    cwd,
    "yaml",
    `mode: local-proxy
sld: ${sld}
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

describe("privileged container e2e", () => {
  test(
    "non-root restricted container invokes fake sudo for default 443",
    async () => {
      if (!enabled() || isRoot()) {
        return;
      }
      const cwd = await writeConfig("priv-nonroot");
      const state = await createTempStateDir();
      const marker = join(state, "sudo-marker.txt");
      const fakeBin = await writeFakeSudo(state, marker);
      const r = runOrchport(["run", "--elevate", "--", "true"], {
        cwd,
        env: {
          ORCHPORT_STATE_DIR: state,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      });
      expect(r.exitCode).toBe(42);
      expect(existsSync(marker)).toBe(true);
    },
    { timeout: 60_000 }
  );

  test(
    "root container daemon binds real 443 and child fetches through implicit HTTPS URL",
    async () => {
      if (!enabled() || !isRoot()) {
        return;
      }
      const cwd = await writeConfig("priv-root");
      const state = await createTempStateDir();
      const daemonPath = join(state, "proxy", "daemon.json");
      const proxyProc = Bun.spawn({
        cmd: [...orchportCliCommand(), "proxy", "up"],
        cwd,
        env: {
          ...process.env,
          ORCHPORT_STATE_DIR: state,
          NO_COLOR: "1",
        },
        stdout: "ignore",
        stderr: "ignore",
      });

      try {
        const deadline = Date.now() + 15_000;
        while (!existsSync(daemonPath)) {
          if (Date.now() > deadline) {
            proxyProc.kill("SIGKILL");
            throw new Error("daemon.json did not appear");
          }
          /* eslint-disable-next-line no-await-in-loop -- sequential poll delay */
          await new Promise((r) => setTimeout(r, 50));
        }
        const rawDaemon: unknown = JSON.parse(readFileSync(daemonPath, "utf8"));
        if (!isRecord(rawDaemon)) {
          throw new Error("invalid daemon.json");
        }
        expect(rawDaemon.httpsPort).toBe(443);

        const script = `
const port = Number(process.env.PORT);
const url = process.env.ORCHPORT_WEB_URL;
if (!Number.isSafeInteger(port) || url !== "https://web.priv-root.localhost") {
  console.error("unexpected env", { port, url });
  process.exit(2);
}
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: () => new Response("ok"),
});
try {
  const response = await fetch(url);
  const body = await response.text();
  if (body !== "ok") {
    console.error("unexpected body", body);
    process.exit(3);
  }
  console.log(body);
} finally {
  server.stop(true);
}
`;
        const runChild = runOrchport(
          ["run", "web", "--", "bun", "-e", script],
          {
            cwd,
            env: { ORCHPORT_STATE_DIR: state },
          }
        );
        expect(runChild.exitCode).toBe(0);
        expect(runChild.stdout.toString().trim()).toBe("ok");

        const down = runOrchport(["proxy", "down"], {
          cwd,
          env: { ORCHPORT_STATE_DIR: state },
        });
        expect(down.exitCode).toBe(0);
        await Promise.race([
          proxyProc.exited,
          new Promise<number>((_, reject) =>
            setTimeout(() => reject(new Error("proxy exit timeout")), 10_000)
          ),
        ]);
      } finally {
        proxyProc.kill("SIGKILL");
      }
    },
    { timeout: 60_000 }
  );
});
