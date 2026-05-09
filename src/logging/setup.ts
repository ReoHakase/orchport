import {
  configure,
  defaultTextFormatter,
  getStreamSink,
  getTextFormatter,
  parseLogLevel,
  type LogLevel,
  type TextFormatter,
} from "@logtape/logtape";
import { getPrettyFormatter } from "@logtape/pretty";

export type LogCliFlags = {
  verbose: boolean;
  quiet: boolean;
  noColor: boolean;
};

/** Plain stderr (no category prefix, no ANSI, string values without inspect quotes). */
const productionTextFormatter: TextFormatter = getTextFormatter({
  timestamp: "none",
  category: () => "",
  value: (v, inspect) =>
    typeof v === "string" ? v : inspect(v, { colors: false }),
  format: ({ message }) => message,
});

/**
 * Compiled binary / `NODE_ENV=production`: avoid LogTape pretty (orchport·cli, green, quoted strings).
 * **`--verbose` forces non-production style** so categories and levels are visible on the binary too.
 * Override with `ORCHPORT_LOG_PRETTY=1` for debugging without verbose.
 */
export const isProductionLogStyle = (opts?: { verbose?: boolean }): boolean => {
  if (opts?.verbose) {
    return false;
  }
  if (process.env.ORCHPORT_LOG_PRETTY === "1") {
    return false;
  }
  if (process.env.NODE_ENV === "production") {
    return true;
  }
  const exe = process.argv[0] ?? "";
  if (/[/\\]bun(?:\.exe)?$/i.test(exe) || /[/\\]node(?:\.exe)?$/i.test(exe)) {
    return false;
  }
  return true;
};

const stderrSink = (formatter: TextFormatter) =>
  getStreamSink(
    new WritableStream<Uint8Array>({
      write(chunk) {
        return new Promise<void>((resolve, reject) => {
          process.stderr.write(chunk, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      },
    }),
    { formatter }
  );

export const setupLogging = async (flags: LogCliFlags): Promise<LogLevel> => {
  const envLevel = process.env.LOG_LEVEL?.trim();
  let lowest: LogLevel = "info";
  if (flags.quiet) {
    lowest = "warning";
  } else if (flags.verbose) {
    lowest = "trace";
  } else if (envLevel) {
    try {
      lowest = parseLogLevel(envLevel);
    } catch {
      /* invalid LOG_LEVEL: keep default */
    }
  }

  const tty = process.stderr.isTTY === true;
  const useColor = tty && !flags.noColor && !process.env.NO_COLOR;
  const formatter: TextFormatter = isProductionLogStyle({
    verbose: flags.verbose,
  })
    ? productionTextFormatter
    : useColor
      ? getPrettyFormatter({ colors: true })
      : defaultTextFormatter;

  await configure({
    reset: true,
    sinks: {
      stderr: stderrSink(formatter),
    },
    loggers: [
      {
        category: "orchport",
        sinks: ["stderr"],
        lowestLevel: lowest,
      },
      {
        category: ["logtape", "meta"],
        sinks: ["stderr"],
        // Verbose: still hide LogTape's own INFO bootstrap noise; errors remain visible.
        lowestLevel: flags.verbose ? "warning" : "error",
      },
    ],
  });

  return lowest;
};
