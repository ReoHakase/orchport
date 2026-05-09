import * as v from "valibot";

import { normalizeSwitchPattern } from "../proxy/path-match.ts";

export const portPickStrategies = [
  "deterministic",
  "smaller",
  "larger",
] as const;
export type PortPickStrategy = (typeof portPickStrategies)[number];

/** Inclusive port range for probing `[min, max]` (or fixed port when `min === max`). */
const entryPortRangeTuple = v.pipe(
  v.tuple([
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(65535)),
  ]),
  v.check(
    (t): t is [number, number] => t[0] <= t[1],
    "Entry port range: min must be <= max"
  )
);

const rangeValue = v.union([v.literal("auto"), entryPortRangeTuple]);

const switchableInput = v.optional(v.union([v.string(), v.array(v.string())]));

const entryObjectInput = v.strictObject({
  range: v.optional(rangeValue, "auto"),
  strategy: v.optional(v.picklist(portPickStrategies), "deterministic"),
  strict: v.optional(v.boolean(), false),
  /** Path patterns (exact or `/prefix/*`) routed to the worktree in switches.json (OAuth callbacks, etc.). */
  switchable: switchableInput,
});

const entryInput = v.union([v.literal(true), entryObjectInput]);

export type EntryConfig = {
  range: "auto" | [number, number];
  strategy: PortPickStrategy;
  strict: boolean;
  /** Normalized path patterns for path-based proxy switching. */
  switchable?: string[];
};

const normalizeSwitchableField = (
  raw: string | string[] | undefined
): string[] | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  const list = Array.isArray(raw) ? raw : [raw];
  const out = list.map((p) => normalizeSwitchPattern(p));
  return out.length > 0 ? out : undefined;
};

export const entrySchema = v.pipe(
  entryInput,
  v.transform((input): EntryConfig => {
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
      switchable: normalizeSwitchableField(input.switchable),
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
      port: v.optional(v.union([v.literal("auto"), v.number()])),
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
  entries: v.record(v.string(), entrySchema),
  env: v.optional(
    v.record(
      v.string(),
      v.union([v.string(), v.number(), v.boolean(), v.null()])
    )
  ),
});

/** After `v.parse` / load (defaults applied). */
export type RawConfig = v.InferOutput<typeof rawConfigSchema>;

/** What users may pass in `orchport.config.ts` before defaults (e.g. `mode` optional). */
export type RawConfigInput = v.InferInput<typeof rawConfigSchema> & {
  /** @deprecated Use `sld`. Merged when loading config. */
  workspace?: string;
};

export type ResolvedEntryShape = {
  name: string;
  port: number;
  host: string;
  url: string;
  localUrl: string;
};

export type UrlFn = (ctx: {
  entry: ResolvedEntryShape;
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
  entries: Record<string, ResolvedEntryShape>;
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
