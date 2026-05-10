/**
 * Persistent metadata for `orchport proxy up` (daemon process).
 */
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isRecord } from "../utils/pick.ts";
import type { ProxyDaemonStateFile } from "./types.ts";
import { getStateDir } from "./xdg.ts";

export const proxyDaemonPath = (): string =>
  join(getStateDir(), "proxy", "daemon.json");

const isDaemonState = (raw: unknown): raw is ProxyDaemonStateFile => {
  if (!isRecord(raw)) {
    return false;
  }
  const o = raw;
  return (
    o.version === 1 &&
    typeof o.pid === "number" &&
    typeof o.mainPort === "number" &&
    (o.httpsPort === null || typeof o.httpsPort === "number") &&
    typeof o.tls === "boolean" &&
    (o.certPath === null || typeof o.certPath === "string") &&
    typeof o.startedAt === "string"
  );
};

/** Best-effort: returns null if missing or invalid. */
export const readProxyDaemonState = (): ProxyDaemonStateFile | null => {
  const p = proxyDaemonPath();
  if (!existsSync(p)) {
    return null;
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(p, "utf8"));
    if (!isDaemonState(raw)) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
};

export const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const isProxyDaemonRunning = (): boolean => {
  const s = readProxyDaemonState();
  return s !== null && pidAlive(s.pid);
};

export const writeProxyDaemonState = async (
  state: ProxyDaemonStateFile
): Promise<void> => {
  const path = proxyDaemonPath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  const body = `${JSON.stringify(state, null, 2)}\n`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, path);
};

export const deleteProxyDaemonStateFile = (): void => {
  try {
    unlinkSync(proxyDaemonPath());
  } catch {
    /* ENOENT */
  }
};
