/**
 * Per-run route registration files for the proxy daemon (`proxy/routes/<runId>.json`).
 */
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SwitchRoutingContext } from "../proxy/server.ts";
import type { ProxyRouteRegistrationFile } from "./types.ts";
import { getStateDir } from "./xdg.ts";

export const proxyRoutesDir = (): string =>
  join(getStateDir(), "proxy", "routes");

export const proxyRouteFilePath = (runId: string): string =>
  join(proxyRoutesDir(), `${runId}.json`);

const mapToRecord = (
  m: ReadonlyMap<string, number>
): Record<string, number> => {
  const o: Record<string, number> = {};
  for (const [k, v] of m) {
    o[k] = v;
  }
  return o;
};

const switchToRecord = (
  sr: SwitchRoutingContext | undefined
): ProxyRouteRegistrationFile["switchRouting"] | undefined => {
  if (sr === undefined) {
    return undefined;
  }
  const hostToEntry: Record<string, string> = {};
  for (const [k, v] of sr.hostToEntry) {
    hostToEntry[k] = v;
  }
  const proxySwitchables: Record<string, string[]> = {};
  for (const [k, v] of sr.proxySwitchables) {
    proxySwitchables[k] = [...v];
  }
  return {
    hostToEntry,
    proxySwitchables,
    sld: sr.sld,
    tld: sr.tld,
    worktree: sr.worktree,
  };
};

export const writeProxyRouteRegistration = async (options: {
  runId: string;
  routes: ReadonlyMap<string, number>;
  switchRouting: SwitchRoutingContext | undefined;
}): Promise<void> => {
  const dir = proxyRoutesDir();
  await mkdir(dir, { recursive: true });
  const body: ProxyRouteRegistrationFile = {
    version: 1,
    runId: options.runId,
    pid: process.pid,
    routes: mapToRecord(options.routes),
    switchRouting: switchToRecord(options.switchRouting),
    createdAt: new Date().toISOString(),
  };
  const path = proxyRouteFilePath(options.runId);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  await rename(tmp, path);
};

export const deleteProxyRouteRegistration = async (
  runId: string
): Promise<void> => {
  const path = proxyRouteFilePath(runId);
  await unlink(path).catch(() => {
    /* ENOENT */
  });
};
