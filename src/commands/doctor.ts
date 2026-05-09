import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getLogger } from "@logtape/logtape";
import { define } from "gunshi";

import { loadConfig } from "../config/load.ts";
import { getStateDir } from "../state/xdg.ts";
import { OrchportError } from "../utils/errors.ts";
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
      "DOCTOR_STATE",
      `State dir read/write check failed (${probePath}): ${detail}`
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
    log.debug("doctor: cwd={cwd}", { cwd });
    const state = getStateDir();
    log.debug("doctor: state dir {state}", { state });
    try {
      await mkdir(state, { recursive: true });
    } catch (e) {
      throw new OrchportError(
        "DOCTOR_STATE",
        `Cannot create state dir ${state}: ${e}`
      );
    }
    await probeStateDirReadWrite(state);
    const cfg = await loadConfig({
      cwd,
      config: pickString(ctx.values, "config"),
    });
    log.debug("doctor: config ok {path}", { path: cfg.configPath ?? "" });
    process.stdout.write(`orchport: ok (state ${state}, read ok, write ok)\n`);
  },
});
