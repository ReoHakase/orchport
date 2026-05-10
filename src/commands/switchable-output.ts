import { normalizeSwitchPattern } from "../proxy/path-match.ts";
/**
 * Human-readable switchable route summaries.
 */
import { buildSwitchRegistryKey } from "../state/switch-registry.ts";
import type { RunStateFile, SwitchRegistryFile } from "../state/types.ts";

export type SwitchableRoute = {
  key: string;
  proxyName: string;
  pattern: string;
  targetWorktree: string;
  incomingUrl: string;
  localTargetUrl?: string;
  targetPublicUrl?: string;
  unresolved: boolean;
  unresolvedReason?: string;
};

const splitSwitchKey = (
  key: string
): { sld: string; tld: string; proxyName: string; pattern: string } | null => {
  const parts = key.split("|");
  if (parts.length !== 4) {
    return null;
  }
  const [sld, tld, proxyName, pattern] = parts;
  if (
    sld === undefined ||
    tld === undefined ||
    proxyName === undefined ||
    pattern === undefined
  ) {
    return null;
  }
  return { sld, tld, proxyName, pattern };
};

const latestRunFor = (
  states: readonly RunStateFile[],
  worktree: string,
  proxyName: string
): RunStateFile | undefined =>
  states
    .filter(
      (state) =>
        state.worktree === worktree && state.proxies[proxyName] !== undefined
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

const joinUrlPath = (base: string, pattern: string): string => {
  if (pattern === "" || pattern === "/") {
    return base;
  }
  return `${base.replace(/\/+$/u, "")}${pattern.startsWith("/") ? pattern : `/${pattern}`}`;
};

const incomingUrlFor = (
  proxyName: string,
  sld: string,
  tld: string,
  pattern: string,
  target?: RunStateFile
): string => {
  let protocol = "https:";
  const targetUrl = target?.proxies[proxyName]?.url;
  if (targetUrl !== undefined) {
    try {
      protocol = new URL(targetUrl).protocol;
    } catch {
      protocol = targetUrl.startsWith("http://") ? "http:" : "https:";
    }
  }
  return joinUrlPath(`${protocol}//${proxyName}.${sld}${tld}`, pattern);
};

export const formatSwitchableRoutes = (
  registry: SwitchRegistryFile,
  states: readonly RunStateFile[],
  options?: { keys?: readonly string[] }
): SwitchableRoute[] => {
  const keySet =
    options?.keys === undefined ? null : new Set(options.keys.map(String));
  const routes: SwitchableRoute[] = [];
  for (const [key, entry] of Object.entries(registry.entries)) {
    if (keySet !== null && !keySet.has(key)) {
      continue;
    }
    const parsed = splitSwitchKey(key);
    if (parsed === null) {
      continue;
    }
    const { sld, tld, proxyName, pattern } = parsed;
    const target = latestRunFor(states, entry.targetWorktree, proxyName);
    const incomingUrl = incomingUrlFor(proxyName, sld, tld, pattern, target);
    const targetProxy = target?.proxies[proxyName];
    if (targetProxy === undefined) {
      routes.push({
        key,
        proxyName,
        pattern,
        targetWorktree: entry.targetWorktree,
        incomingUrl,
        unresolved: true,
        unresolvedReason: `target ${entry.targetWorktree} is not running; requests return 502`,
      });
      continue;
    }
    routes.push({
      key,
      proxyName,
      pattern,
      targetWorktree: entry.targetWorktree,
      incomingUrl,
      localTargetUrl: joinUrlPath(targetProxy.localUrl, pattern),
      targetPublicUrl: joinUrlPath(targetProxy.url, pattern),
      unresolved: false,
    });
  }
  return routes.toSorted((a, b) => a.key.localeCompare(b.key));
};

export const hasSwitchablesForRun = (
  run: RunStateFile,
  registry: SwitchRegistryFile
): boolean => {
  for (const [key, entry] of Object.entries(registry.entries)) {
    if (entry.targetWorktree !== run.worktree) {
      continue;
    }
    const parsed = splitSwitchKey(key);
    if (parsed === null || parsed.sld !== run.workspace) {
      continue;
    }
    if (run.proxies[parsed.proxyName] !== undefined) {
      return true;
    }
  }
  return false;
};

export const buildConfiguredSwitchKeys = (options: {
  sld: string;
  tld: string;
  proxies: Record<string, { switchables?: readonly string[] }>;
}): string[] => {
  const out: string[] = [];
  for (const [proxyName, proxy] of Object.entries(options.proxies)) {
    for (const pattern of proxy.switchables ?? []) {
      out.push(
        buildSwitchRegistryKey(
          options.sld,
          options.tld,
          proxyName,
          normalizeSwitchPattern(pattern)
        )
      );
    }
  }
  return out;
};
