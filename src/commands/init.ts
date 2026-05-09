import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getLogger } from "@logtape/logtape";
import { define } from "gunshi";

import { OrchportError } from "../utils/errors.ts";
import { pickBoolean, pickString } from "../utils/pick.ts";

const log = getLogger(["orchport", "init"]);

const yamlTemplate = `sld: my-app
worktree: main
mode: local-port

entries:
  web: true
  api: true

env:
  ORCHPORT_WEB_PORT: "\${entries.web.port}"
  ORCHPORT_API_PORT: "\${entries.api.port}"
  ORCHPORT_WEB_URL: "\${entries.web.url}"
  ORCHPORT_API_URL: "\${entries.api.url}"
  NEXT_PUBLIC_API_BASE_URL: "\${entries.api.url}"
`;

const tsTemplate = `import { defineConfig } from "orchport";

export default defineConfig({
  sld: "my-app",
  mode: "local-port",
  entries: {
    web: true,
    api: {},
  },
  env: ({ entries }) => ({
    ORCHPORT_WEB_PORT: String(entries.web.port),
    ORCHPORT_API_PORT: String(entries.api.port),
    ORCHPORT_WEB_URL: entries.web.url,
    ORCHPORT_API_URL: entries.api.url,
    NEXT_PUBLIC_API_BASE_URL: entries.api.url,
  }),
});
`;

const jsonTemplate = `{
  "sld": "my-app",
  "worktree": "main",
  "mode": "local-port",
  "entries": {
    "web": true,
    "api": true
  },
  "env": {
    "ORCHPORT_WEB_PORT": "\${entries.web.port}",
    "ORCHPORT_API_PORT": "\${entries.api.port}",
    "ORCHPORT_WEB_URL": "\${entries.web.url}",
    "ORCHPORT_API_URL": "\${entries.api.url}",
    "NEXT_PUBLIC_API_BASE_URL": "\${entries.api.url}"
  }
}
`;

/** Writes `orchport.yaml` / `orchport.json` / `orchport.config.ts` starter with sample `ORCHPORT_*` env keys. */
export const initCommand = define({
  name: "init",
  description: "Create an orchport config file in the current directory",
  args: {
    format: {
      type: "enum",
      choices: ["ts", "yaml", "json"] as const,
      default: "yaml",
      description: "Config format",
    },
    force: {
      type: "boolean",
      description: "Overwrite existing file",
      default: false,
    },
  },
  run: async (ctx) => {
    const cwd = ctx.env.cwd ?? process.cwd();
    const formatRaw = pickString(ctx.values, "format");
    const format: "ts" | "yaml" | "json" =
      formatRaw === "ts" || formatRaw === "yaml" || formatRaw === "json"
        ? formatRaw
        : "yaml";
    const force = pickBoolean(ctx.values, "force") ?? false;

    const name =
      format === "ts"
        ? "orchport.config.ts"
        : format === "yaml"
          ? "orchport.yaml"
          : "orchport.json";
    const target = join(cwd, name);
    if (existsSync(target) && !force) {
      throw new OrchportError(
        "INIT_EXISTS",
        `${name} already exists (use --force to overwrite)`
      );
    }

    const body =
      format === "ts"
        ? tsTemplate
        : format === "yaml"
          ? yamlTemplate
          : jsonTemplate;
    log.info("init: writing {target} format={format}", {
      target,
      format,
    });
    await writeFile(target, body, "utf8");
    process.stdout.write(`Wrote ${target}\n`);
  },
});
