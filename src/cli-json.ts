import { hasGlobalFlag } from "./cli-argv.ts";

/**
 * True when `--json` appears in the global argv prefix (before the first subcommand).
 * Tokens after `run` … `--` belong to the child and must not flip CLI JSON mode.
 */
export const peekGlobalJsonErrorsFlag = (argv: string[]): boolean =>
  hasGlobalFlag(argv, ["--json"]);
