import { getLogger } from "@logtape/logtape";
import { cli, define } from "gunshi";
import { renderUsage } from "gunshi/renderer";

import { normalizeGlobalOptionArgv } from "./cli-argv.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { envCommand } from "./commands/env.ts";
import { globalOptionsPlugin } from "./commands/global-plugin.ts";
import { initCommand } from "./commands/init.ts";
import { killCommand } from "./commands/kill.ts";
import { listCommand } from "./commands/list.ts";
import { proxyCommand } from "./commands/proxy.ts";
import { runCommand } from "./commands/run.ts";
import { switchCommand } from "./commands/switch.ts";

const root = define({
  name: "orchport",
  description: "Non-interactive port and env resolver for multi-worktree dev",
  run: () => {
    /* default: subcommand required */
  },
});

const dispatchLog = getLogger(["orchport", "cli", "dispatch"]);

const renderOrchportUsage: typeof renderUsage = async (ctx) => {
  const usage = await renderUsage(ctx);
  return usage.replaceAll(/(^\s*)-v, --version/gm, "$1    --version");
};

export const runCli = (argv: string[]): Promise<string | undefined> => {
  const normalized = normalizeGlobalOptionArgv(argv);
  dispatchLog.debug("cli argv (normalized): {argv}", {
    argv: normalized.join(" "),
  });
  dispatchLog.trace("cli argv tokens: {tokens}", {
    tokens: JSON.stringify(normalized),
  });
  return cli(normalized, root, {
    name: "orchport",
    cwd: process.cwd(),
    renderHeader: null,
    renderUsage: renderOrchportUsage,
    // If you add a subcommand, update ORCHPORT_SUBCOMMAND_NAMES in cli-argv.ts
    subCommands: {
      run: runCommand,
      env: envCommand,
      init: initCommand,
      list: listCommand,
      kill: killCommand,
      doctor: doctorCommand,
      switch: switchCommand,
      proxy: proxyCommand,
    },
    plugins: [globalOptionsPlugin],
  });
};
