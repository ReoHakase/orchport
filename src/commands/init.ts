import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getLogger } from "@logtape/logtape";
import { define } from "gunshi";

import { ErrorCode, OrchportError } from "../utils/errors.ts";
import { pickBoolean, pickString } from "../utils/pick.ts";

const log = getLogger(["orchport", "init"]);

const yamlTemplate = `sld: my-app
mode: local-proxy

proxy:
  tls: dev
  httpsPort: false

proxies:
  web: true
  api:
    switchables:
      - "/auth/callback/*"

env:
  APP_BASE_URL: "\${web.url}"
  NEXT_PUBLIC_API_BASE_URL: "\${api.url}"
  API_PUBLIC_URL: "\${api.url}"
`;

const tsTemplate = `import { defineConfig } from "orchport";

export default defineConfig({
  sld: "my-app",
  mode: "local-proxy",
  proxy: {
    tls: "dev",
    httpsPort: false,
  },
  proxies: {
    web: true,
    api: {
      switchables: ["/auth/callback/*"],
    },
  },
  env: {
    APP_BASE_URL: "\${web.url}",
    NEXT_PUBLIC_API_BASE_URL: "\${api.url}",
    API_PUBLIC_URL: "\${api.url}",
  },
});
`;

const jsonTemplate = `{
  "sld": "my-app",
  "mode": "local-proxy",
  "proxy": {
    "tls": "dev",
    "httpsPort": false
  },
  "proxies": {
    "web": true,
    "api": {
      "switchables": ["/auth/callback/*"]
    }
  },
  "env": {
    "APP_BASE_URL": "\${web.url}",
    "NEXT_PUBLIC_API_BASE_URL": "\${api.url}",
    "API_PUBLIC_URL": "\${api.url}"
  }
}
`;

/** Writes `orchport.yaml` / `orchport.json` / `orchport.config.ts` starter config. */
export const initCommand = define({
  name: "init",
  description: "Create an orchport config file in the current directory",
  examples: `
# Default YAML: writes orchport.yaml
orchport init

# JSON: writes orchport.json
orchport init --format json

# TypeScript: writes orchport.config.ts
orchport init --format ts

# Replace an existing config
orchport init --format ts --force
  `.trim(),
  args: {
    format: {
      type: "enum",
      choices: ["ts", "yaml", "json"] as const,
      default: "yaml",
      description:
        "Config format to write: yaml -> orchport.yaml, json -> orchport.json, ts -> orchport.config.ts",
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
