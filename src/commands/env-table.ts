import {
  bold,
  muted,
  statusIcon,
  urlText,
  type CliUiOptions,
} from "../cli/format.ts";
/**
 * @module orchport/commands/env-table
 * Human-readable env tables.
 */
import { formatHumanTable } from "../cli/human-table.ts";
import { entryKeyToEnvPrefix } from "../utils/snake.ts";

const hasUnsafeControlChar = (s: string): boolean => {
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
      return true;
    }
  }
  return false;
};

const termWidth = (): number => {
  const c = process.stdout.columns;
  return typeof c === "number" && c > 48 ? c : 100;
};

export type EnvSection = {
  name: string;
  env: Record<string, string>;
  proxy?: { url: string; localUrl: string };
};

/** Renders one Variable/Value table as a string (for tests and stdout). */
export const formatEnvTable = (
  env: Record<string, string>,
  options: { useColor: boolean }
): string => {
  const keys = Object.keys(env).toSorted();
  if (keys.length === 0) {
    return "";
  }

  let useColor = options.useColor;
  if (useColor) {
    for (const k of keys) {
      const v = env[k];
      if (hasUnsafeControlChar(k) || hasUnsafeControlChar(v)) {
        useColor = false;
        break;
      }
    }
  }

  const tw = termWidth();
  const keyCol = Math.min(42, Math.max(24, Math.floor(tw * 0.42)));
  const valCol = Math.max(24, tw - keyCol - 2);

  const headerRow: [string, string] = ["Variable", "Value"];

  const rows: string[][] = [];
  for (const k of keys) {
    const v = env[k];
    rows.push([k, v]);
  }

  return formatHumanTable({
    headers: headerRow,
    rows,
    columnWidths: [keyCol, valCol],
    useColor,
  });
};

const proxyEnvPrefixes = (proxyNames: readonly string[]): string[] =>
  proxyNames.map((name) => `ORCHPORT_${entryKeyToEnvPrefix(name)}_`);

const isProxySpecificKey = (
  key: string,
  proxyName: string,
  allProxyPrefixes: readonly string[]
): boolean => {
  const ownPrefix = `ORCHPORT_${entryKeyToEnvPrefix(proxyName)}_`;
  if (key.startsWith(ownPrefix)) {
    return true;
  }
  if (key.startsWith("ORCHPORT_")) {
    return false;
  }
  return !allProxyPrefixes.some((prefix) => key.startsWith(prefix));
};

export const splitEnvSections = (
  envByProxy: Record<string, Record<string, string>>,
  options: { proxies?: Record<string, { url: string; localUrl: string }> }
): EnvSection[] => {
  const names = Object.keys(envByProxy).toSorted();
  const prefixes = proxyEnvPrefixes(names);
  const globalKeys = new Set<string>();
  for (const name of names) {
    const env = envByProxy[name];
    for (const key of Object.keys(env)) {
      if (
        key.startsWith("ORCHPORT_") &&
        prefixes.some((prefix) => key.startsWith(prefix))
      ) {
        continue;
      }
      if (names.every((other) => envByProxy[other]?.[key] === env[key])) {
        globalKeys.add(key);
      }
    }
  }
  const first = names[0];
  const sections: EnvSection[] = [];
  if (first !== undefined) {
    const globalEnv: Record<string, string> = {};
    for (const key of [...globalKeys].toSorted()) {
      const value = envByProxy[first]?.[key];
      if (value !== undefined) {
        globalEnv[key] = value;
      }
    }
    if (Object.keys(globalEnv).length > 0) {
      sections.push({ name: "global", env: globalEnv });
    }
  }
  for (const name of names) {
    const env = envByProxy[name];
    const sectionEnv: Record<string, string> = {};
    for (const key of Object.keys(env).toSorted()) {
      if (globalKeys.has(key)) {
        continue;
      }
      if (isProxySpecificKey(key, name, prefixes)) {
        sectionEnv[key] = env[key];
      }
    }
    if (Object.keys(sectionEnv).length > 0) {
      sections.push({
        name,
        env: sectionEnv,
        ...(options.proxies?.[name] !== undefined
          ? { proxy: options.proxies[name] }
          : {}),
      });
    }
  }
  return sections;
};

/** Per-proxy sections: heading + table for each service (same global + `ORCHPORT_*` in each). */
export const formatPerProxyEnvTables = (
  envByProxy: Record<string, Record<string, string>>,
  options: {
    useColor: boolean;
    header?: {
      command?: string;
      mode: string;
      workspace: string;
      worktree: string;
    };
    proxies?: Record<string, { url: string; localUrl: string }>;
    split?: boolean;
  }
): string => {
  const parts: string[] = [];
  const ui: CliUiOptions = { color: options.useColor };
  if (options.header !== undefined) {
    parts.push(
      [
        bold(options.header.command ?? "orchport env", ui),
        `${muted("mode", ui)} ${options.header.mode}  ${muted("workspace", ui)} ${options.header.workspace}  ${muted("worktree", ui)} ${options.header.worktree}`,
      ].join("\n")
    );
  }
  const sections =
    options.split === false
      ? Object.entries(envByProxy).map(([name, env]) => {
          const proxy = options.proxies?.[name];
          return proxy === undefined ? { name, env } : { name, env, proxy };
        })
      : splitEnvSections(envByProxy, options);
  for (const section of sections) {
    const body = formatEnvTable(section.env, options);
    if (body.length === 0) {
      continue;
    }
    const proxy = section.proxy;
    const title =
      proxy === undefined
        ? bold(section.name, ui)
        : `${statusIcon("running", ui)} ${bold(section.name, ui)}  ${urlText(proxy.url, ui)} ${muted(`(→ ${proxy.localUrl})`, ui)}`;
    parts.push(`${title}\n${body}`);
  }
  return parts.join("\n");
};

export const writePerProxyEnvTables = (
  envByProxy: Record<string, Record<string, string>>,
  options: Parameters<typeof formatPerProxyEnvTables>[1]
): void => {
  const out = formatPerProxyEnvTables(envByProxy, options);
  if (out.length > 0) {
    process.stdout.write(out);
  }
};
