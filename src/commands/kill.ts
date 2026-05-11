import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";

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

const parsePositiveInt = (value: string, label: string): number => {
  if (!/^\d+$/.test(value)) {
    throw new OrchportError(
      ErrorCode.KILL_USAGE,
      `Invalid ${label}: ${value}`,
      {
        hint: `${label} must be a positive integer.`,
        context: { [label]: value },
      }
    );
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new OrchportError(
      ErrorCode.KILL_USAGE,
      `Invalid ${label}: ${value}`,
      {
        hint: `${label} must be a positive integer.`,
        context: { [label]: value },
      }
    );
  }
  return n;
};

const parseTargetPort = (target: string): number | null => {
  if (/^\d+$/.test(target)) {
    return parsePositiveInt(target, "port");
  }
  try {
    const u = new URL(target);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }
    if (u.port !== "") {
      return parsePositiveInt(u.port, "port");
    }
    return u.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
};

const findPidByLsof = (port: number): number | null => {
  const r = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (r.status !== 0 || !r.stdout) {
    return null;
  }
  const pid = r.stdout
    .split(/\s+/)
    .map((s) => Number(s))
    .find((n) => Number.isSafeInteger(n) && n > 0);
  return pid ?? null;
};

const listeningInodesForPort = (port: number): Set<string> => {
  const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
  const out = new Set<string>();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      const local = cols[1];
      const state = cols[3];
      const inode = cols[9];
      if (
        local?.endsWith(`:${hexPort}`) === true &&
        state === "0A" &&
        inode !== undefined
      ) {
        out.add(inode);
      }
    }
  }
  return out;
};

const findPidByProc = (port: number): number | null => {
  const inodes = listeningInodesForPort(port);
  if (inodes.size === 0) {
    return null;
  }
  let pids: string[] = [];
  try {
    pids = readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  } catch {
    return null;
  }
  for (const pid of pids) {
    let fds: string[] = [];
    try {
      fds = readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      try {
        const target = readlinkSync(`/proc/${pid}/fd/${fd}`);
        const match = /^socket:\[(\d+)\]$/.exec(target);
        if (match?.[1] !== undefined && inodes.has(match[1])) {
          return Number(pid);
        }
      } catch {
        /* process may exit while scanning */
      }
    }
  }
  return null;
};

const findListeningPid = (port: number): number | null =>
  findPidByLsof(port) ??
  (process.platform === "linux" ? findPidByProc(port) : null);

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
    if (!isSignal(sigRaw)) {
      throw new OrchportError(
        ErrorCode.KILL_USAGE,
        `Unsupported signal ${sigRaw}`,
        {
          hint: "Use one of SIGTERM, SIGKILL, SIGINT, or SIGHUP.",
          context: { signal: sigRaw },
        }
      );
    }
    const sig: NodeJS.Signals = sigRaw;
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
      const pid = parsePositiveInt(pidStr, "pid");
      log.info("kill: signal {sig} pid {pid}", { sig, pid: pidStr });
      sendSignal(pid, sig);
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

    const force = pickBoolean(values, "force") === true;
    for (const t of targets) {
      const portTarget = parseTargetPort(t);
      if (portTarget !== null) {
        const port = portTarget;
        const match = rows.find((r) =>
          Object.values(r.proxies).some((e) => e.port === port)
        );
        if (!match) {
          if (!force) {
            throw new OrchportError(
              ErrorCode.KILL_NOT_FOUND,
              `No orchport run owns port ${port}`,
              {
                hint: "Only ports allocated by a recorded orchport run can be targeted by default; pass --force to signal a foreign process listening on this port.",
                context: { port: String(port) },
              }
            );
          }
          const foreignPid = findListeningPid(port);
          if (foreignPid === null) {
            throw new OrchportError(
              ErrorCode.KILL_NOT_FOUND,
              `No listening process found on port ${port}`,
              {
                hint: "Check the port number or stop the process manually.",
                context: { port: String(port) },
              }
            );
          }
          log.warning("kill: force port {port} -> pid {pid} {sig}", {
            port: String(port),
            pid: String(foreignPid),
            sig,
          });
          sendSignal(foreignPid, sig);
          continue;
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
