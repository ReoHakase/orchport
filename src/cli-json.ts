import { ORCHPORT_SUBCOMMAND_NAMES } from "./cli-argv.ts";

/**
 * True when `--json` appears in the global argv prefix (before the first subcommand).
 * Tokens after `run` … `--` belong to the child and must not flip CLI JSON mode.
 */
export const peekGlobalJsonErrorsFlag = (argv: string[]): boolean => {
  const dash = argv.indexOf("--");
  const head = dash === -1 ? argv : argv.slice(0, dash);
  const subIdx = head.findIndex(
    (a) => !a.startsWith("-") && ORCHPORT_SUBCOMMAND_NAMES.has(a)
  );
  const prefix = subIdx === -1 ? head : head.slice(0, subIdx);
  return prefix.some((a) => a === "--json");
};
