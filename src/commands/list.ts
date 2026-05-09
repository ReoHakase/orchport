import { getLogger } from "@logtape/logtape";
import { define } from "gunshi";

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

    for (const r of filtered) {
      const status = r.running ? "running" : "stopped";
      const entries = Object.entries(r.entries)
        .map(([k, e]) => `${k}:${e.port}`)
        .join(" ");
      process.stdout.write(
        `${r.runId}  ${status}  pid=${r.rootPid}  ${r.workspace}/${r.worktree}  [${entries}]\n`
      );
    }
  },
});
