import { getLogger } from "@logtape/logtape";

import { runCli } from "./cli.ts";
import { packageVersion } from "./core/version.ts";
import { setupLogging } from "./logging/setup.ts";
import { OrchportError } from "./utils/errors.ts";

const peekLogFlags = (
  argv: string[]
): { verbose: boolean; quiet: boolean; noColor: boolean } => ({
  verbose: argv.some((a) => a === "--verbose" || a === "-v"),
  quiet: argv.some((a) => a === "--quiet" || a === "-q"),
  noColor:
    argv.some((a) => a === "--no-color") || process.env.NO_COLOR !== undefined,
});

const log = getLogger(["orchport", "cli"]);

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const logFlags = peekLogFlags(argv);
  await setupLogging(logFlags);
  log.trace("orchport {version} cwd={cwd}", {
    version: packageVersion(),
    cwd: process.cwd(),
  });
  if (logFlags.verbose) {
    log.trace("full argv: {argv}", { argv: process.argv.join(" ") });
    log.trace("normalized argv: {argv}", {
      argv: argv.join(" "),
    });
  }
  try {
    await runCli(argv);
  } catch (e) {
    if (e instanceof OrchportError) {
      log.error("{message}", { message: e.message });
      process.exitCode = 1;
      return;
    }
    log.error("{message}", {
      message: e instanceof Error ? e.message : String(e),
    });
    process.exitCode = 1;
  }
};

void main();
