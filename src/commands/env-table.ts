/**
 * @module orchport/commands/env-table
 * Human-readable env tables via [table](https://github.com/gajus/table).
 */
import { getBorderCharacters, table } from "table";

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
  const keyCol = Math.min(42, Math.max(14, Math.floor(tw * 0.34)));
  const valCol = Math.max(24, tw - keyCol - 6);

  const headerRow: [string, string] = useColor
    ? ["\x1b[1m\x1b[35mVariable\x1b[0m", "\x1b[1m\x1b[35mValue\x1b[0m"]
    : ["Variable", "Value"];

  const rows: string[][] = [headerRow];
  for (const k of keys) {
    const v = env[k];
    rows.push([
      useColor ? `\x1b[1m\x1b[33m${k}\x1b[0m` : k,
      useColor ? `\x1b[32m${v}\x1b[0m` : v,
    ]);
  }

  return `${table(rows, {
    border: getBorderCharacters("norc"),
    columns: [
      { width: keyCol, wrapWord: true },
      { width: valCol, wrapWord: true },
    ],
  })}\n`;
};

/** Per-proxy sections: heading + table for each service (same global + `ORCHPORT_*` in each). */
export const formatPerProxyEnvTables = (
  envByProxy: Record<string, Record<string, string>>,
  options: { useColor: boolean }
): string => {
  const names = Object.keys(envByProxy).toSorted();
  const parts: string[] = [];
  for (const name of names) {
    const body = formatEnvTable(envByProxy[name], options);
    if (body.length === 0) {
      continue;
    }
    const title = options.useColor
      ? `\x1b[1m\x1b[36m━━ ${name} ━━\x1b[0m`
      : `━━ ${name} ━━`;
    parts.push(`${title}\n${body}`);
  }
  return parts.join("\n");
};

export const writePerProxyEnvTables = (
  envByProxy: Record<string, Record<string, string>>,
  options: { useColor: boolean }
): void => {
  const out = formatPerProxyEnvTables(envByProxy, options);
  if (out.length > 0) {
    process.stdout.write(out);
  }
};
