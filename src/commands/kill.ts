import { getLogger } from "@logtape/logtape";
import { define } from "gunshi";

import { deleteRunState, listRunStates } from "../state/store.ts";
import { ErrorCode, OrchportError } from "../utils/errors.ts";
import { pickBoolean, pickString, pickStringArray } from "../utils/pick.ts";
import { pidAlive } from "../utils/process.ts";

const log = getLogger(["orchport", "kill"]);

const isSignal = (s: string): s is NodeJS.Signals =>
  s === "SIGTERM" || s === "SIGKILL" || s === "SIGINT" || s === "SIGHUP";

const sendSignal = (pid: number, sig: NodeJS.Signals): void => {
  process.kill(pid, sig);
};

/**
 * Signals root PIDs from recorded runs (by entry name, port, run id, `--all`, etc.). `--stale` drops dead run JSON files only.
 */
export const killCommand = define({
  name: "kill",
  description: "Stop processes recorded by orchport",
  args: {
    target: {
      type: "positional",
      multiple: true,
      description: "Entry name, port number, or run id fragment",
    },
    all: {
      type: "boolean",
      description: "Signal every recorded running root process",
      default: false,
    },
    stale: {
      type: "boolean",
      description: "Remove state files for dead runs",
      default: false,
    },
    runId: {
      type: "string",
      toKebab: true,
      description: "Signal the run with this exact run id",
    },
    pid: { type: "string", description: "Process id to signal" },
    force: {
      type: "boolean",
      description: "Allow killing a process that was not recorded by orchport",
      default: false,
    },
    signal: {
      type: "string",
      description: "Signal to send (SIGTERM, SIGKILL, SIGINT, or SIGHUP)",
      default: "SIGTERM",
    },
  },
  run: async (ctx) => {
    const values = ctx.values;
    const sigRaw = pickString(values, "signal") ?? "SIGTERM";
    const sig: NodeJS.Signals = isSignal(sigRaw) ? sigRaw : "SIGTERM";
    const rows = await listRunStates();
    log.debug("kill: loaded {n} run state(s)", { n: String(rows.length) });

    if (pickBoolean(values, "stale") === true) {
      const staleIds = rows
        .filter((r) => !pidAlive(r.rootPid))
        .map((r) => r.runId);
      await Promise.all(staleIds.map((id) => deleteRunState(id)));
      const n = staleIds.length;
      log.info("Removed {n} stale run state file(s)", { n: String(n) });
      return;
    }

    const pidStr = pickString(values, "pid");
    if (pidStr !== undefined && pidStr !== "") {
      log.info("kill: signal {sig} pid {pid}", { sig, pid: pidStr });
      sendSignal(Number(pidStr), sig);
      return;
    }

    const runIdVal = pickString(values, "runId");
    if (runIdVal) {
      const r = rows.find((x) => x.runId === runIdVal);
      if (!r) {
        throw new OrchportError(
          ErrorCode.KILL_NOT_FOUND,
          `Unknown run id ${runIdVal}`,
          {
            hint: "Run `orchport list` to see recorded run ids.",
            context: { runId: runIdVal },
          }
        );
      }
      if (pidAlive(r.rootPid)) {
        log.info("kill: runId {id} rootPid {pid} signal {sig}", {
          id: runIdVal,
          pid: String(r.rootPid),
          sig,
        });
        sendSignal(r.rootPid, sig);
      } else {
        log.warning("kill: runId {id} pid {pid} not alive", {
          id: runIdVal,
          pid: String(r.rootPid),
        });
      }
      return;
    }

    if (pickBoolean(values, "all") === true) {
      log.warning("kill: signaling all {n} run(s) with {sig}", {
        n: String(rows.length),
        sig,
      });
      for (const r of rows) {
        if (pidAlive(r.rootPid)) {
          log.debug("kill: pid {pid}", { pid: String(r.rootPid) });
          sendSignal(r.rootPid, sig);
        }
      }
      return;
    }

    const targets = pickStringArray(values, "target") ?? [];
    if (targets.length === 0) {
      throw new OrchportError(
        ErrorCode.KILL_USAGE,
        "Specify a target, or use --all / --stale / --run-id / --pid",
        {
          hint: "Example: `orchport kill web` or `orchport kill --run-id <id>`.",
        }
      );
    }

    for (const t of targets) {
      if (/^\d+$/.test(t)) {
        const port = Number(t);
        const match = rows.find((r) =>
          Object.values(r.proxies).some((e) => e.port === port)
        );
        if (!match) {
          if (pickBoolean(values, "force") !== true) {
            throw new OrchportError(
              ErrorCode.KILL_NOT_FOUND,
              `No orchport run owns port ${port}`,
              {
                hint: "Only ports allocated by a recorded orchport run can be targeted; foreign processes are not killed yet.",
                context: { port: String(port) },
              }
            );
          }
          throw new OrchportError(
            ErrorCode.KILL_UNSUPPORTED,
            "--force for non-orchport ports is not implemented yet",
            {
              hint: "Stop the process listening on that port manually (e.g. activity Monitor / lsof / kill).",
            }
          );
        }
        if (pidAlive(match.rootPid)) {
          log.info("kill: port {port} -> rootPid {pid} {sig}", {
            port: String(port),
            pid: String(match.rootPid),
            sig,
          });
          sendSignal(match.rootPid, sig);
        } else {
          log.debug("kill: port {port} matched dead pid", {
            port: String(port),
          });
        }
        continue;
      }

      const byEntry = rows.filter((r) => r.proxies[t] !== undefined);
      if (byEntry.length === 0) {
        const byId = rows.filter((r) => r.runId.startsWith(t));
        if (byId.length === 1 && pidAlive(byId[0].rootPid)) {
          log.info("kill: run id prefix {t} -> pid {pid}", {
            t,
            pid: String(byId[0].rootPid),
          });
          sendSignal(byId[0].rootPid, sig);
          continue;
        }
        throw new OrchportError(
          ErrorCode.KILL_NOT_FOUND,
          `No run matched target ${t}`,
          {
            hint: "Use an entry name, port number, run id prefix, or `orchport list`.",
            context: { target: t },
          }
        );
      }
      const r = byEntry[0];
      if (pidAlive(r.rootPid)) {
        log.info("kill: entry {entry} -> pid {pid} {sig}", {
          entry: t,
          pid: String(r.rootPid),
          sig,
        });
        sendSignal(r.rootPid, sig);
      }
    }
  },
});
