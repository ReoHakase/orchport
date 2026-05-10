/**
 * @module orchport/core/resolve-session
 * Allocates ports, builds URLs, merges standard `ORCHPORT_*` env with interpolated user `env`.
 */
import { basename } from "node:path";

import { getLogger } from "@logtape/logtape";

import type { LoadedConfig, ResolvedProxyShape } from "../config/schema.ts";
import { normalizeConfigTld } from "../config/tld.ts";
import { interpolateEnvValues } from "../env/interpolate.ts";
import type { InterpolateCtx } from "../env/interpolate.ts";
import { pickPortInRange } from "../ports/allocate.ts";
import { isReservedOrchportEnvKey } from "../utils/env-keys.ts";
import { ErrorCode, OrchportError } from "../utils/errors.ts";
import {
  detectWorktreeName,
  getGitRepositoryBasename,
  resolveWorktreeHostPrefix,
} from "../utils/git.ts";
import { entryKeyToEnvPrefix } from "../utils/snake.ts";
import { pickEntryPort } from "./port-picker.ts";
import { buildEntryUrl } from "./url-builder.ts";
import { packageVersion } from "./version.ts";

const log = getLogger(["orchport", "resolve"]);

/** Inputs for one resolution pass (CLI `run` / `env`). */
export type ResolveOptions = {
  cwd: string;
  config: LoadedConfig;
  sldCli?: string;
  /** When set, overrides config `tld` after normalization (leading `.`). */
  tldCli?: string;
  worktreeCli?: string;
  runId: string;
  withProxy: boolean;
  /** When set, merge that proxy's `env` block after global `env` (`orchport run <name> -- …`). */
  runTarget?: string;
};

/** Fully resolved ports, URLs, and final `process.env`-style map (string values only). */
export type ResolvedSession = {
  /** Second-level hostname label (`ORCHPORT_SLD` / legacy `ORCHPORT_WORKSPACE`). */
  sld: string;
  /** Normalized config TLD suffix (e.g. `.localhost`). */
  tld: string;
  worktree: string;
  /** Same segment rules as built-in proxy hostnames (`web.main.repo` vs `web.repo`). */
  worktreeHostPrefix: string;
  mode: "local-port" | "local-proxy";
  proxies: Record<string, ResolvedProxyShape>;
  proxyPort?: number;
  env: Record<string, string>;
  configPath: string | null;
};

const defaultLocalUrl = (port: number): string => `http://localhost:${port}`;

const interpolateCtxBase = (
  rebuilt: Record<string, ResolvedProxyShape>,
  sld: string,
  tld: string,
  worktree: string,
  worktreeHostPrefix: string,
  proxyPort: number | undefined
): InterpolateCtx => ({
  sld,
  tld,
  worktree,
  worktreeHostPrefix,
  proxies: rebuilt,
  proxyPort,
});

/** Rebuild interpolation context from a resolved session (same ports/URLs as `session.env`). */
const interpolateCtxFromSession = (session: ResolvedSession): InterpolateCtx =>
  interpolateCtxBase(
    session.proxies,
    session.sld,
    session.tld,
    session.worktree,
    session.worktreeHostPrefix,
    session.proxyPort
  );

type StandardEnvParams = {
  runId: string;
  sld: string;
  tld: string;
  worktree: string;
  mode: "local-port" | "local-proxy";
  configPath: string | null;
  rebuilt: Record<string, ResolvedProxyShape>;
  proxyPort: number | undefined;
  config: LoadedConfig;
};

const buildStandardEnvBlock = (
  p: StandardEnvParams
): Record<string, string> => {
  const ver = packageVersion();
  const standard: Record<string, string> = {
    ORCHPORT: "1",
    ORCHPORT_VERSION: ver,
    ORCHPORT_RUN_ID: p.runId,
    ORCHPORT_SLD: p.sld,
    ORCHPORT_TLD: p.tld,
    ORCHPORT_WORKSPACE: p.sld,
    ORCHPORT_WORKTREE: p.worktree,
    ORCHPORT_MODE: p.mode,
    ORCHPORT_CONFIG: p.configPath ?? "",
  };

  const proxyNames = Object.keys(p.rebuilt).toSorted();
  for (const name of proxyNames) {
    const e = p.rebuilt[name];
    const prefix = entryKeyToEnvPrefix(name);
    standard[`ORCHPORT_${prefix}_PORT`] = String(e.port);
    standard[`ORCHPORT_${prefix}_HOST`] = e.host;
    standard[`ORCHPORT_${prefix}_URL`] = e.url;
    standard[`ORCHPORT_${prefix}_LOCAL_URL`] = e.localUrl;
  }

  if (p.proxyPort !== undefined) {
    standard.ORCHPORT_PROXY_PORT = String(p.proxyPort);
    const tls = p.config.proxy?.tls;
    const useTls =
      tls !== false &&
      (tls === "dev" || (typeof tls === "object" && tls !== null));
    if (useTls && p.config.proxy?.httpsPort !== false) {
      const pub =
        typeof p.config.proxy?.httpsPort === "number"
          ? p.config.proxy.httpsPort
          : 443;
      standard.ORCHPORT_HTTPS_PROXY_PORT = String(pub);
    }
  }

  return standard;
};

