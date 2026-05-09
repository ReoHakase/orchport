import { basename } from "node:path";

import { getLogger } from "@logtape/logtape";
import { define } from "gunshi";

import { loadConfig } from "../config/load.ts";
import { normalizeConfigTld } from "../config/tld.ts";
import { setSwitchTargetsFromConfig } from "../state/switch-registry.ts";
import { OrchportError } from "../utils/errors.ts";
import { getGitRepositoryBasename } from "../utils/git.ts";
import { pickString } from "../utils/pick.ts";

const log = getLogger(["orchport", "switch"]);

/**
 * Update switches.json so all `switchable` paths in the current config target the given worktree.
 */
export const switchCommand = define({
  name: "switch",
  description:
    "Route switchable paths (see config entries) to a worktree without restarting the proxy",
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
        "USAGE",
        "Usage: orchport switch <worktree-slug>"
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
      entries: config.entries,
    });
    if (keys.length === 0) {
      log.warning("switch: no switchable entries in config; nothing to update");
      process.stdout.write(
        "No entry defines `switchable` paths; nothing updated.\n"
      );
      return;
    }
    log.info("switch: updated {n} slot(s) -> worktree {wt}", {
      n: String(keys.length),
      wt: slug,
    });
    for (const k of keys) {
      process.stdout.write(`${k} -> ${slug}\n`);
    }
  },
});
