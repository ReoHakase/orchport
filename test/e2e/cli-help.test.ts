import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runOrchport } from "../helpers/index.ts";

const readPackageVersion = (): string => {
  const raw: unknown = JSON.parse(readFileSync("package.json", "utf8"));
  if (
    typeof raw === "object" &&
    raw !== null &&
    "version" in raw &&
    typeof raw.version === "string"
  ) {
    return raw.version;
  }
  throw new Error("package.json version must be a string");
};

describe("e2e help", () => {
  test("bare command prints root help", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "orchport-help-"));
    await mkdir(cwd, { recursive: true });
    const r = runOrchport([], { cwd });
    expect(r.exitCode).toBe(0);
    const out = r.stdout.toString();
    expect(out).toContain("Non-interactive port and env resolver");
    expect(out).toContain("orchport init");
    expect(out).toContain("--version");
  });

  test("root help keeps -v for verbose and --version long-only", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "orchport-help-"));
    await mkdir(cwd, { recursive: true });
    const r = runOrchport(["--help"], { cwd });
    expect(r.exitCode).toBe(0);
    const out = r.stdout.toString();
    expect(out.match(/-v, --verbose/g)?.length).toBe(1);
    expect(out).toContain("--version");
    expect(out).not.toContain("-v, --version");
    expect(out).toContain("--no-color");
    expect(out).toContain("Disable ANSI colors in log output");
  });

  test("run help shows kebab-case force-env", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "orchport-help-"));
    await mkdir(cwd, { recursive: true });
    const r = runOrchport(["run", "--help"], { cwd });
    expect(r.exitCode).toBe(0);
    const out = r.stdout.toString();
    expect(out).toContain("--force-env");
    expect(out).not.toContain("--forceEnv");
  });

  test("init help shows concrete format examples", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "orchport-help-"));
    await mkdir(cwd, { recursive: true });
    const r = runOrchport(["init", "--help"], { cwd });
    expect(r.exitCode).toBe(0);
    const out = r.stdout.toString();
    expect(out).toContain("yaml -> orchport.yaml");
    expect(out).toContain("json -> orchport.json");
    expect(out).toContain("ts -> orchport.config.ts");
    expect(out).toContain("orchport init --format json");
    expect(out).toContain("orchport init --format ts");
  });

  test("major options have visible descriptions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "orchport-help-"));
    await mkdir(cwd, { recursive: true });

    const list = runOrchport(["list", "--help"], { cwd }).stdout.toString();
    expect(list).toContain("--json");
    expect(list).toContain("Print recorded runs as JSON");
    expect(list).toContain("--worktree");
    expect(list).toContain("Filter runs by worktree slug");

    const kill = runOrchport(["kill", "--help"], { cwd }).stdout.toString();
    expect(kill).toContain("--all");
    expect(kill).toContain("Signal every recorded running root process");
    expect(kill).toContain("--run-id");
    expect(kill).toContain("Signal the run with this exact run id");
    expect(kill).toContain("--force");
    expect(kill).toContain(
      "Allow killing a process that was not recorded by orchport"
    );
    expect(kill).toContain("--signal");
    expect(kill).toContain("Signal to send");
  });

  test("--version prints the package version without using -v", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "orchport-help-"));
    await mkdir(cwd, { recursive: true });
    const packageVersion = readPackageVersion();
    const version = runOrchport(["--version"], { cwd });
    expect(version.exitCode).toBe(0);
    expect(version.stdout.toString().trim()).toBe(packageVersion);
    expect(version.stderr.toString()).toBe("");

    const verbose = runOrchport(["-v"], { cwd });
    expect(verbose.stdout.toString().trim()).not.toBe(packageVersion);
  });
});
