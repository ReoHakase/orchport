/**
 * @module orchport/core/resolve-session
 * Allocates ports, builds URLs, merges standard `ORCHPORT_*` env with interpolated user `env`.
 */
import { basename } from "node:path";

import { getLogger } from "@logtape/logtape";

import type {
  EntryConfig,
  LoadedConfig,
  PortPickStrategy,
  ResolvedEntryShape,
} from "../config/schema.ts";
import { normalizeConfigTld } from "../config/tld.ts";
import { interpolateEnvValues } from "../env/interpolate.ts";
import type { InterpolateCtx } from "../env/interpolate.ts";
import { isLocalPortFree, pickPortInRange } from "../ports/allocate.ts";
import { isReservedOrchportEnvKey } from "../utils/env-keys.ts";
import { OrchportError } from "../utils/errors.ts";
import {
  detectWorktreeName,
  getGitRepositoryBasename,
  resolveWorktreeHostPrefix,
} from "../utils/git.ts";
import { entryKeyToEnvPrefix } from "../utils/snake.ts";
import { buildLocalProxyHost } from "./local-proxy-host.ts";
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
  entries: Record<string, ResolvedEntryShape>;
  proxyPort?: number;
  env: Record<string, string>;
  configPath: string | null;
};

const defaultLocalUrl = (port: number): string => `http://localhost:${port}`;

const pickEntryPort = async (options: {
  name: string;
  ec: EntryConfig;
  pMin: number;
  pMax: number;
  used: Set<number>;
  sld: string;
  worktree: string;
}): Promise<number> => {
  const { name, ec, pMin, pMax, used, sld, worktree } = options;
  const { range, strategy, strict } = ec;

  const pickIn = (min: number, max: number, strat: PortPickStrategy) =>
    pickPortInRange({
      sld,
      worktree,
      entryName: name,
      min,
      max,
      avoid: used,
      strategy: strat,
    });

  if (range === "auto") {
    const port = await pickIn(pMin, pMax, strategy);
    log.debug("Entry {name} auto-range port {port}", {
      name,
      port: String(port),
    });
    return port;
  }

  const [rMin, rMax] = range;
  if (rMin === rMax) {
    const p = rMin;
    if (used.has(p)) {
      throw new OrchportError(
        "PORT_TAKEN",
        `Port ${p} already assigned to another entry in this resolution`
      );
    }
    /* eslint-disable-next-line no-await-in-loop */
    if (await isLocalPortFree(p)) {
      log.debug("Entry {name} fixed port {port}", { name, port: String(p) });
      return p;
    }
    if (!strict) {
      log.warning(
        "Entry {name}: port {port} unavailable; falling back to global portRange (strict: false)",
        { name, port: String(p) }
      );
      const port = await pickIn(pMin, pMax, "deterministic");
      log.debug("Entry {name} fallback port {port}", {
        name,
        port: String(port),
      });
      return port;
    }
    throw new OrchportError(
      "PORT_IN_USE",
      `Requested port ${p} is not available`
    );
  }

  try {
    const port = await pickIn(rMin, rMax, strategy);
    log.debug("Entry {name} port {port} (range {min}-{max} strategy {strat})", {
      name,
      port: String(port),
      min: String(rMin),
      max: String(rMax),
      strat: strategy,
    });
    return port;
  } catch (err) {
    if (!strict) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warning(
        "Entry {name}: no free port in {min}-{max} ({msg}); falling back to global portRange",
        { name, min: String(rMin), max: String(rMax), msg }
      );
      const port = await pickIn(pMin, pMax, "deterministic");
      log.debug("Entry {name} fallback port {port}", {
        name,
        port: String(port),
      });
      return port;
    }
    throw new OrchportError(
      "PORT_RANGE",
      err instanceof Error ? err.message : String(err)
    );
  }
};

