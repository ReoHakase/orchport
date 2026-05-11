import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getLogger } from "@logtape/logtape";
import { define } from "gunshi";

import {
  bold,
  cliUseColor,
  formatCliFailLine,
  formatCliOkLine,
  formatNextLine,
  muted,
  statusIcon,
  type CliUiOptions,
} from "../cli/format.ts";
import { loadConfig } from "../config/load.ts";
import { readProxyDaemonState } from "../state/proxy-daemon.ts";
import { getStateDir } from "../state/xdg.ts";
import { ErrorCode, OrchportError } from "../utils/errors.ts";
import { pickBoolean, pickString } from "../utils/pick.ts";
import { pidAlive } from "../utils/process.ts";

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
    const tty = cliUseColor(process.stdout, {
      noColor: pickBoolean(ctx.values, "noColor") ?? false,
    });
    const ui: CliUiOptions = { color: tty };
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
    process.stdout.write(`${bold("orchport doctor", ui)}\n\n`);

    await probeStateDirReadWrite(state);
    process.stdout.write(
      formatCliOkLine("state", `${state} (read/write ok)`, { tty })
    );

    let failed = false;
    let needsOpenSsl = false;
    try {
      const cfg = await loadConfig({
        cwd,
        config: pickString(ctx.values, "config"),
      });
      needsOpenSsl =
        (cfg.mode ?? "local-port") === "local-proxy" &&
        cfg.proxy?.tls === "dev";
      process.stdout.write(
        formatCliOkLine("config", cfg.configPath ?? "(inline)", { tty })
      );
    } catch (e) {
      failed = true;
      const msg = e instanceof Error ? e.message : String(e);
      process.stdout.write(formatCliFailLine("config", msg, { tty }));
      process.stdout.write(
        formatNextLine("fix the config file and rerun `orchport doctor`.", ui)
      );
    }

    if (!needsOpenSsl) {
      process.stdout.write(
        formatCliOkLine("openssl", "not required by current config", { tty })
      );
    } else {
      const oc = spawnSync("openssl", ["version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (oc.status === 0) {
        process.stdout.write(
          formatCliOkLine("openssl", oc.stdout?.trim() || "ok", { tty })
        );
      } else {
        failed = true;
        process.stdout.write(
          formatCliFailLine(
            "openssl",
            "not found or failed (needed for dev TLS)",
            { tty }
          )
        );
        process.stdout.write(
          formatNextLine(
            "install OpenSSL or configure file-based TLS certificates.",
            ui
          )
        );
      }
    }

    const daemon = readProxyDaemonState();
    if (daemon === null) {
      process.stdout.write(
        `${statusIcon("stopped", ui)}  ${bold("proxy".padEnd(10, " "), ui)}  ${muted("daemon not running (optional)", ui)}\n`
      );
      process.stdout.write(
        formatNextLine(
          "run `orchport proxy up` only if you want a long-lived reverse proxy.",
          ui
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
      failed = true;
      process.stdout.write(
        formatCliFailLine(
          "proxy",
          `stale daemon.json (pid ${daemon.pid} dead)`,
          { tty }
        )
      );
      process.stdout.write(
        formatNextLine(
          "run `orchport proxy down` and then `orchport proxy up`.",
          ui
        )
      );
    }

    process.stdout.write("\n");
    if (failed) {
      process.exitCode = 1;
    }
    log.debug("doctor: done");
  },
});
