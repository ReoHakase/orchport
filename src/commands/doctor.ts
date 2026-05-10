import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getLogger } from "@logtape/logtape";
import { define } from "gunshi";

import { formatCliFailLine, formatCliOkLine } from "../cli/format.ts";
import { loadConfig } from "../config/load.ts";
import { pidAlive, readProxyDaemonState } from "../state/proxy-daemon.ts";
import { getStateDir } from "../state/xdg.ts";
import { ErrorCode, OrchportError } from "../utils/errors.ts";
import { pickString } from "../utils/pick.ts";

const log = getLogger(["orchport", "doctor"]);

const PROBE_BYTES = Buffer.from("orchport-doctor-probe\n", "utf8");

/** Writes, reads back, and deletes a temp file under `state` to verify real read/write access. */
const probeStateDirReadWrite = async (state: string): Promise<void> => {
  const name = `.orchport-doctor-probe-${process.pid}-${randomBytes(8).toString("hex")}.tmp`;
  const probePath = join(state, name);
  try {
    await writeFile(probePath, PROBE_BYTES);
    const readBack = await readFile(probePath);
    if (!readBack.equals(PROBE_BYTES)) {
      throw new Error("probe read mismatch");
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new OrchportError(
      ErrorCode.DOCTOR_STATE,
      `State dir read/write check failed (${probePath}): ${detail}`,
      {
        hint: "Fix permissions on ORCHPORT_STATE_DIR / XDG state home, or choose a writable directory.",
        context: { path: probePath },
      }
    );
  } finally {
    await unlink(probePath).catch(() => {
      /* ENOENT or race: ignore */
    });
  }
};

/** Ensures state dir exists, read/write works, and config loads; quick health check for CI or first-time setup. */
export const doctorCommand = define({
  name: "doctor",
  description: "Check orchport installation and config",
  run: async (ctx) => {
    const cwd = ctx.env.cwd ?? process.cwd();
    const tty =
      process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
    log.debug("doctor: cwd={cwd}", { cwd });
    const state = getStateDir();
    log.debug("doctor: state dir {state}", { state });

    try {
      await mkdir(state, { recursive: true });
    } catch (e) {
      throw new OrchportError(
        ErrorCode.DOCTOR_STATE,
        `Cannot create state dir ${state}: ${e}`,
        {
          hint: "Ensure ORCHPORT_STATE_DIR points to a creatable path, or fix XDG_CONFIG_HOME permissions.",
          context: { path: state },
        }
      );
    }

    process.stdout.write("\n");
    process.stdout.write(
      tty ? "\x1b[1morchport doctor\x1b[0m\n\n" : "orchport doctor\n\n"
    );

    await probeStateDirReadWrite(state);
    process.stdout.write(
      formatCliOkLine("state", `${state} (read/write ok)`, { tty })
    );

    try {
      const cfg = await loadConfig({
        cwd,
        config: pickString(ctx.values, "config"),
      });
      process.stdout.write(
        formatCliOkLine("config", cfg.configPath ?? "(inline)", { tty })
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stdout.write(formatCliFailLine("config", msg, { tty }));
    }

    const oc = spawnSync("openssl", ["version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (oc.status === 0) {
      process.stdout.write(
        formatCliOkLine("openssl", oc.stdout?.trim() || "ok", { tty })
      );
    } else {
      process.stdout.write(
        formatCliFailLine(
          "openssl",
          "not found or failed (needed for dev TLS)",
          { tty }
        )
      );
    }

    const daemon = readProxyDaemonState();
    if (daemon === null) {
      process.stdout.write(
        formatCliFailLine(
          "proxy",
          "daemon not running (optional: sudo orchport proxy up)",
          { tty }
        )
      );
    } else if (pidAlive(daemon.pid)) {
      process.stdout.write(
        formatCliOkLine(
          "proxy",
          `daemon pid ${daemon.pid} main :${daemon.mainPort}`,
          { tty }
        )
      );
    } else {
      process.stdout.write(
        formatCliFailLine(
          "proxy",
          `stale daemon.json (pid ${daemon.pid} dead)`,
          { tty }
        )
      );
    }

    process.stdout.write("\n");
    log.debug("doctor: done");
  },
});
