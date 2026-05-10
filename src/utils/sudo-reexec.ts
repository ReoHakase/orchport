/**
 * Re-exec the current CLI via `sudo -E` (privileged listener bind, same argv).
 * Also resolves bare `bun`/`node` on PATH and Bun embedded `/$bunfs/...` paths for child spawn.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

import { getLogger } from "@logtape/logtape";

const log = getLogger(["orchport", "sudo"]);

const embeddedOrchportCandidates = (): string[] => {
  const cwd = process.cwd();
  const out: string[] = [];
  const env = process.env.ORCHPORT_SUDO_ARGV0?.trim();
  if (env !== undefined && env !== "") {
    out.push(env);
  }
  out.push(join(cwd, "dist", "orchport"));
  return out;
};

/** Prefer `ORCHPORT_SUDO_ARGV0`, then `./dist/orchport` under cwd when Bun embeds the CLI under `/$bunfs/`. */
export const resolveEmbeddedOrchportPath = (): string | null => {
  for (const p of embeddedOrchportCandidates()) {
    if (p !== "" && existsSync(p)) {
      return resolve(p);
    }
  }
  return null;
};

/** Resolves argv[0] when it is a runtime name (`bun`) or relative path; returns null for unsupported embedded-only argv[0]. */
const resolveInterpreterPath = (argv0: string): string | null => {
  if (argv0.includes("bunfs")) {
    return null;
  }
  const absAttempt = isAbsolute(argv0)
    ? resolve(argv0)
    : resolve(process.cwd(), argv0);
  if (existsSync(absAttempt)) {
    return absAttempt;
  }
  const fromWhich =
    typeof Bun !== "undefined" && typeof Bun.which === "function"
      ? Bun.which(argv0)
      : null;
  if (fromWhich !== null && existsSync(fromWhich)) {
    log.trace("resolved argv[0] via PATH: {path}", { path: fromWhich });
    return fromWhich;
  }
  const rt = resolve(process.execPath);
  if (existsSync(rt) && basename(argv0) === basename(rt)) {
    log.trace(
      "argv[0] not found as file; using process.execPath for interpreter",
      {
        argv0,
        execPath: rt,
      }
    );
    return rt;
  }
  return null;
};

/**
 * Normal argv suitable for `spawn` / `sudo -E`:
 * - Bare `bun` → real interpreter path (`Bun.which`, then `process.execPath`).
 * - `bun /$bunfs/.../orchport` → `[./dist/orchport, …]` (standalone exec; no `bun` wrapper) when dist exists or `ORCHPORT_SUDO_ARGV0`.
 * - `/$bunfs/...` only as argv[0] → on-disk compiled binary path.
 */
export const normalizeProcessArgv = (): string[] => {
  const argv = [...process.argv];
  const a0 = argv[0];
  const a1 = argv[1];
  if (a0 === undefined || a0 === "") {
    return argv;
  }

  if (a1 !== undefined && a1.includes("bunfs")) {
    const disk = resolveEmbeddedOrchportPath();
    if (disk !== null) {
      // Bun `--compile` output is a native executable; invoking `bun ./dist/orchport`
      // can exit immediately or mis-handle detached spawn — exec the binary directly.
      return [disk, ...argv.slice(2)];
    }
    log.warning(
      "Cannot spawn embedded Bun CLI path argv[1]={argv1}: build `./dist/orchport` or set ORCHPORT_SUDO_ARGV0 to that file.",
      { argv1: a1 }
    );
    return argv;
  }

  if (a0.includes("bunfs")) {
    const disk = resolveEmbeddedOrchportPath();
    if (disk !== null) {
      return [disk, ...argv.slice(1)];
    }
    log.warning(
      "argv[0] is embedded ($bunfs); set ORCHPORT_SUDO_ARGV0 to the compiled orchport binary on disk.",
      { argv0: a0 }
    );
    return argv;
  }

  const interp = resolveInterpreterPath(a0);
  if (interp !== null && interp !== a0) {
    return [interp, ...argv.slice(1)];
  }
  return argv;
};

/**
 * Legacy helper: first executable for sudo when only argv[0] mattered.
 * Prefer {@link normalizeProcessArgv} for full command lines.
 */
export const resolveExecutableForSudo = (): string | null => {
  const override = process.env.ORCHPORT_SUDO_ARGV0?.trim();
  if (override !== undefined && override !== "") {
    if (existsSync(override)) {
      return resolve(override);
    }
    log.warning("ORCHPORT_SUDO_ARGV0 does not exist: {path}", {
      path: override,
    });
  }
  const norm = normalizeProcessArgv();
  const head = norm[0];
  if (head === undefined || head === "") {
    return null;
  }
  if (existsSync(head)) {
    return head;
  }
  return null;
};

/** Sets `{markerEnvVar}=1` in the child environment to avoid sudo loops. */
export const tryReexecWithSudo = (markerEnvVar: string): void => {
  if (process.env[markerEnvVar] === "1") {
    return;
  }
  const cmd = normalizeProcessArgv();
  if (cmd.length === 0 || cmd[0] === undefined || cmd[0] === "") {
    log.warning("cannot sudo re-exec: empty argv after normalization");
    return;
  }
  const env = { ...process.env, [markerEnvVar]: "1" };
  log.info("re-executing via sudo -E {cmd}", {
    cmd: cmd.join(" "),
  });
  const r = spawnSync("sudo", ["-E", ...cmd], {
    env,
    stdio: "inherit",
    cwd: process.cwd(),
  });
  process.exit(typeof r.status === "number" ? r.status : 1);
};
