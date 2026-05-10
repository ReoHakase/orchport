/** Stable machine-readable codes for agents and `--json` CLI errors. */
export const ErrorCode = {
  CONFIG_NOT_FOUND: "CONFIG_NOT_FOUND",
  CONFIG_PARSE: "CONFIG_PARSE",
  CONFIG_EXPORT: "CONFIG_EXPORT",
  CONFIG_PACKAGE: "CONFIG_PACKAGE",
  CONFIG_CONFLICT: "CONFIG_CONFLICT",
  CONFIG_TLS_FILE: "CONFIG_TLS_FILE",
  CONFIG_EMPTY_PROXIES: "CONFIG_EMPTY_PROXIES",
  CONFIG_SWITCHABLE: "CONFIG_SWITCHABLE",
  PORT_TAKEN: "PORT_TAKEN",
  PORT_IN_USE: "PORT_IN_USE",
  PORT_RANGE: "PORT_RANGE",
  SWITCH_CONFLICT: "SWITCH_CONFLICT",
  STATE_PARSE: "STATE_PARSE",
  DOCTOR_STATE: "DOCTOR_STATE",
  KILL_NOT_FOUND: "KILL_NOT_FOUND",
  KILL_USAGE: "KILL_USAGE",
  KILL_UNSUPPORTED: "KILL_UNSUPPORTED",
  INIT_EXISTS: "INIT_EXISTS",
  INTERPOLATE: "INTERPOLATE",
  DEV_TLS: "DEV_TLS",
  CLI_USAGE: "CLI_USAGE",
  PROXY_DAEMON_NOT_RUNNING: "PROXY_DAEMON_NOT_RUNNING",
  PROXY_DAEMON_ALREADY_RUNNING: "PROXY_DAEMON_ALREADY_RUNNING",
  PROXY_BIND: "PROXY_BIND",
  RUN_NO_COMMAND: "RUN_NO_COMMAND",
  RUN_UNKNOWN_PROXY: "RUN_UNKNOWN_PROXY",
} as const;

export type ErrorCodeKey = keyof typeof ErrorCode;
export type ErrorCodeValue = (typeof ErrorCode)[ErrorCodeKey];

export type OrchportErrorOptions = {
  hint?: string;
  context?: Record<string, string>;
};

export class OrchportError extends Error {
  readonly code: ErrorCodeValue | string;

  readonly hint?: string;

  readonly context?: Record<string, string>;

  constructor(
    code: ErrorCodeValue | string,
    message: string,
    options?: OrchportErrorOptions
  ) {
    super(message);
    this.name = "OrchportError";
    this.code = code;
    if (options?.hint !== undefined) {
      this.hint = options.hint;
    }
    if (options?.context !== undefined) {
      this.context = options.context;
    }
  }
}

export type JsonCliError = {
  error: true;
  code: string;
  message: string;
  hint?: string;
  context?: Record<string, string>;
};

export const orchportErrorToJson = (
  err: OrchportError,
  cwd?: string
): JsonCliError => {
  const out: JsonCliError = {
    error: true,
    code: String(err.code),
    message: err.message,
  };
  if (err.hint !== undefined) {
    out.hint = err.hint;
  }
  const ctx = {
    ...err.context,
    ...(cwd !== undefined ? { cwd } : {}),
  };
  if (Object.keys(ctx).length > 0) {
    out.context = ctx;
  }
  return out;
};
