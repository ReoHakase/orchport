import { randomBytes } from "node:crypto";

import { getLogger } from "@logtape/logtape";
import { define } from "gunshi";

import { loadConfig } from "../config/load.ts";
import { resolveSession } from "../core/resolve-session.ts";
import { pickBoolean, pickString } from "../utils/pick.ts";
import { writeEnvTable } from "./env-table.ts";

const log = getLogger(["orchport", "env"]);

const newRunId = (): string => randomBytes(8).toString("hex");

const shellQuote = (s: string): string => {
  if (!/[^\w@%+=:,./-]/i.test(s)) {
    return s;
  }
  return `'${s.replaceAll("'", `'\\''`)}'`;
};

/**
 * Print merged env: **default** is a [cli-table3](https://github.com/cli-table/cli-table3) table on a TTY; `KEY=value` when piped or with `--plain`. Use `--json`, `--shell`, or `--dotenv` for scripts.
 */
export const envCommand = define({
  name: "env",
  description: "Print resolved environment variables (no command run)",
  args: {
    proxy: {
      type: "boolean",
      description: "Allocate proxy port (local-proxy URLs)",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Print as JSON object",
      default: false,
    },
    shell: {
      type: "boolean",
      description: "Print export lines for sh",
      default: false,
    },
    dotenv: {
      type: "boolean",
      description: "Print KEY=value lines",
      default: false,
    },
    plain: {
      type: "boolean",
      description:
        "Print KEY=value lines even on a terminal (default is a colored table on TTY)",
      default: false,
    },
  },
  run: async (ctx) => {
    const cwd = ctx.env.cwd ?? process.cwd();
    const values = ctx.values;
    log.debug("env: resolving (cwd={cwd})", { cwd });
    log.debug(
      "env: flags json={json} shell={shell} dotenv={dotenv} plain={plain} proxyFlag={proxy}",
      {
        json: String(pickBoolean(values, "json") ?? false),
        shell: String(pickBoolean(values, "shell") ?? false),
        dotenv: String(pickBoolean(values, "dotenv") ?? false),
        plain: String(pickBoolean(values, "plain") ?? false),
        proxy: String(pickBoolean(values, "proxy") ?? false),
      }
    );
    const config = await loadConfig({
      cwd,
      config: pickString(values, "config"),
    });
    const withProxy =
      config.mode === "local-proxy" || (pickBoolean(values, "proxy") ?? false);
    log.debug("env: withProxy={withProxy} config.mode={mode}", {
      withProxy: String(withProxy),
      mode: config.mode ?? "local-port",
    });
    const sldCli = pickString(values, "sld");
    const session = await resolveSession({
      cwd,
      config,
      sldCli,
      tldCli: pickString(values, "tld"),
      worktreeCli: pickString(values, "worktree"),
      runId: newRunId(),
      withProxy,
    });
    log.debug("env: done runId={runId} keys={n} mode={mode} sld={sld}", {
      runId: session.env.ORCHPORT_RUN_ID ?? "",
      n: String(Object.keys(session.env).length),
      mode: session.mode,
      sld: session.sld,
    });
    log.trace("env: ORCHPORT_* keys {keys}", {
      keys: Object.keys(session.env)
        .filter((k) => k.startsWith("ORCHPORT"))
        .toSorted()
        .join(" "),
    });

    const jsonOut = pickBoolean(values, "json") ?? false;
    const shellOut = pickBoolean(values, "shell") ?? false;
    const dotenvOut = pickBoolean(values, "dotenv") ?? false;
    const plainOut = pickBoolean(values, "plain") ?? false;

    if (jsonOut) {
      process.stdout.write(`${JSON.stringify(session.env, null, 2)}\n`);
      return;
    }
    if (shellOut) {
      for (const [key, val] of Object.entries(session.env)) {
        process.stdout.write(`export ${key}=${shellQuote(val)}\n`);
      }
      return;
    }
    if (dotenvOut) {
      for (const [key, val] of Object.entries(session.env)) {
        process.stdout.write(`${key}=${val}\n`);
      }
      return;
    }
    const tty = process.stdout.isTTY === true;
    const useTable = tty && !plainOut;
    if (useTable) {
      const useColor = process.env.NO_COLOR === undefined;
      writeEnvTable(session.env, { useColor });
      return;
    }
    for (const [key, val] of Object.entries(session.env)) {
      process.stdout.write(`${key}=${val}\n`);
    }
  },
});
