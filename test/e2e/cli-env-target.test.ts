import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
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

  test("env --plain without target prints sectioned output", async () => {
    const cwd = await writeConfig();
    const state = await createTempStateDir();
    const r = runOrchport(["env", "--plain"], {
      cwd,
      env: { ORCHPORT_STATE_DIR: state },
    });
    expect(r.exitCode).toBe(0);
    const out = r.stdout.toString();
    expect(out).toContain("[global]\n");
    expect(out).toContain("[api]\n");
    expect(out).toContain("[web]\n");
    expect(out).toContain("PORT=45691\n");
    expect(out).toContain("PORT=45692\n");
    const apiSection = out.slice(
      out.indexOf("[api]\n"),
      out.indexOf("\n[web]\n")
    );
    const webSection = out.slice(out.indexOf("[web]\n"));
    expect(apiSection).toContain("ORCHPORT_API_PORT=45691\n");
    expect(apiSection).not.toContain("ORCHPORT_WEB_PORT=");
    expect(webSection).toContain("ORCHPORT_WEB_PORT=45692\n");
    expect(webSection).not.toContain("ORCHPORT_API_PORT=");
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
