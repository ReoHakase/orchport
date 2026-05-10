import { plugin } from "gunshi/plugin";

/** Long options that take a separate argv token (`--config path` → `--config=path` before Gunshi dispatch). */
export const GLOBAL_STRING_OPTION_NAMES = new Set([
  "config",
  "sld",
  "tld",
  "worktree",
]);

/** Shared CLI flags: `--config`, `--sld`, `--tld`, `--worktree`, etc. */
export const globalOptionsPlugin = plugin({
  id: "orchport-globals",
  name: "Orchport global options",
  setup: (ctx) => {
    ctx.addGlobalOption("config", {
      type: "string",
      description: "Path to orchport config file",
    });
    ctx.addGlobalOption("sld", {
      type: "string",
      description:
        "Override SLD (hostname label before TLD, e.g. myapp in web.*.myapp.localhost)",
    });
    ctx.addGlobalOption("tld", {
      type: "string",
      description:
        "Override public hostname suffix (e.g. localhost or .test → normalized to .localhost / .test)",
    });
    ctx.addGlobalOption("worktree", {
      type: "string",
      description: "Override worktree name",
    });
    ctx.addGlobalOption("verbose", {
      type: "boolean",
      short: "v",
      description:
        "Log trace-level diagnostics to stderr (all orchport log categories)",
      default: false,
    });
    ctx.addGlobalOption("quiet", {
      type: "boolean",
      short: "q",
      description: "Only log warnings and errors",
      default: false,
    });
    ctx.addGlobalOption("no-color", {
      type: "boolean",
      description: "Disable ANSI colors in log output",
      default: false,
    });
    ctx.addGlobalOption("forceSwitch", {
      type: "boolean",
      toKebab: true,
      description:
        "Take over path switch slots owned by another worktree (orchport run only)",
      default: false,
    });
    ctx.addGlobalOption("json", {
      type: "boolean",
      description:
        "Print errors as JSON on stderr (machine-readable; friendly for scripts and agents)",
      default: false,
    });
  },
});