const resolveGlobalUserFlat = (
  config: LoadedConfig,
  ictx: InterpolateCtx,
  rebuilt: Record<string, ResolvedProxyShape>,
  sld: string,
  tld: string,
  worktree: string,
  worktreeHostPrefix: string
): Record<string, string> => {
  let userFlat: Record<string, string> = {};
  if (typeof config.env === "function") {
    const o = config.env({
      proxies: rebuilt,
      sld,
      tld,
      workspace: sld,
      worktree,
      worktreeHostPrefix,
    });
    for (const [k, val] of Object.entries(o)) {
      if (val === null) {
        continue;
      }
      userFlat[k] = typeof val === "string" ? val : String(val);
    }
  } else if (config.env) {
    userFlat = interpolateEnvValues(config.env, ictx);
  }
  return userFlat;
};

const mergeStandardWithUserFlat = (
  standard: Record<string, string>,
  userFlat: Record<string, string>,
  logReserved: boolean
): Record<string, string> => {
  const env: Record<string, string> = { ...standard };
  for (const [k, val] of Object.entries(userFlat)) {
    if (isReservedOrchportEnvKey(k)) {
      if (logReserved) {
        log.debug("Skipping reserved env override {key}", { key: k });
      }
      continue;
    }
    env[k] = val;
  }
  return env;
};

/**
 * Full env map per configured proxy: standard `ORCHPORT_*` + global `env` + that proxy's `env`
 * (same merge order as `resolveSession` with `runTarget` set).
 */
export const buildEnvByProxy = (
  session: ResolvedSession,
  config: LoadedConfig
): Record<string, Record<string, string>> => {
  const runId = session.env.ORCHPORT_RUN_ID ?? "";
  const standard = buildStandardEnvBlock({
    runId,
    sld: session.sld,
    tld: session.tld,
    worktree: session.worktree,
    mode: session.mode,
    configPath: session.configPath,
    rebuilt: session.proxies,
    proxyPort: session.proxyPort,
    config,
  });

  const ictx = interpolateCtxFromSession(session);
  const globalFlat = resolveGlobalUserFlat(
    config,
    ictx,
    session.proxies,
    session.sld,
    session.tld,
    session.worktree,
    session.worktreeHostPrefix
  );

  const proxyNames = Object.keys(config.proxies).toSorted();
  const out: Record<string, Record<string, string>> = {};

  for (const name of proxyNames) {
    const userFlat = { ...globalFlat };
    const pe = config.proxies[name]?.env;
    if (pe !== undefined) {
      const extra = interpolateEnvValues(pe, ictx);
      for (const [k, val] of Object.entries(extra)) {
        userFlat[k] = val;
      }
    }
    out[name] = mergeStandardWithUserFlat(standard, userFlat, false);
  }

  return out;
};

/**
 * Computes stable ports per proxy, optional reverse-proxy port, and merged environment.
 * User `env` cannot override reserved orchport keys (`ORCHPORT*`, legacy `orchport*`).
 */
