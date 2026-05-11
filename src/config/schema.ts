import * as v from "valibot";

import { normalizeSwitchPattern } from "../proxy/path-match.ts";

export const portPickStrategies = [
  "deterministic",
  "smaller",
  "larger",
] as const;
export type PortPickStrategy = (typeof portPickStrategies)[number];

/** Inclusive port range for probing `[min, max]` (or fixed port when `min === max`). */
const proxyPortRangeTuple = v.pipe(
  v.tuple([
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
  ]),
  v.check(
    (t): t is [number, number] => t[0] <= t[1],
    "Proxy port range: min must be <= max"
  )
);

const rangeValue = v.union([v.literal("auto"), proxyPortRangeTuple]);

const envRecord = v.record(
  v.string(),
  v.union([v.string(), v.number(), v.boolean(), v.null()])
);

const proxyObjectInput = v.strictObject({
  range: v.optional(rangeValue, "auto"),
  strategy: v.optional(v.picklist(portPickStrategies), "deterministic"),
  strict: v.optional(v.boolean(), false),
  /** Path patterns (exact or `/prefix/*`) for path-based proxy switching; always an array in config. */
  switchables: v.optional(v.array(v.string())),
  env: v.optional(envRecord),
});

const proxyInput = v.union([v.literal(true), proxyObjectInput]);

export type ProxyConfig = {
  range: "auto" | [number, number];
  strategy: PortPickStrategy;
  strict: boolean;
  /** Normalized path patterns for path-based proxy switching. */
  switchables?: string[];
  env?: Record<string, string | number | boolean | null>;
};

const normalizeSwitchablesField = (
  raw: string[] | undefined
): string[] | undefined => {
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  const out = raw.map((p) => normalizeSwitchPattern(p));
  return out.length > 0 ? out : undefined;
};

export const proxySchema = v.pipe(
  proxyInput,
  v.transform((input): ProxyConfig => {
    if (input === true) {
      return {
        range: "auto",
        strategy: "deterministic",
        strict: false,
      };
    }
    return {
      range: input.range ?? "auto",
      strategy: input.strategy ?? "deterministic",
      strict: input.strict ?? false,
      switchables: normalizeSwitchablesField(input.switchables),
      ...(input.env !== undefined ? { env: input.env } : {}),
    };
  })
);

export const rawConfigSchema = v.object({
  /** Second-level label in `*.${sld}<tld>` hostnames (legacy key: `workspace`). */
  sld: v.optional(v.string()),
  /**
   * Public suffix for built-in hostnames (leading `.` optional in config).
   * Default `.localhost` (e.g. `web.main.myapp.localhost`).
   */
  tld: v.optional(v.string()),
  worktree: v.optional(v.string()),
  portRange: v.optional(
    v.tuple([
      v.pipe(v.number(), v.integer(), v.minValue(1)),
      v.pipe(v.number(), v.integer(), v.minValue(1)),
    ])
  ),
  mode: v.optional(
    v.picklist(["local-port", "local-proxy"] as const),
    "local-port"
  ),
  proxy: v.optional(
    v.object({
      port: v.optional(
        v.union([
          v.literal("auto"),
          v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
        ])
      ),
      /** Extra listener port; omit + TLS active → try **443**. `false` skips the extra listener. */
      httpsPort: v.optional(
        v.union([
          v.literal(false),
          v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
        ])
      ),
      /** Omit on `local-proxy` → default **`dev`**. Set **`false`** for plain HTTP on the proxy. */
      tls: v.optional(
        v.union([
          v.literal(false),
          v.literal("dev"),
          v.object({
            cert: v.string(),
            key: v.string(),
            ca: v.optional(v.string()),
          }),
        ])
      ),
    })
  ),
  proxies: v.pipe(
    v.record(v.string(), proxySchema),
    v.check(
      (r: Record<string, ProxyConfig>) => Object.keys(r).length > 0,
      "Config must define at least one key under `proxies:`"
    )
  ),
  env: v.optional(envRecord),
});

/** After `v.parse` / load (defaults applied). */
export type RawConfig = v.InferOutput<typeof rawConfigSchema>;

/** What users may pass in `orchport.config.ts` before defaults (e.g. `mode` optional). */
export type RawConfigInput = v.InferInput<typeof rawConfigSchema> & {
  /** @deprecated Use `sld`. Merged when loading config. */
  workspace?: string;
};

export type ResolvedProxyShape = {
  name: string;
  port: number;
  host: string;
  url: string;
  localUrl: string;
};

export type UrlFn = (ctx: {
  proxy: ResolvedProxyShape;
  sld: string;
  tld: string;
  worktree: string;
  /** `${worktree}.` or `""` when the hostname omits the worktree segment (on origin default branch). */
  worktreeHostPrefix: string;
  mode: "local-port" | "local-proxy";
  /** @deprecated Same as {@link sld}. */
  workspace: string;
}) => string;

export type EnvFn = (ctx: {
  proxies: Record<string, ResolvedProxyShape>;
  sld: string;
  tld: string;
  worktree: string;
  worktreeHostPrefix: string;
  /** @deprecated Same as {@link sld}. */
  workspace: string;
}) => Record<string, string | number | boolean | null>;

export type LoadedConfig = Omit<RawConfig, "env" | "tld"> & {
  /** Normalized TLD suffix (always starts with `.`), e.g. `.localhost`. */
  tld: string;
  /** Absolute path to config file, if any */
  configPath: string | null;
  /** TypeScript config only; overrides built-in URL rules. */
  url?: UrlFn;
  env?: RawConfig["env"] | EnvFn;
};
