import { GLOBAL_STRING_OPTION_NAMES } from "./commands/global-plugin.ts";

const LONG_PREFIX = "--";
const OPTION_TERMINATOR = "--";

/** Must match `subCommands` keys in cli.ts. */
export const ORCHPORT_SUBCOMMAND_NAMES = new Set([
  "run",
  "env",
  "init",
  "list",
  "kill",
  "doctor",
  "switch",
  "proxy",
]);

const mergeGlobalStringOptionsInPrefix = (prefix: string[]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < prefix.length; i++) {
    const a = prefix[i];
    if (a === undefined) {
      break;
    }
    if (
      a.startsWith(LONG_PREFIX) &&
      !a.startsWith(`${LONG_PREFIX}${LONG_PREFIX}`)
    ) {
      const eq = a.indexOf("=", LONG_PREFIX.length);
      if (eq !== -1) {
        out.push(a);
        continue;
      }
      const name = a.slice(LONG_PREFIX.length);
      if (GLOBAL_STRING_OPTION_NAMES.has(name)) {
        const next = prefix[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          out.push(`${a}=${next}`);
          i++;
          continue;
        }
      }
    }
    out.push(a);
  }
  return out;
};

const normalizeGlobalShortOptionsInPrefix = (prefix: string[]): string[] =>
  prefix.map((a) => (a === "-v" ? "--verbose" : a));

const firstSubcommandIndex = (head: string[]): number => {
  for (let i = 0; i < head.length; i++) {
    const a = head[i];
    if (
      a !== undefined &&
      !a.startsWith("-") &&
      ORCHPORT_SUBCOMMAND_NAMES.has(a)
    ) {
      return i;
    }
  }
  return -1;
};

/** Tokens before the first orchport subcommand and before the first `--` separator. */
export const globalOptionPrefix = (argv: string[]): string[] => {
  const dash = argv.indexOf(OPTION_TERMINATOR);
  const head = dash === -1 ? argv : argv.slice(0, dash);
  const subIdx = firstSubcommandIndex(head);
  return subIdx === -1 ? head : head.slice(0, subIdx);
};

export const hasGlobalFlag = (
  argv: string[],
  flags: readonly string[]
): boolean => {
  const flagSet = new Set(flags);
  return globalOptionPrefix(argv).some((a) => flagSet.has(a));
};

/**
 * Gunshi resolves subcommands from positional tokens only; `--config ./file` before the
 * real subcommand leaves `./file` as a false command name. Merge `--opt value` into
 * `--opt=value` only in the **global prefix** (tokens before the subcommand). Options
 * after `run` / `env` / … are left alone so child processes keep `--config path` etc.
 */
export const normalizeGlobalOptionArgv = (argv: string[]): string[] => {
  const dash = argv.indexOf(OPTION_TERMINATOR);
  const head = dash === -1 ? argv : argv.slice(0, dash);
  const tail = dash === -1 ? [] : argv.slice(dash);

  const subIdx = firstSubcommandIndex(head);
  if (subIdx === -1) {
    return [
      ...mergeGlobalStringOptionsInPrefix(
        normalizeGlobalShortOptionsInPrefix(head)
      ),
      ...tail,
    ];
  }
  const prefix = normalizeGlobalShortOptionsInPrefix(head.slice(0, subIdx));
  const afterSub = head.slice(subIdx);
  return [...mergeGlobalStringOptionsInPrefix(prefix), ...afterSub, ...tail];
};
