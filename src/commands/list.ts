import { getLogger } from "@logtape/logtape";
import { define } from "gunshi";
import { getBorderCharacters, table } from "table";

import { listRunStates } from "../state/store.ts";
import { pickBoolean, pickString } from "../utils/pick.ts";

const log = getLogger(["orchport", "list"]);

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const termWidth = (): number => {
  const c = process.stdout.columns;
  return typeof c === "number" && c > 48 ? c : 100;
};

/** Reads persisted run state from disk; `--json` or human-readable table. Volatile runs (no state file) do not appear. */
export const listCommand = define({
  name: "list",
  description: "List recorded orchport runs",
  args: {
    json: {
      type: "boolean",
      default: false,
    },
    stale: {
      type: "boolean",
      description: "Only show runs whose root PID is gone",
      default: false,
    },
    sld: {
      type: "string",
      description: "Filter runs by SLD (ORCHPORT_SLD / stored workspace label)",
    },
    worktree: { type: "string" },
  },
  run: async (ctx) => {
    log.debug("list: loading run states");
    let rows = await listRunStates();
    const w = pickString(ctx.values, "sld");
    const wt = pickString(ctx.values, "worktree");
    if (w) {
      rows = rows.filter((r) => r.workspace === w);
    }
    if (wt) {
      rows = rows.filter((r) => r.worktree === wt);
    }

    const json = pickBoolean(ctx.values, "json") === true;
    const staleOnly = pickBoolean(ctx.values, "stale") === true;

    const mapped = rows.map((r) =>
      Object.assign({}, r, { running: pidAlive(r.rootPid) })
    );

    const filtered = staleOnly ? mapped.filter((r) => !r.running) : mapped;
    log.debug("list: showing {n} run(s)", { n: String(filtered.length) });

    if (json) {
      process.stdout.write(`${JSON.stringify(filtered, null, 2)}\n`);
      return;
    }

    const tty =
      process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
    const tw = termWidth();
    const useColor = tty;

    if (filtered.length === 0) {
      process.stdout.write("(no recorded runs)\n");
      return;
    }

    const head: [string, string, string, string, string] = useColor
      ? [
          "\x1b[1m\x1b[35mRun\x1b[0m",
          "\x1b[1m\x1b[35mStatus\x1b[0m",
          "\x1b[1m\x1b[35mPID\x1b[0m",
          "\x1b[1m\x1b[35mWorkspace\x1b[0m",
          "\x1b[1m\x1b[35mProxies\x1b[0m",
        ]
      : ["Run", "Status", "PID", "Workspace", "Proxies"];

    const w1 = Math.min(14, Math.floor(tw * 0.18));
    const w4 = Math.min(28, Math.floor(tw * 0.28));
    const w5 = Math.max(12, tw - 62);

    const dataRows: string[][] = [];
    for (const r of filtered) {
      const status = r.running
        ? useColor
          ? "\x1b[32m● running\x1b[0m"
          : "running"
        : useColor
          ? "\x1b[2m○ stopped\x1b[0m"
          : "stopped";
      const proxyCols = Object.entries(r.proxies)
        .map(([k, e]) => `${k}:${e.port}`)
        .join(" ");
      dataRows.push([
        r.runId.slice(0, 10),
        status,
        String(r.rootPid),
        `${r.workspace}/${r.worktree}`,
        proxyCols,
      ]);
    }

    const tableRows = [head, ...dataRows];
    process.stdout.write(
      `${table(tableRows, {
        border: getBorderCharacters("norc"),
        columns: [
          { width: w1, wrapWord: true },
          { width: 12, wrapWord: true },
          { width: 8, wrapWord: true },
          { width: w4, wrapWord: true },
          { width: w5, wrapWord: true },
        ],
      })}\n`
    );
  },
});
