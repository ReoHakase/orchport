/**
 * Human-readable CLI formatting for stderr (errors, hints).
 */
import type { OrchportError } from "../utils/errors.ts";

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
};

/** Styled stderr line for fatal CLI errors (TTY uses ANSI). */
export const formatOrchportCliError = (
  err: OrchportError,
  options: { tty: boolean }
): string => {
  const { tty } = options;
  const code = String(err.code);
  const lines: string[] = [];
  if (tty) {
    lines.push(
      `${ansi.bold}${ansi.red}✗ ${ansi.reset}${ansi.bold}${code}${ansi.reset}${ansi.red}: ${err.message}${ansi.reset}`
    );
  } else {
    lines.push(`error[${code}]: ${err.message}`);
  }
  if (err.hint !== undefined && err.hint.trim() !== "") {
    lines.push(
      tty
        ? `${ansi.dim}  hint: ${err.hint}${ansi.reset}`
        : `  hint: ${err.hint}`
    );
  }
  return `${lines.join("\n")}\n`;
};

/** Success line for doctor-style checks. */
export const formatCliOkLine = (
  label: string,
  detail: string,
  options: { tty: boolean }
): string => {
  if (options.tty) {
    return `${ansi.green}✓${ansi.reset}  ${ansi.bold}${label.padEnd(10, " ")}${ansi.reset}  ${detail}\n`;
  }
  return `ok  ${label.padEnd(10, " ")}  ${detail}\n`;
};

export const formatCliFailLine = (
  label: string,
  detail: string,
  options: { tty: boolean }
): string => {
  if (options.tty) {
    return `${ansi.red}✗${ansi.reset}  ${ansi.bold}${label.padEnd(10, " ")}${ansi.reset}  ${detail}\n`;
  }
  return `no  ${label.padEnd(10, " ")}  ${detail}\n`;
};

/** Short banner line after successful commands. */
export const formatCliSuccess = (
  message: string,
  options: { tty: boolean }
): string =>
  options.tty
    ? `${ansi.green}${ansi.bold}✓${ansi.reset} ${message}\n`
    : `${message}\n`;
