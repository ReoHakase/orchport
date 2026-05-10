import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getLogger } from "@logtape/logtape";
import { define } from "gunshi";

import { ErrorCode, OrchportError } from "../utils/errors.ts";
import { pickBoolean, pickString } from "../utils/pick.ts";

const log = getLogger(["orchport", "init"]);

const yamlTemplate = `sld: my-app
worktree: main
mode: local-port

proxies:
  web: true
  api: true

env:
  ORCHPORT_WEB_PORT: "\${proxies.web.port}"
  ORCHPORT_API_PORT: "\${proxies.api.port}"
  ORCHPORT_WEB_URL: "\${proxies.web.url}"
  ORCHPORT_API_URL: "\${proxies.api.url}"
  NEXT_PUBLIC_API_BASE_URL: "\${proxies.api.url}"
`;

const tsTemplate = `import { defineConfig } from "orchport";

export default defineConfig({
  sld: "my-app",
  mode: "local-port",
  proxies: {
    web: true,
    api: {},
  },
  env: ({ proxies }) => ({
    ORCHPORT_WEB_PORT: String(proxies.web.port),
    ORCHPORT_API_PORT: String(proxies.api.port),
    ORCHPORT_WEB_URL: proxies.web.url,
    ORCHPORT_API_URL: proxies.api.url,
    NEXT_PUBLIC_API_BASE_URL: proxies.api.url,
  }),
});
`;

const jsonTemplate = `{
  "sld": "my-app",
  "worktree": "main",
  "mode": "local-port",
  "proxies": {
    "web": true,
    "api": true
  },
  "env": {
    "ORCHPORT_WEB_PORT": "\${proxies.web.port}",
    "ORCHPORT_API_PORT": "\${proxies.api.port}",
    "ORCHPORT_WEB_URL": "\${proxies.web.url}",
    "ORCHPORT_API_URL": "\${proxies.api.url}",
    "NEXT_PUBLIC_API_BASE_URL": "\${proxies.api.url}"
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
        ErrorCode.INIT_EXISTS,
        `${name} already exists (use --force to overwrite)`,
        {
          hint: "Pass `--force` to replace the file, or remove it manually.",
          context: { path: target },
        }
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
