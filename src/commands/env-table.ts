/**
 * @module orchport/commands/env-table
 * Human-readable env table via [cli-table3](https://github.com/cli-table/cli-table3).
 */
import Table from "cli-table3";

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

/** Renders the table as a string (for tests and stdout). */
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

  const head: [string, string] = useColor
    ? ["\x1b[1m\x1b[35mVariable\x1b[0m", "\x1b[1m\x1b[35mValue\x1b[0m"]
    : ["Variable", "Value"];

  const table = new Table({
    head,
    colWidths: [keyCol, valCol],
    wordWrap: true,
    style: {
      head: [],
      border: useColor ? ["dim"] : [],
    },
  });

  for (const k of keys) {
    const v = env[k];
    table.push([
      useColor ? `\x1b[1m\x1b[33m${k}\x1b[0m` : k,
      useColor ? `\x1b[32m${v}\x1b[0m` : v,
    ]);
  }

  return `${table.toString()}\n`;
};

export const writeEnvTable = (
  env: Record<string, string>,
  options: { useColor: boolean }
): void => {
  const out = formatEnvTable(env, options);
  if (out.length > 0) {
    process.stdout.write(out);
  }
};
