/**
 * Best-effort live port reservations to reduce cross-process allocation races.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getLogger } from "@logtape/logtape";

import { isRecord } from "../utils/pick.ts";
import { pidAlive } from "../utils/process.ts";
import { withStateLock } from "./lock.ts";
import type { PortsRegistryFile } from "./types.ts";
import { getStateDir } from "./xdg.ts";

const log = getLogger(["orchport", "state", "ports"]);

const portsPath = (): string => join(getStateDir(), "ports.json");

class PortReservationStateUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortReservationStateUnavailable";
  }
}

export type PortReservation = {
  port: number;
  workspace: string;
  worktree: string;
  entry: string;
  runId: string;
};

const emptyRegistry = (): PortsRegistryFile => ({
  version: 1,
  assignments: {},
});

const isPortAssignment = (
  raw: unknown
): raw is PortsRegistryFile["assignments"][string] =>
  isRecord(raw) &&
  typeof raw.workspace === "string" &&
  typeof raw.worktree === "string" &&
  typeof raw.entry === "string" &&
  typeof raw.pid === "number" &&
  Number.isSafeInteger(raw.pid) &&
  typeof raw.runId === "string" &&
  typeof raw.updatedAt === "string";

const isPortsRegistryFile = (raw: unknown): raw is PortsRegistryFile =>
  isRecord(raw) &&
  raw.version === 1 &&
  isRecord(raw.assignments) &&
  Object.values(raw.assignments).every(isPortAssignment);

const parseRegistry = (text: string): PortsRegistryFile => {
  const raw: unknown = JSON.parse(text);
  if (!isPortsRegistryFile(raw)) {
    return emptyRegistry();
  }
  return raw;
};

const readRegistry = async (): Promise<PortsRegistryFile> => {
  try {
    return parseRegistry(await readFile(portsPath(), "utf8"));
  } catch {
    return emptyRegistry();
  }
};

const writeRegistry = async (registry: PortsRegistryFile): Promise<void> => {
  const dir = getStateDir();
  await mkdir(dir, { recursive: true });
  const path = portsPath();
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await rename(tmp, path);
};

const pruneDeadAssignments = (
  registry: PortsRegistryFile
): PortsRegistryFile => {
  const next = emptyRegistry();
  for (const [port, assignment] of Object.entries(registry.assignments)) {
    if (pidAlive(assignment.pid)) {
      next.assignments[port] = assignment;
    }
  }
  return next;
};

export const withPortReservations = async <T>(
  fn: (reservedPorts: ReadonlySet<number>) => Promise<{
    value: T;
    reservations: readonly PortReservation[];
  }>
): Promise<{ value: T; active: boolean }> => {
  try {
    const result = await withStateLock(
      "ports",
      async () => {
        const registry = pruneDeadAssignments(await readRegistry());
        const reservedPorts = new Set(
          Object.keys(registry.assignments)
            .map((p) => Number(p))
            .filter((p) => Number.isSafeInteger(p) && p > 0)
        );
        const allocated = await fn(reservedPorts);
        const now = new Date().toISOString();
        for (const r of allocated.reservations) {
          registry.assignments[String(r.port)] = {
            workspace: r.workspace,
            worktree: r.worktree,
            entry: r.entry,
            pid: process.pid,
            runId: r.runId,
            updatedAt: now,
          };
        }
        try {
          await writeRegistry(registry);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new PortReservationStateUnavailable(message);
        }
        return allocated.value;
      },
      { optional: true }
    );
    if (!result.locked) {
      log.warning(
        "Port reservation lock unavailable; continuing without cross-process port reservations"
      );
      const allocated = await fn(new Set());
      return { value: allocated.value, active: false };
    }
    return { value: result.value, active: true };
  } catch (err) {
    if (!(err instanceof PortReservationStateUnavailable)) {
      throw err;
    }
    log.warning(
      "Port reservation state unavailable; continuing without cross-process port reservations ({message})",
      { message: err.message }
    );
    const allocated = await fn(new Set());
    return { value: allocated.value, active: false };
  }
};
