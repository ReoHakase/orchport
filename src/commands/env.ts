import { getLogger } from "@logtape/logtape";
import { define } from "gunshi";

import { cliUseColor } from "../cli/format.ts";
import { loadConfig } from "../config/load.ts";
import { buildEnvByProxy, resolveSession } from "../core/resolve-session.ts";
import { ErrorCode, OrchportError } from "../utils/errors.ts";
import { pickBoolean, pickString, pickStringArray } from "../utils/pick.ts";
import { newRunId } from "../utils/run-id.ts";
import {
  splitEnvSections,
  writePerProxyEnvTables,
  type EnvSection,
} from "./env-table.ts";

const log = getLogger(["orchport", "env"]);

const shellQuote = (s: string): string => {
  if (!/[^\w@%+=:,./-]/i.test(s)) {
    return s;
  }
  return `'${s.replaceAll("'", `'\\''`)}'`;
};

const envKeyRe = /^[A-Za-z_][A-Za-z0-9_]*$/;

const dotenvQuote = (s: string): string => {
  if (s !== "" && !/[\s#"'\\\n\r]/.test(s)) {
    return s;
  }
  return `"${s
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll('"', '\\"')}"`;
};

type EnvLineFormat = "dotenv" | "plain" | "shell";

const writeEnvLines = (
  env: Record<string, string>,
  format: EnvLineFormat
): void => {
  for (const [key, val] of Object.entries(env)) {
    if (format !== "plain" && !envKeyRe.test(key)) {
      throw new OrchportError(
        ErrorCode.CLI_USAGE,
        `Cannot print ${format} output for invalid environment key "${key}"`,
        {
          hint: "Use `--json` or rename the key to a shell-compatible identifier.",
          context: { key },
        }
      );
    }
    if (format === "shell") {
      process.stdout.write(`export ${key}=${shellQuote(val)}\n`);
    } else if (format === "dotenv") {
      process.stdout.write(`${key}=${dotenvQuote(val)}\n`);
    } else {
      process.stdout.write(`${key}=${val}\n`);
    }
  }
};

const nestedEnvJson = (
  sections: readonly EnvSection[]
): {
  global: Record<string, string>;
  proxies: Record<string, Record<string, string>>;
} => {
  const out: {
    global: Record<string, string>;
    proxies: Record<string, Record<string, string>>;
  } = { global: {}, proxies: {} };
  for (const section of sections) {
    if (section.name === "global") {
      out.global = section.env;
    } else {
      out.proxies[section.name] = section.env;
    }
  }
  return out;
};

/**
 * Print resolved env. With `env <proxy>`, output the exact env injected by `run <proxy>`.
 * Without a proxy target, script/piped output is a flat generated env stream; TTY table output remains per-proxy.
 */
