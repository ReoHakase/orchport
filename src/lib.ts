/**
 * @module orchport/lib
 * Public surface for `orchport.config.ts`: `defineConfig` / `entry` and re-exported config types.
 */
import type {
  EnvFn,
  PortPickStrategy,
  RawConfig,
  RawConfigInput,
  UrlFn,
} from "./config/schema.ts";

export type {
  EntryConfig,
  EnvFn,
  PortPickStrategy,
  RawConfig,
  RawConfigInput,
  ResolvedEntryShape,
  UrlFn,
} from "./config/schema.ts";

/**
 * TypeScript config helper; returns the object unchanged at runtime.
 * Uses {@link RawConfigInput} so optional fields with Valibot defaults (`mode`, `sld`, `tld`, entry `range` / `strategy`, …) stay optional here.
 */
export const defineConfig = <
  const T extends RawConfigInput & {
    url?: UrlFn;
    env?: RawConfig["env"] | EnvFn;
  },
>(
  config: T
): T => config;

/** Entry value: `true` or `{}` → defaults (`range: auto`, `strategy: deterministic`, `strict: false`). */
export const entry = <
  const T extends
    | true
    | {
        range?: "auto" | readonly [number, number];
        strategy?: PortPickStrategy;
        strict?: boolean;
        switchable?: string | readonly string[];
      },
>(
  e: T
): T => e;
