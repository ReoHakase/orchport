import { basename } from "node:path";

import { getLogger } from "@logtape/logtape";
import { define } from "gunshi";

import {
  bold,
  cliUseColor,
  formatNextLine,
  formatRouteLine,
  statusIcon,
  type CliUiOptions,
} from "../cli/format.ts";
import { loadConfig } from "../config/load.ts";
import { normalizeConfigTld } from "../config/tld.ts";
import { listRunStates } from "../state/store.ts";
import {
  readSwitchRegistry,
  setSwitchTargetsFromConfig,
} from "../state/switch-registry.ts";
import { ErrorCode, OrchportError } from "../utils/errors.ts";
import { getGitRepositoryBasename } from "../utils/git.ts";
import { pickBoolean, pickString } from "../utils/pick.ts";
import { formatSwitchableRoutes } from "./switchable-output.ts";

const log = getLogger(["orchport", "switch"]);

/**
 * Update switches.json so all `switchables` paths in the current config target the given worktree.
 */
export const switchCommand = define({
  name: "switch",
  description:
    "Route switchables paths (see config proxies) to a worktree without restarting the proxy",
  args: {
    targetWorktree: {
      type: "positional",
      description: "Worktree slug (e.g. feature-auth)",
    },
  },
  run: async (ctx) => {
    const cwd = ctx.env.cwd ?? process.cwd();
    const slug = pickString(ctx.values, "targetWorktree")?.trim();
    if (slug === undefined || slug === "") {
      throw new OrchportError(
        ErrorCode.CLI_USAGE,
        "Usage: orchport switch <worktree-slug>",
        {
          hint: "Example: `orchport switch feature-auth`",
        }
      );
    }
    const config = await loadConfig({
      cwd,
      config: pickString(ctx.values, "config"),
    });
    const sld =
      pickString(ctx.values, "sld")?.trim() ||
      config.sld?.trim() ||
      getGitRepositoryBasename(cwd) ||
      basename(cwd).replaceAll(/[^a-zA-Z0-9._-]+/g, "-") ||
      "app";
    const tldRaw = pickString(ctx.values, "tld")?.trim();
    const tld =
      tldRaw !== undefined && tldRaw !== ""
        ? normalizeConfigTld(tldRaw)
        : config.tld;
    const keys = await setSwitchTargetsFromConfig({
      sld,
      tld,
      targetWorktree: slug,
      proxies: config.proxies,
    });
    const ui: CliUiOptions = {
      color: cliUseColor(process.stdout, {
        noColor: pickBoolean(ctx.values, "noColor") ?? false,
      }),
    };
    if (keys.length === 0) {
      log.warning("switch: no switchables in config; nothing to update");
      process.stdout.write(
        `${statusIcon("warn", ui)} No proxy defines \`switchables\` paths; nothing updated.\n`
      );
      process.stdout.write(
        formatNextLine(
          "add `switchables` paths to a proxy in your orchport config.",
          ui
        )
      );
      return;
    }
    log.info("switch: updated {n} slot(s) -> worktree {wt}", {
      n: String(keys.length),
      wt: slug,
    });
    process.stdout.write(
      `${statusIcon("ok", ui)} switch updated ${keys.length} route${keys.length === 1 ? "" : "s"}\n`
    );
    process.stdout.write(`${bold("target", ui)} ${slug}\n\n`);
    const registry = await readSwitchRegistry();
    const states = await listRunStates();
    const routes = formatSwitchableRoutes(registry, states, { keys });
    for (const route of routes) {
      process.stdout.write(formatRouteLine(route, ui));
    }
    process.stdout.write(
      formatNextLine(
        "ensure the target worktree has a matching `orchport run` state, or requests return 502.",
        ui
      )
    );
  },
});
