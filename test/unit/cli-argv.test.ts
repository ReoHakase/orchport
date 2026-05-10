import { describe, expect, test } from "bun:test";

import { normalizeGlobalOptionArgv } from "../../src/cli-argv.ts";

describe("normalizeGlobalOptionArgv", () => {
  test("merges --config and path before subcommand", () => {
    expect(
      normalizeGlobalOptionArgv([
        "--config",
        "test/e2e/fixtures/target-like-ts/orchport.config.ts",
        "env",
      ])
    ).toEqual([
      "--config=test/e2e/fixtures/target-like-ts/orchport.config.ts",
      "env",
    ]);
  });

  test("leaves --config=path unchanged", () => {
    expect(normalizeGlobalOptionArgv(["--config=foo.yaml", "env"])).toEqual([
      "--config=foo.yaml",
      "env",
    ]);
  });

  test("does not merge when value is another flag", () => {
    expect(normalizeGlobalOptionArgv(["--config", "--verbose", "env"])).toEqual(
      ["--config", "--verbose", "env"]
    );
  });

  test("does not merge --config after run (child / wrapped tool)", () => {
    expect(
      normalizeGlobalOptionArgv(["run", "myapp", "--config", "child.json"])
    ).toEqual(["run", "myapp", "--config", "child.json"]);
  });

  test("does not merge globals between run and -- (pass-through to child)", () => {
    expect(
      normalizeGlobalOptionArgv([
        "run",
        "--config",
        "c.yaml",
        "--",
        "sh",
        "-c",
        "echo",
      ])
    ).toEqual(["run", "--config", "c.yaml", "--", "sh", "-c", "echo"]);
  });

  test("merges globals before run when using -- separator", () => {
    expect(
      normalizeGlobalOptionArgv([
        "--config",
        "g.yaml",
        "run",
        "--",
        "sh",
        "--config",
        "inner",
      ])
    ).toEqual(["--config=g.yaml", "run", "--", "sh", "--config", "inner"]);
  });

  test("merges tld, sld, and worktree before subcommand", () => {
    expect(
      normalizeGlobalOptionArgv([
        "--tld",
        ".test",
        "--sld",
        "w",
        "--worktree",
        "t",
        "doctor",
      ])
    ).toEqual(["--tld=.test", "--sld=w", "--worktree=t", "doctor"]);
  });

  test("merges sld before subcommand", () => {
    expect(normalizeGlobalOptionArgv(["--sld", "myapp", "env"])).toEqual([
      "--sld=myapp",
      "env",
    ]);
  });

  test("normalizes global -v to --verbose before Gunshi sees built-in version", () => {
    expect(normalizeGlobalOptionArgv(["-v", "env"])).toEqual([
      "--verbose",
      "env",
    ]);
  });
});
