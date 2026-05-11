import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTempStateDir,
  runOrchport,
  writeFixtureConfig,
} from "../helpers/index.ts";

describe("e2e TLS proxy fetch", () => {
  test(
    "child can fetch its ORCHPORT_*_URL through dev TLS using injected CA env",
    async () => {
      const cwd = await mkdtemp(join(tmpdir(), "orchport-tls-fetch-"));
      await mkdir(cwd, { recursive: true });
      await writeFixtureConfig(
        cwd,
        "yaml",
        `mode: local-proxy
sld: tls-fetch
worktree: main
proxy:
  tls: dev
  httpsPort: false
proxies:
  web: true
`
      );
      const state = await createTempStateDir();
      const script = `
const port = Number(process.env.PORT);
const url = process.env.ORCHPORT_WEB_URL;
if (!Number.isSafeInteger(port) || !url) {
  console.error("missing port or url");
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
      const r = runOrchport(["run", "web", "--", "bun", "-e", script], {
        cwd,
        env: { ORCHPORT_STATE_DIR: state },
      });
      expect(r.exitCode).toBe(0);
      expect(r.stdout.toString().trim()).toBe("ok");
    },
    { timeout: 30_000 }
  );
});
