/**
 * @module orchport/state/switch-registry
 * Persistent path-switch ownership under `getStateDir()/switches.json`.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getLogger } from "@logtape/logtape";

import type { ProxyConfig } from "../config/schema.ts";
import { normalizeSwitchPattern } from "../proxy/path-match.ts";
import { ErrorCode, OrchportError } from "../utils/errors.ts";
import { isRecord } from "../utils/pick.ts";
import { listRunStates } from "./store.ts";
import type { SwitchRegistryFile } from "./types.ts";
import { getStateDir } from "./xdg.ts";

const log = getLogger(["orchport", "switch"]);

const FILE = "switches.json";

export const switchesPath = (): string => join(getStateDir(), FILE);

export const buildSwitchRegistryKey = (
  sld: string,
  tld: string,
  proxyName: string,
  normalizedPattern: string
): string => `${sld}|${tld}|${proxyName}|${normalizedPattern}`;

const emptyRegistry = (): SwitchRegistryFile => ({ version: 1, entries: {} });

const isSwitchRegistryFile = (raw: unknown): raw is SwitchRegistryFile =>
  isRecord(raw) && raw.version === 1 && isRecord(raw.entries);

export const parseSwitchRegistry = (text: string): SwitchRegistryFile => {
  const raw: unknown = JSON.parse(text);
  if (!isSwitchRegistryFile(raw)) {
    throw new OrchportError(
      ErrorCode.STATE_PARSE,
      "Invalid switches.json format",
      {
        hint: "Delete or repair switches.json under your orchport state directory, or run `orchport doctor`.",
        context: { path: switchesPath() },
      }
    );
  }
  return raw;
};

export const readSwitchRegistry = async (): Promise<SwitchRegistryFile> => {
  try {
    const text = await readFile(switchesPath(), "utf8");
    return parseSwitchRegistry(text);
  } catch {
    return emptyRegistry();
  }
};

export const writeSwitchRegistry = async (
  registry: SwitchRegistryFile
): Promise<void> => {
  const dir = getStateDir();
  await mkdir(dir, { recursive: true });
  const path = switchesPath();
  const tmp = `${path}.${process.pid}.tmp`;
  const body = `${JSON.stringify(registry, null, 2)}\n`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, path);
};

/**
 * On `orchport run`: claim all switch slots for proxies with `switchables`.
 * @throws OrchportError SWITCH_CONFLICT if another worktree owns a slot and `force` is false.
 */
export const claimSwitchSlotsForRun = async (options: {
  sld: string;
  tld: string;
  worktree: string;
  runId: string;
  proxies: Record<string, ProxyConfig>;
  force: boolean;
}): Promise<void> => {
  const { sld, tld, worktree, runId, proxies, force } = options;
  const updates: Array<{ key: string; pattern: string; proxyName: string }> =
    [];
  for (const [proxyName, pc] of Object.entries(proxies)) {
    const patterns = pc.switchables;
    if (patterns === undefined || patterns.length === 0) {
      continue;
    }
    for (const raw of patterns) {
      const pattern = normalizeSwitchPattern(raw);
      const key = buildSwitchRegistryKey(sld, tld, proxyName, pattern);
      updates.push({ key, pattern, proxyName });
    }
  }
  if (updates.length === 0) {
    return;
  }

  const reg = await readSwitchRegistry();
  for (const { key } of updates) {
    const cur = reg.entries[key];
    if (cur !== undefined && cur.targetWorktree !== worktree && !force) {
      throw new OrchportError(
        ErrorCode.SWITCH_CONFLICT,
        `Switch slot "${key}" is owned by worktree "${cur.targetWorktree}"; use --force-switch to take over, or run \`orchport switch ${worktree}\` first.`,
        {
          hint: "Pass global `--force-switch` on `orchport run`, or run `orchport switch <worktree>` to retarget slots.",
          context: { key, owner: cur.targetWorktree, worktree },
        }
      );
    }
    if (cur !== undefined && cur.targetWorktree !== worktree && force) {
      log.warning(
        "Taking switch slot {key} from worktree {from} (--force-switch)",
        { key, from: cur.targetWorktree }
      );
    }
  }

  const now = new Date().toISOString();
  for (const { key } of updates) {
    reg.entries[key] = {
      targetWorktree: worktree,
      updatedAt: now,
      lastRunId: runId,
    };
  }
  await writeSwitchRegistry(reg);
};

/**
 * `orchport switch <worktree>`: point all configured switchables paths to this worktree.
 */
export const setSwitchTargetsFromConfig = async (options: {
  sld: string;
  tld: string;
  targetWorktree: string;
  proxies: Record<string, ProxyConfig>;
}): Promise<string[]> => {
  const { sld, tld, targetWorktree, proxies } = options;
  const reg = await readSwitchRegistry();
  const touched: string[] = [];
  const now = new Date().toISOString();
  for (const [proxyName, pc] of Object.entries(proxies)) {
    const patterns = pc.switchables;
    if (patterns === undefined || patterns.length === 0) {
      continue;
    }
    for (const raw of patterns) {
      const pattern = normalizeSwitchPattern(raw);
      const key = buildSwitchRegistryKey(sld, tld, proxyName, pattern);
      reg.entries[key] = {
        targetWorktree: targetWorktree,
        updatedAt: now,
      };
      touched.push(key);
    }
  }
  if (touched.length > 0) {
    await writeSwitchRegistry(reg);
  }
  return touched;
};

/** Latest run state port for `proxyName` in `targetWorktree`, or null. */
export const resolveSwitchTargetPort = async (
  targetWorktree: string,
  proxyName: string
): Promise<number | null> => {
  const states = await listRunStates();
  const withEntry = states.filter(
    (s) => s.worktree === targetWorktree && s.proxies[proxyName] !== undefined
  );
  if (withEntry.length === 0) {
    return null;
  }
  withEntry.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const port = withEntry[0].proxies[proxyName]?.port;
  return typeof port === "number" ? port : null;
};