const buildEntryUrl = (options: {
  config: LoadedConfig;
  entry: ResolvedEntryShape;
  sld: string;
  tld: string;
  worktree: string;
  worktreeHostPrefix: string;
  proxyPort?: number;
}): string => {
  const { config, entry, sld, tld, worktree, worktreeHostPrefix, proxyPort } =
    options;
  const mode = config.mode ?? "local-port";

  if (typeof config.url === "function") {
    return config.url({
      entry,
      sld,
      tld,
      workspace: sld,
      worktree,
      worktreeHostPrefix,
      mode,
    });
  }

  if (mode === "local-proxy" && proxyPort) {
    const host = buildLocalProxyHost(entry.name, worktreeHostPrefix, sld, tld);
    const tls = config.proxy?.tls;
    const useTls =
      tls !== false &&
      (tls === "dev" || (typeof tls === "object" && tls !== null));
    if (!useTls) {
      return `http://${host}:${proxyPort}`;
    }
    /** Standard public port (443 default) when not opted out; main listener stays on `proxyPort`. */
    const hp = config.proxy?.httpsPort;
    if (hp === false) {
      return `https://${host}:${proxyPort}`;
    }
    const pub = typeof hp === "number" ? hp : 443;
    if (pub === 443) {
      return `https://${host}`;
    }
    return `https://${host}:${pub}`;
  }

  return `http://${entry.name}.${worktreeHostPrefix}${sld}${tld}:${entry.port}`;
};

/**
 * Computes stable ports per entry, optional proxy port, and merged environment.
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
    throw new OrchportError("PORT_RANGE", `portRange invalid: ${pMin}-${pMax}`);
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

  const entries: Record<string, ResolvedEntryShape> = {};
  const entryNames = Object.keys(config.entries).toSorted();
  if (entryNames.length === 0) {
    throw new OrchportError("CONFIG", "Config must define at least one entry");
  }

  for (const name of entryNames) {
    const ec = config.entries[name];
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
    entries[name] = {
      name,
      port,
      host,
      url: `http://localhost:${port}`,
      localUrl,
    };
  }

  const rebuilt: Record<string, ResolvedEntryShape> = {};
  for (const name of entryNames) {
    const cur = entries[name];
    const url = buildEntryUrl({
      config,
      entry: cur,
      sld,
      tld,
      worktree,
      worktreeHostPrefix,
      proxyPort,
    });
    rebuilt[name] = { ...cur, url };
    log.trace("Entry {name} public url={url}", { name, url });
  }

  const ver = packageVersion();
  const standard: Record<string, string> = {
    ORCHPORT: "1",
    ORCHPORT_VERSION: ver,
    ORCHPORT_RUN_ID: runId,
    ORCHPORT_SLD: sld,
    ORCHPORT_TLD: tld,
    ORCHPORT_WORKSPACE: sld,
    ORCHPORT_WORKTREE: worktree,
    ORCHPORT_MODE: mode,
    ORCHPORT_CONFIG: config.configPath ?? "",
  };

  for (const name of entryNames) {
    const e = rebuilt[name];
    const prefix = entryKeyToEnvPrefix(name);
    standard[`ORCHPORT_${prefix}_PORT`] = String(e.port);
    standard[`ORCHPORT_${prefix}_HOST`] = e.host;
    standard[`ORCHPORT_${prefix}_URL`] = e.url;
    standard[`ORCHPORT_${prefix}_LOCAL_URL`] = e.localUrl;
  }

  if (proxyPort !== undefined) {
    standard.ORCHPORT_PROXY_PORT = String(proxyPort);
    const tls = config.proxy?.tls;
    const useTls =
      tls !== false &&
      (tls === "dev" || (typeof tls === "object" && tls !== null));
    if (useTls && config.proxy?.httpsPort !== false) {
      const pub =
        typeof config.proxy?.httpsPort === "number"
          ? config.proxy.httpsPort
          : 443;
      standard.ORCHPORT_HTTPS_PROXY_PORT = String(pub);
    }
  }

  let userFlat: Record<string, string> = {};
  if (typeof config.env === "function") {
    const o = config.env({
      entries: rebuilt,
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
    userFlat = interpolateEnvValues(config.env, {
      sld,
      tld,
      worktree,
      worktreeHostPrefix,
      entries: rebuilt,
      proxyPort,
    } satisfies InterpolateCtx);
  }

  const env: Record<string, string> = { ...standard };
  for (const [k, val] of Object.entries(userFlat)) {
    if (isReservedOrchportEnvKey(k)) {
      log.debug("Skipping reserved env override {key}", { key: k });
      continue;
    }
    env[k] = val;
  }

  log.debug(
    "Resolved session runId={runId} entries={n} envKeys={k} proxyPort={proxy}",
    {
      runId,
      n: String(entryNames.length),
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
    entries: rebuilt,
    proxyPort,
    env,
    configPath: config.configPath,
  };
};
