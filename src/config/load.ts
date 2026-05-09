/**
 * @module orchport/config/load
 * Discovers and loads `orchport.config.*`, YAML, JSON, or `package.json#orchport`.
 */
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import { getLogger } from "@logtape/logtape";
import * as v from "valibot";
import { parse as parseYaml } from "yaml";

import { OrchportError } from "../utils/errors.ts";
import { isRecord } from "../utils/pick.ts";
import { isEnvFn, isUrlFn } from "./guards.ts";
import { rawConfigSchema, type LoadedConfig } from "./schema.ts";
import { normalizeConfigTld } from "./tld.ts";

const log = getLogger(["orchport", "config"]);

const CONFIG_NAMES = [
  "orchport.config.ts",
  "orchport.config.mts",
  "orchport.config.js",
  "orchport.config.mjs",
  "orchport.yaml",
  "orchport.yml",
  "orchport.json",
] as const;

const parseJsonConfig = (text: string): unknown => JSON.parse(text);

const packageJsonHasOrchport = (pkgPath: string): boolean => {
  try {
    const j: unknown = parseJsonConfig(readFileSync(pkgPath, "utf8"));
    return isRecord(j) && isRecord(j.orchport);
  } catch {
    return false;
  }
};

const extractPackageOrchport = async (
  pkgPath: string
): Promise<Record<string, unknown>> => {
  const text = await readFile(pkgPath, "utf8");
  const j: unknown = parseJsonConfig(text);
  if (!isRecord(j) || !isRecord(j.orchport)) {
    throw new OrchportError(
      "CONFIG_PACKAGE",
      `package.json has no "orchport" field at ${pkgPath}`
    );
  }
  return j.orchport;
};

const loadModuleConfig = async (
  abs: string
): Promise<Record<string, unknown>> => {
  const url = pathToFileURL(abs).href;
  const mod = await import(url);
  const exp: unknown = mod.default;
  if (!isRecord(exp)) {
    throw new OrchportError(
      "CONFIG_EXPORT",
      `Config module must default-export an object: ${abs}`
    );
  }
  return exp;
};

const loadYamlConfig = (text: string): unknown => parseYaml(text);

const resolveConfigPath = (baseDir: string, p: string): string =>
  isAbsolute(p) ? p : join(baseDir, p);

/**
 * Walks up from `cwd` for known config filenames, or returns `explicit` (absolute or relative to cwd).
 */
export const findConfigPath = (
  cwd: string,
  explicit?: string
): string | null => {
  if (explicit) {
    return explicit.startsWith("/") ? explicit : join(cwd, explicit);
  }
  let dir = cwd;
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const p = join(dir, name);
      if (existsSync(p)) {
        return p;
      }
    }
    const pkg = join(dir, "package.json");
    if (existsSync(pkg) && packageJsonHasOrchport(pkg)) {
      return pkg;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
};

/**
 * Loads and validates config; preserves TS `url` / `env` functions without passing them through Valibot.
 */
export const loadConfig = async (options: {
  cwd: string;
  config?: string;
}): Promise<LoadedConfig> => {
  const resolved = findConfigPath(options.cwd, options.config);
  if (!resolved) {
    throw new OrchportError(
      "CONFIG_NOT_FOUND",
      "No orchport config found (orchport.yaml, orchport.config.ts, …)"
    );
  }

  log.debug("Loading config {path}", { path: resolved });
  let rawRoot: Record<string, unknown>;
  const fileName = resolved.split("/").pop() ?? "";

  if (fileName === "package.json") {
    rawRoot = await extractPackageOrchport(resolved);
  } else if (resolved.endsWith(".yaml") || resolved.endsWith(".yml")) {
    const text = await readFile(resolved, "utf8");
    const y: unknown = loadYamlConfig(text);
    if (!isRecord(y)) {
      throw new OrchportError("CONFIG_PARSE", "Invalid YAML config root");
    }
    rawRoot = y;
  } else if (resolved.endsWith(".json")) {
    const text = await readFile(resolved, "utf8");
    const j: unknown = parseJsonConfig(text);
    if (!isRecord(j)) {
      throw new OrchportError("CONFIG_PARSE", "Invalid JSON config root");
    }
    rawRoot = j;
  } else {
    log.debug("Importing TypeScript/JavaScript config module");
    rawRoot = await loadModuleConfig(resolved);
  }

  const forValibot: Record<string, unknown> = { ...rawRoot };
  if (isUrlFn(rawRoot.url)) {
    delete forValibot.url;
  }
  if (isEnvFn(rawRoot.env)) {
    delete forValibot.env;
  }
  const legacyWs = forValibot.workspace;
  const sldIn = forValibot.sld;
  if (
    legacyWs !== undefined &&
    sldIn !== undefined &&
    String(legacyWs).trim() !== String(sldIn).trim()
  ) {
    throw new OrchportError(
      "CONFIG",
      'Set only one of "sld" or legacy "workspace" (they must match if both are present)'
    );
  }
  if (sldIn === undefined && legacyWs !== undefined) {
    forValibot.sld = legacyWs;
  }
  delete forValibot.workspace;

  const parsedBase = v.parse(rawConfigSchema, forValibot);
  const parsed =
    parsedBase.mode === "local-proxy" && parsedBase.proxy?.tls === undefined
      ? {
          ...parsedBase,
          proxy: { ...parsedBase.proxy, tls: "dev" as const },
        }
      : parsedBase;
  log.debug("Config parsed mode={mode} entries={entries} proxy.tls={tls}", {
    mode: parsed.mode ?? "local-port",
    entries: Object.keys(parsed.entries).toSorted().join(","),
    tls:
      parsed.proxy?.tls === false
        ? "false"
        : parsed.proxy?.tls === "dev"
          ? "dev"
          : parsed.proxy?.tls
            ? "files"
            : "off",
  });
  const loaded: LoadedConfig = {
    ...parsed,
    tld: normalizeConfigTld(parsed.tld),
    configPath: resolved,
  };
  if (isUrlFn(rawRoot.url)) {
    loaded.url = rawRoot.url;
  }
  if (isEnvFn(rawRoot.env)) {
    loaded.env = rawRoot.env;
  }
  if (loaded.proxy?.tls && loaded.proxy.tls !== "dev") {
    const baseDir = dirname(resolved);
    const { tls } = loaded.proxy;
    loaded.proxy = {
      ...loaded.proxy,
      tls: {
        cert: resolveConfigPath(baseDir, tls.cert),
        key: resolveConfigPath(baseDir, tls.key),
        ca: tls.ca ? resolveConfigPath(baseDir, tls.ca) : undefined,
      },
    };
    log.trace("Resolved TLS paths relative to {base}", { base: baseDir });
  }
  log.trace("Loaded config hasCustomUrl={u} hasCustomEnvFn={e}", {
    u: String(typeof loaded.url === "function"),
    e: String(typeof loaded.env === "function"),
  });
  return loaded;
};