export const envCommand = define({
  name: "env",
  description: "Print resolved environment variables (no command run)",
  args: {
    proxy: {
      type: "boolean",
      description: "Allocate proxy port (local-proxy URLs)",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Print as JSON object",
      default: false,
    },
    shell: {
      type: "boolean",
      description: "Print export lines for sh",
      default: false,
    },
    dotenv: {
      type: "boolean",
      description: "Print KEY=value lines",
      default: false,
    },
    plain: {
      type: "boolean",
      description:
        "Print KEY=value lines even on a terminal (default is a colored table on TTY)",
      default: false,
    },
    target: {
      type: "positional",
      multiple: true,
      description: "Optional proxy name to print the exact run-target env",
    },
  },
  run: async (ctx) => {
    const cwd = ctx.env.cwd ?? process.cwd();
    const values = ctx.values;
    log.debug("env: resolving (cwd={cwd})", { cwd });
    log.debug(
      "env: flags json={json} shell={shell} dotenv={dotenv} plain={plain} proxyFlag={proxy}",
      {
        json: String(pickBoolean(values, "json") ?? false),
        shell: String(pickBoolean(values, "shell") ?? false),
        dotenv: String(pickBoolean(values, "dotenv") ?? false),
        plain: String(pickBoolean(values, "plain") ?? false),
        proxy: String(pickBoolean(values, "proxy") ?? false),
      }
    );
    const config = await loadConfig({
      cwd,
      config: pickString(values, "config"),
    });
    const targets = pickStringArray(values, "target") ?? [];
    if (targets.length > 1) {
      throw new OrchportError(
        ErrorCode.CLI_USAGE,
        `env accepts at most one proxy name, got ${targets.length}`,
        {
          hint: "Use `orchport env <proxy>` with one configured proxy name.",
          context: {
            proxies: Object.keys(config.proxies).toSorted().join(", "),
          },
        }
      );
    }
    const target = targets[0]?.trim() || undefined;
    if (target !== undefined && config.proxies[target] === undefined) {
      throw new OrchportError(
        ErrorCode.RUN_UNKNOWN_PROXY,
        `Unknown proxy "${target}" in config`,
        {
          hint: `Use one of: ${Object.keys(config.proxies).toSorted().join(", ")}`,
          context: { proxy: target },
        }
      );
    }
    const withProxy =
      config.mode === "local-proxy" || (pickBoolean(values, "proxy") ?? false);
    log.debug("env: withProxy={withProxy} config.mode={mode}", {
      withProxy: String(withProxy),
      mode: config.mode ?? "local-port",
    });
    const sldCli = pickString(values, "sld");
    const session = await resolveSession({
      cwd,
      config,
      sldCli,
      tldCli: pickString(values, "tld"),
      worktreeCli: pickString(values, "worktree"),
      runId: newRunId(),
      withProxy,
      runTarget: target,
    });
    log.debug("env: done runId={runId} keys={n} mode={mode} sld={sld}", {
      runId: session.env.ORCHPORT_RUN_ID ?? "",
      n: String(Object.keys(session.env).length),
      mode: session.mode,
      sld: session.sld,
    });
    log.trace("env: ORCHPORT_* keys {keys}", {
      keys: Object.keys(session.env)
        .filter((k) => k.startsWith("ORCHPORT"))
        .toSorted()
        .join(" "),
    });

    const jsonOut = pickBoolean(values, "json") ?? false;
    const shellOut = pickBoolean(values, "shell") ?? false;
    const dotenvOut = pickBoolean(values, "dotenv") ?? false;
    const plainOut = pickBoolean(values, "plain") ?? false;
    const lineFormat: EnvLineFormat = shellOut
      ? "shell"
      : dotenvOut
        ? "dotenv"
        : "plain";
    const proxyMeta = Object.fromEntries(
      Object.entries(session.proxies).map(([name, proxy]) => [
        name,
        { url: proxy.url, localUrl: proxy.localUrl },
      ])
    );

    if (target !== undefined) {
      if (jsonOut) {
        process.stdout.write(`${JSON.stringify(session.env, null, 2)}\n`);
        return;
      }
      if (shellOut || dotenvOut || plainOut || process.stdout.isTTY !== true) {
        writeEnvLines(session.env, lineFormat);
        return;
      }
      const useColor = cliUseColor(process.stdout, {
        noColor: pickBoolean(values, "noColor") ?? false,
      });
      writePerProxyEnvTables(
        { [target]: session.env },
        {
          useColor,
          split: false,
          header: {
            command: `orchport env ${target}`,
            mode: session.mode,
            workspace: session.sld,
            worktree: session.worktree,
          },
          proxies: proxyMeta,
        }
      );
      return;
    }

    const envByProxy = buildEnvByProxy(session, config);
    const sections = splitEnvSections(envByProxy, { proxies: proxyMeta });

    if (jsonOut) {
      process.stdout.write(
        `${JSON.stringify(nestedEnvJson(sections), null, 2)}\n`
      );
      return;
    }
    if (shellOut || dotenvOut || plainOut || process.stdout.isTTY !== true) {
      writeEnvLines(session.env, lineFormat);
      return;
    }
    const tty = process.stdout.isTTY === true;
    const useTable = tty;
    if (useTable) {
      const useColor = cliUseColor(process.stdout, {
        noColor: pickBoolean(values, "noColor") ?? false,
      });
      writePerProxyEnvTables(envByProxy, {
        useColor,
        header: {
          mode: session.mode,
          workspace: session.sld,
          worktree: session.worktree,
        },
        proxies: proxyMeta,
      });
      return;
    }
  },
});
