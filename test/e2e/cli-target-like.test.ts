import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  detectWorktreeName,
  resolveWorktreeHostPrefix,
} from "../../src/utils/git.ts";
import { isRecord } from "../../src/utils/pick.ts";

const parseEnvJson = (text: string): Record<string, string> => {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw)) {
    throw new Error("env --json must be an object");
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") {
      out[k] = v;
    }
  }
  return out;
};

const repoRoot = join(import.meta.dir, "..", "..");
const cli = join(repoRoot, "src", "index.ts");

const runOrchport = (
  args: string[],
  options: { cwd: string; env?: Record<string, string> }
) => {
  const env = { ...process.env, ...options.env, NO_COLOR: "1" };
  return Bun.spawnSync({
    cmd: ["bun", cli, ...args],
    cwd: options.cwd,
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
};

const formats = ["yaml", "json", "ts"] as const;

const fixtureDir = (format: (typeof formats)[number]): string =>
  join(import.meta.dir, "fixtures", `target-like-${format}`);

describe("e2e target-like fixture", () => {
  test.each(formats)(
    "env --json exposes consistent URLs for web and api (%s)",
    async (format) => {
      const fixture = fixtureDir(format);
      const state = await mkdtemp(join(tmpdir(), "orchport-e2e-"));
      await mkdir(state, { recursive: true });
      const r = runOrchport(["env", "--json"], {
        cwd: fixture,
        env: { ORCHPORT_STATE_DIR: state },
      });
      expect(r.exitCode).toBe(0);
      const text = r.stdout.toString().trim();
      const envJson = parseEnvJson(text);
      expect(envJson.ORCHPORT_SLD).toBe(envJson.ORCHPORT_WORKSPACE);
      if (format === "ts") {
        expect(envJson.ORCHPORT_TLD).toBe(".test");
        const ws = "myapp";
        const wt = detectWorktreeName(fixture);
        const pref = resolveWorktreeHostPrefix(wt, fixture);
        expect(envJson.ORCHPORT_WORKSPACE).toBe(ws);
        expect(envJson.ORCHPORT_WORKTREE).toBe(wt);
        expect(envJson.ORCHPORT_MODE).toBe("local-proxy");
        expect(envJson.ORCHPORT_PROXY_PORT).toBeDefined();
        expect(envJson.ORCHPORT_HTTPS_PROXY_PORT).toBe("443");
        const hostWeb = `web.${pref}${ws}.test`;
        const hostApi = `api.${pref}${ws}.test`;
        expect(envJson.ORCHPORT_WEB_URL).toBe(`https://${hostWeb}`);
        expect(envJson.NEXT_PUBLIC_API_BASE_URL).toBe(`https://${hostApi}`);
      } else {
        expect(envJson.ORCHPORT_TLD).toBe(".localhost");
        expect(envJson.ORCHPORT_WORKSPACE).toBe("enterprise-agentic-saas");
        expect(envJson.ORCHPORT_WORKTREE).toBe("feature-auth");
        expect(envJson.NEXT_PUBLIC_API_BASE_URL).toContain("api.feature-auth");
        expect(envJson.APP_BASE_URL).toContain("web.feature-auth");
      }
      expect(envJson.BETTER_AUTH_URL).toBe(envJson.API_PUBLIC_URL);
    }
  );

  test.each(formats)(
    "run passes ORCHPORT_* into child (%s)",
    async (format) => {
      const fixture = fixtureDir(format);
      const state = await mkdtemp(join(tmpdir(), "orchport-e2e-"));
      await mkdir(state, { recursive: true });
      const r = runOrchport(
        ["run", "--", "/bin/sh", "-c", 'printf %s "${ORCHPORT_WEB_URL:-}"'],
        { cwd: fixture, env: { ORCHPORT_STATE_DIR: state } }
      );
      expect(r.exitCode).toBe(0);
      const out = r.stdout.toString();
      if (format === "ts") {
        expect(out).toContain("https://");
      } else {
        expect(out).toContain("http://");
      }
    }
  );

  test.each([
    ["ORCHPORT", "1"],
    ["orchport", "1"],
  ] as const)(
    "nested marker skips resolution log line (%s=%s)",
    async (key, value) => {
      const fixture = fixtureDir("yaml");
      const state = await mkdtemp(join(tmpdir(), "orchport-e2e-"));
      await mkdir(state, { recursive: true });
      const r = runOrchport(["run", "echo", "x"], {
        cwd: fixture,
        env: { ORCHPORT_STATE_DIR: state, [key]: value },
      });
      expect(r.exitCode).toBe(0);
      expect(r.stderr.toString()).not.toContain("Starting");
    }
  );

  test("run injects ORCHPORT_DEV_TLS_CERT_FILE and NODE_EXTRA_CA_CERTS for tls dev (ts)", async () => {
    const fixture = fixtureDir("ts");
    const state = await mkdtemp(join(tmpdir(), "orchport-e2e-"));
    await mkdir(state, { recursive: true });
    const r = runOrchport(
      [
        "run",
        "--",
        "sh",
        "-c",
        [
          'test -f "$ORCHPORT_DEV_TLS_CERT_FILE"',
          'case "$ORCHPORT_DEV_TLS_CERT_FILE" in *cert.pem) ;; *) exit 2 ;; esac',
          'test "$ORCHPORT_DEV_TLS_CERT_FILE" = "$NODE_EXTRA_CA_CERTS"',
          'test "$NODE_EXTRA_CA_CERTS" = "$DENO_CERT"',
          "echo ok",
        ].join(" && "),
      ],
      { cwd: fixture, env: { ORCHPORT_STATE_DIR: state } }
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString().trim()).toBe("ok");
  });

  test("run does not override preset NODE_EXTRA_CA_CERTS or DENO_CERT (ts)", async () => {
    const fixture = fixtureDir("ts");
    const state = await mkdtemp(join(tmpdir(), "orchport-e2e-"));
    await mkdir(state, { recursive: true });
    const existingCa = join(state, "existing-ca.pem");
    const existingDeno = join(state, "existing-deno.pem");
    await Bun.write(existingCa, "dummy\n");
    await Bun.write(existingDeno, "dummy\n");

    const preset = {
      ORCHPORT_STATE_DIR: state,
      NODE_EXTRA_CA_CERTS: existingCa,
      DENO_CERT: existingDeno,
    };

    const rNode = runOrchport(
      ["run", "--", "printenv", "NODE_EXTRA_CA_CERTS"],
      {
        cwd: fixture,
        env: preset,
      }
    );
    expect(rNode.exitCode).toBe(0);
    expect(rNode.stdout.toString().trim()).toBe(existingCa);

    const rDeno = runOrchport(["run", "--", "printenv", "DENO_CERT"], {
      cwd: fixture,
      env: preset,
    });
    expect(rDeno.exitCode).toBe(0);
    expect(rDeno.stdout.toString().trim()).toBe(existingDeno);

    const rCert = runOrchport(
      ["run", "--", "printenv", "ORCHPORT_DEV_TLS_CERT_FILE"],
      { cwd: fixture, env: preset }
    );
    expect(rCert.exitCode).toBe(0);
    const injected = rCert.stdout.toString().trim();
    expect(injected).not.toBe(existingCa);
    expect(injected).toContain("cert.pem");

    const rOk = runOrchport(
      [
        "run",
        "--",
        "sh",
        "-c",
        'test -f "$ORCHPORT_DEV_TLS_CERT_FILE" && echo ok',
      ],
      { cwd: fixture, env: preset }
    );
    expect(rOk.exitCode).toBe(0);
    expect(rOk.stdout.toString().trim()).toBe("ok");
  });

  test("doctor exits 0", async () => {
    const fixture = fixtureDir("yaml");
    const state = await mkdtemp(join(tmpdir(), "orchport-e2e-"));
    await mkdir(state, { recursive: true });
    const r = runOrchport(["doctor"], {
      cwd: fixture,
      env: { ORCHPORT_STATE_DIR: state },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain("read ok, write ok");
  });
});