export const resolveSession = async (
  options: ResolveOptions
): Promise<ResolvedSession> => {
  const { cwd, config, runId, withProxy } = options;
  const sldCli = options.sldCli?.trim() || undefined;
  const sld =
    sldCli ||
    config.sld?.trim() ||
    getGitRepositoryBasename(cwd) ||
    basename(cwd).replaceAll(/[^a-zA-Z0-9._-]+/g, "-") ||
    "app";
  const tldRaw = options.tldCli?.trim();
  const tld =
    tldRaw !== undefined && tldRaw !== ""
      ? normalizeConfigTld(tldRaw)
      : config.tld;
  const worktree =
    options.worktreeCli?.trim() ||
    config.worktree?.trim() ||
    detectWorktreeName(cwd);
  const worktreeHostPrefix = resolveWorktreeHostPrefix(worktree, cwd);

  log.debug(
    "Session identity sld={sld} tld={tld} worktree={worktree} hostPrefix={hostPrefix}",
    {
      sld,
      tld,
      worktree,
      hostPrefix: worktreeHostPrefix || "(empty)",
    }
  );

  const [pMin, pMax] = config.portRange ?? [43100, 43999];
  if (pMin > pMax) {
    throw new OrchportError(
      ErrorCode.PORT_RANGE,
      `portRange invalid: ${pMin}-${pMax}`,
      {
        hint: "Set portRange to [min, max] with min <= max (inclusive).",
        context: { min: String(pMin), max: String(pMax) },
      }
    );
  }
  log.trace("portRange {min}-{max}", { min: String(pMin), max: String(pMax) });

  const mode =
    withProxy || config.mode === "local-proxy" ? "local-proxy" : "local-port";
  log.debug("Resolve mode={mode} withProxy={withProxy}", {
    mode,
    withProxy: String(withProxy),
  });

  const used = new Set<number>();
  let proxyPort: number | undefined;

  if (mode === "local-proxy" || withProxy) {
    proxyPort = await pickPortInRange({
      sld,
      worktree,
      entryName: "__orchport_proxy__",
      min: pMin,
      max: pMax,
      avoid: used,
    });
    used.add(proxyPort);
    log.debug("Allocated proxy port {port}", { port: String(proxyPort) });
    log.debug("Proxy TLS config: {tls}", {
      tls:
        config.proxy?.tls === "dev"
          ? "dev"
          : config.proxy?.tls
            ? "file"
            : "none",
    });
  }

  const proxies: Record<string, ResolvedProxyShape> = {};
  const proxyNames = Object.keys(config.proxies).toSorted();

  for (const name of proxyNames) {
    const ec = config.proxies[name];
    /* eslint-disable-next-line no-await-in-loop */
    const port = await pickEntryPort({
      name,
      ec,
      pMin,
      pMax,
      used,
      sld,
      worktree,
    });
    used.add(port);

    const host = "localhost";
    const localUrl = defaultLocalUrl(port);
    proxies[name] = {
      name,
      port,
      host,
      url: `http://localhost:${port}`,
      localUrl,
    };
  }

  const rebuilt: Record<string, ResolvedProxyShape> = {};
  for (const name of proxyNames) {
    const cur = proxies[name];
    const url = buildEntryUrl({
      config,
      proxy: cur,
      sld,
      tld,
      worktree,
      worktreeHostPrefix,
      proxyPort,
    });
    rebuilt[name] = { ...cur, url };
    log.trace("Proxy {name} public url={url}", { name, url });
  }

  const rt = options.runTarget?.trim();
  if (rt !== undefined && rt !== "") {
    if (rebuilt[rt] === undefined) {
      throw new OrchportError(
        ErrorCode.RUN_UNKNOWN_PROXY,
        `Unknown proxy "${rt}" in config`,
        {
          hint: `Use one of: ${proxyNames.join(", ")}`,
          context: { proxy: rt },
        }
      );
    }
  }

  const standard = buildStandardEnvBlock({
    runId,
    sld,
    tld,
    worktree,
    mode,
    configPath: config.configPath ?? null,
    rebuilt,
    proxyPort,
    config,
  });

  const ictx = interpolateCtxBase(
    rebuilt,
    sld,
    tld,
    worktree,
    worktreeHostPrefix,
    proxyPort
  );

  let userFlat = resolveGlobalUserFlat(
    config,
    ictx,
    rebuilt,
    sld,
    tld,
    worktree,
    worktreeHostPrefix
  );

  if (rt !== undefined && rt !== "") {
    const pe = config.proxies[rt]?.env;
    if (pe !== undefined) {
      const extra = interpolateEnvValues(pe, ictx);
      for (const [k, val] of Object.entries(extra)) {
        userFlat[k] = val;
      }
    }
  }

  const env = mergeStandardWithUserFlat(standard, userFlat, true);

  log.debug(
    "Resolved session runId={runId} proxies={n} envKeys={k} proxyPort={proxy}",
    {
      runId,
      n: String(proxyNames.length),
      k: String(Object.keys(env).length),
      proxy: proxyPort !== undefined ? String(proxyPort) : "-",
    }
  );
  log.trace("Non-ORCHPORT env keys: {keys}", {
    keys: Object.keys(env)
      .filter((k) => !k.startsWith("ORCHPORT"))
      .toSorted()
      .join(" "),
  });

  return {
    sld,
    tld,
    worktree,
    worktreeHostPrefix,
    mode,
    proxies: rebuilt,
    proxyPort,
    env,
    configPath: config.configPath,
  };
};
