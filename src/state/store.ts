/**
 * @module orchport/state/store
 * Persisted run metadata under `ORCHPORT_STATE_DIR` / XDG state (`runs/*.json`).
 */
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getLogger } from "@logtape/logtape";

import { parseRunStateFile } from "./parse-run-state.ts";
import type { RunStateFile } from "./types.ts";
import { getStateDir } from "./xdg.ts";

const log = getLogger(["orchport", "state"]);

const runsDir = (): string => join(getStateDir(), "runs");

/** Writes run state; throws if the state directory is not writable. */
export const writeRunState = async (run: RunStateFile): Promise<void> => {
  const dir = runsDir();
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${run.runId}.json`);
  await writeFile(path, JSON.stringify(run, null, 2));
  log.debug("state: wrote {path}", { path });
};

/**
 * Persists run metadata for list/kill. Returns false if the state directory is not writable (e.g. sandbox).
 */
export const tryWriteRunState = async (run: RunStateFile): Promise<boolean> => {
  try {
    await writeRunState(run);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warning("Could not write run state (volatile run): {msg}", { msg });
    return false;
  }
};

export const readRunState = async (
  runId: string
): Promise<RunStateFile | null> => {
  try {
    const text = await readFile(join(runsDir(), `${runId}.json`), "utf8");
    return parseRunStateFile(text);
  } catch {
    return null;
  }
};

export const listRunStates = async (): Promise<RunStateFile[]> => {
  let names: string[];
  try {
    names = await readdir(runsDir());
  } catch {
    return [];
  }
  const ids = names
    .filter((n) => n.endsWith(".json"))
    .map((n) => n.replace(/\.json$/, ""));
  const states = await Promise.all(ids.map((id) => readRunState(id)));
  const out = states.filter((s): s is RunStateFile => s !== null);
  return out.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const deleteRunState = async (runId: string): Promise<void> => {
  try {
    await unlink(join(runsDir(), `${runId}.json`));
  } catch {
    /* ignore */
  }
};
