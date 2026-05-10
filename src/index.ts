import { getLogger } from "@logtape/logtape";

import { peekGlobalJsonErrorsFlag } from "./cli-json.ts";
import { runCli } from "./cli.ts";
import { formatOrchportCliError } from "./cli/format.ts";
import { packageVersion } from "./core/version.ts";
import { setupLogging } from "./logging/setup.ts";
import { orchportErrorToJson, OrchportError } from "./utils/errors.ts";

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
  if (argv.some((a) => a === "--version")) {
    process.stdout.write(`${packageVersion()}\n`);
    return;
  }

  const logFlags = peekLogFlags(argv);
  const jsonErrors = peekGlobalJsonErrorsFlag(argv);
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
      if (jsonErrors) {
        process.stderr.write(
          `${JSON.stringify(orchportErrorToJson(e, process.cwd()))}\n`
        );
      } else {
        process.stderr.write(
          formatOrchportCliError(e, {
            tty: process.stderr.isTTY === true && !logFlags.noColor,
          })
        );
      }
      process.exitCode = 1;
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (jsonErrors) {
      process.stderr.write(
        `${JSON.stringify({
          error: true,
          code: "UNKNOWN",
          message: msg,
          context: { cwd: process.cwd() },
        })}\n`
      );
    } else {
      log.error("{message}", { message: msg });
    }
    process.exitCode = 1;
  }
};

void main();
