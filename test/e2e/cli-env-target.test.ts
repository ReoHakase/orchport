import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isRecord } from "../../src/utils/pick.ts";
import {
  createTempStateDir,
  runOrchport,
  writeFixtureConfig,
} from "../helpers/index.ts";

const writeConfig = async (): Promise<string> => {
  const cwd = await mkdtemp(join(tmpdir(), "orchport-env-target-"));
  await mkdir(cwd, { recursive: true });
  await writeFixtureConfig(
    cwd,
    "yaml",
    `mode: local-port
sld: env-target
worktree: main
proxies:
  api:
    range: [45691, 45691]
    strict: true
    env:
      PORT: "user-api"
      API_ONLY: "1"
  web:
    range: [45692, 45692]
    strict: true
    env:
      WEB_ONLY: "1"
env:
  PORT: "user-global"
  SHARED: "both"
`
  );
  return cwd;
};

const parseJson = (text: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new Error("expected JSON object");
  }
  return parsed;
};

describe("e2e env proxy target", () => {
  test("run <proxy> injects generated PORT", async () => {
    const cwd = await writeConfig();
    const state = await createTempStateDir();
    const r = runOrchport(["run", "api", "--", "sh", "-c", "printf %s $PORT"], {
      cwd,
      env: { ORCHPORT_STATE_DIR: state },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe("45691");
  });

  test("run <proxy> does not inject other proxy generated env", async () => {
    const cwd = await writeConfig();
    const state = await createTempStateDir();
    const r = runOrchport(
      [
        "run",
        "api",
        "--",
        "sh",
        "-c",
        'test -z "$ORCHPORT_WEB_PORT" && test "$PORT" = "$ORCHPORT_API_PORT"',
      ],
      {
        cwd,
        env: { ORCHPORT_STATE_DIR: state },
      }
    );
    expect(r.exitCode).toBe(0);
  });

  test("env <proxy> --plain prints target env with generated PORT", async () => {
    const cwd = await writeConfig();
    const state = await createTempStateDir();
    const r = runOrchport(["env", "api", "--plain"], {
      cwd,
      env: { ORCHPORT_STATE_DIR: state },
    });
    expect(r.exitCode).toBe(0);
    const out = r.stdout.toString();
    expect(out).toContain("PORT=45691\n");
    expect(out).toContain("ORCHPORT_API_PORT=45691\n");
    expect(out).toContain("API_ONLY=1\n");
    expect(out).toContain("SHARED=both\n");
    expect(out).not.toContain("ORCHPORT_WEB_PORT=");
    expect(out).not.toContain("ORCHPORT_WEB_URL=");
    expect(out).not.toContain("PORT=user-api");
    expect(out).not.toContain("PORT=user-global");
  });

  test("env --json prints nested global and per-proxy env", async () => {
    const cwd = await writeConfig();
    const state = await createTempStateDir();
    const r = runOrchport(["env", "--json"], {
      cwd,
      env: { ORCHPORT_STATE_DIR: state },
    });
    expect(r.exitCode).toBe(0);
    const parsed = parseJson(r.stdout.toString());
    expect(
      isRecord(parsed.global) ? parsed.global.PORT : undefined
    ).toBeUndefined();
    if (!isRecord(parsed.proxies)) {
      throw new Error("expected proxies object");
    }
    const api = parsed.proxies.api;
    const web = parsed.proxies.web;
    if (!isRecord(api) || !isRecord(web)) {
      throw new Error("expected api and web env objects");
    }
    expect(api.PORT).toBe("45691");
    expect(web.PORT).toBe("45692");
  });

  test("env --proxy on local-port config emits proxy public URLs", async () => {
    const cwd = await writeConfig();
    const state = await createTempStateDir();
    const r = runOrchport(["env", "--proxy", "--plain"], {
      cwd,
      env: { ORCHPORT_STATE_DIR: state },
    });
    expect(r.exitCode).toBe(0);
    const lines = Object.fromEntries(
      r.stdout
        .toString()
        .trim()
        .split("\n")
        .map((line) => {
          const eq = line.indexOf("=");
          return [line.slice(0, eq), line.slice(eq + 1)];
        })
    );
    expect(lines.ORCHPORT_MODE).toBe("local-proxy");
    expect(lines.ORCHPORT_PROXY_PORT).toBeDefined();
    expect(lines.ORCHPORT_API_URL).toBe(
      `http://api.env-target.localhost:${lines.ORCHPORT_PROXY_PORT}`
    );
    expect(lines.ORCHPORT_API_LOCAL_URL).toBe("http://localhost:45691");
  });

  test("env keeps working when state dir is unwritable and reports disabled reservations", async () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      return;
    }
    const cwd = await writeConfig();
    const state = await createTempStateDir();
    await chmod(state, 0o500);
    try {
      const r = runOrchport(["env", "--plain"], {
        cwd,
        env: { ORCHPORT_STATE_DIR: state },
      });
      expect(r.exitCode).toBe(0);
      expect(r.stdout.toString()).toContain(
        "ORCHPORT_PORT_RESERVATION=disabled\n"
      );
    } finally {
      await chmod(state, 0o700);
    }
  });

  test("env --plain without target prints a flat generated env stream", async () => {
    const cwd = await writeConfig();
    const state = await createTempStateDir();
    const r = runOrchport(["env", "--plain"], {
      cwd,
      env: { ORCHPORT_STATE_DIR: state },
    });
    expect(r.exitCode).toBe(0);
    const out = r.stdout.toString();
    expect(out).not.toContain("[global]\n");
    expect(out).not.toContain("[api]\n");
    expect(out).not.toContain("[web]\n");
    expect(out.split("\n")).not.toContain("PORT=");
    expect(out).toContain("ORCHPORT_API_PORT=45691\n");
    expect(out).toContain("ORCHPORT_WEB_PORT=45692\n");
    expect(out).toContain("SHARED=both\n");
  });

  test("env unknown proxy fails with available proxy hint", async () => {
    const cwd = await writeConfig();
    const state = await createTempStateDir();
    const r = runOrchport(["env", "unknown"], {
      cwd,
      env: { ORCHPORT_STATE_DIR: state },
    });
    expect(r.exitCode).not.toBe(0);
    const err = r.stderr.toString();
    expect(err).toContain('Unknown proxy "unknown"');
    expect(err).toContain("Use one of: api, web");
  });
});
