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
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  magenta: "\x1b[35m",
};

export type CliUiOptions = {
  color: boolean;
};

export const cliUseColor = (
  stream: { isTTY?: boolean },
  options?: { noColor?: boolean }
): boolean =>
  stream.isTTY === true &&
  process.env.NO_COLOR === undefined &&
  options?.noColor !== true;

export const style = (
  text: string,
  color: keyof typeof ansi,
  options: CliUiOptions
): string => (options.color ? `${ansi[color]}${text}${ansi.reset}` : text);

export const bold = (text: string, options: CliUiOptions): string =>
  style(text, "bold", options);

export const muted = (text: string, options: CliUiOptions): string =>
  style(text, "gray", options);

export const urlText = (text: string, options: CliUiOptions): string =>
  style(text, "cyan", options);

export const statusIcon = (
  kind: "ok" | "warn" | "error" | "running" | "stopped" | "info",
  options: CliUiOptions
): string => {
  const raw =
    kind === "ok"
      ? "✓"
      : kind === "warn"
        ? "!"
        : kind === "error"
          ? "✗"
          : kind === "stopped"
            ? "○"
            : kind === "info"
              ? "→"
              : "●";
  const color =
    kind === "ok" || kind === "running"
      ? "green"
      : kind === "warn"
        ? "yellow"
        : kind === "error"
          ? "red"
          : kind === "stopped"
            ? "gray"
            : "cyan";
  return style(raw, color, options);
};

export const formatNextLine = (
  message: string,
  options: CliUiOptions
): string => `${style("Next:", "bold", options)} ${message}\n`;

export const formatRouteLine = (
  route: {
    incomingUrl: string;
    localTargetUrl?: string;
    targetPublicUrl?: string;
    unresolvedReason?: string;
  },
  options: CliUiOptions
): string => {
  const incoming = urlText(route.incomingUrl, options);
  if (route.localTargetUrl === undefined) {
    const reason =
      route.unresolvedReason ??
      "target worktree is not running; requests return 502";
    return `${incoming} ${muted("→", options)} ${style("unresolved", "yellow", options)} ${muted(`(${reason})`, options)}\n`;
  }
  const local = urlText(route.localTargetUrl, options);
  const target =
    route.targetPublicUrl === undefined
      ? ""
      : ` ${muted(`(← ${route.targetPublicUrl})`, options)}`;
  return `${incoming} ${muted("→", options)} ${local}${target}\n`;
};

const defaultNextForError = (code: string): string | undefined => {
  switch (code) {
    case "CONFIG_NOT_FOUND":
      return "Create `orchport.yaml`, `orchport.json`, or `orchport.config.ts`, or pass `--config <path>`.";
    case "CONFIG_PARSE":
    case "CONFIG_EXPORT":
    case "CONFIG_PACKAGE":
    case "CONFIG_CONFLICT":
      return "Fix the config file and rerun the command.";
    case "CONFIG_TLS_FILE":
      return "Check the configured PEM paths or use `proxy.tls: dev`.";
    case "PORT_TAKEN":
    case "PORT_IN_USE":
    case "PORT_RANGE":
      return "Free the port, widen the configured range, or choose a different range.";
    case "SWITCH_CONFLICT":
      return "Run `orchport switch <worktree>` or pass `--force-switch` if taking ownership is intended.";
    case "STATE_PARSE":
    case "DOCTOR_STATE":
      return "Run `orchport doctor` and repair or reset the orchport state directory.";
    case "RUN_NO_COMMAND":
      return "Pass the child command after `--`, for example `orchport run -- bun dev`.";
    default:
      return undefined;
  }
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
  if (err.context !== undefined && Object.keys(err.context).length > 0) {
    const ctx = Object.entries(err.context)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    lines.push(
      tty ? `${ansi.dim}  context: ${ctx}${ansi.reset}` : `  context: ${ctx}`
    );
  }
  const next = defaultNextForError(code);
  if (next !== undefined) {
    lines.push(
      tty ? `  ${ansi.bold}Next:${ansi.reset} ${next}` : `  Next: ${next}`
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
