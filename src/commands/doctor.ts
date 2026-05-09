import { mkdir } from "node:fs/promises";

import { getLogger } from "@logtape/logtape";
import { define } from "gunshi";

import { loadConfig } from "../config/load.ts";
import { getStateDir } from "../state/xdg.ts";
import { OrchportError } from "../utils/errors.ts";
import { pickString } from "../utils/pick.ts";

const log = getLogger(["orchport", "doctor"]);

/** Ensures state dir is creatable and config loads; quick health check for CI or first-time setup. */
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
    const cfg = await loadConfig({
      cwd,
      config: pickString(ctx.values, "config"),
    });
    log.debug("doctor: config ok {path}", { path: cfg.configPath ?? "" });
    process.stdout.write(`orchport: ok (state ${state})\n`);
  },
});
