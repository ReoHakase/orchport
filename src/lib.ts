/**
 * @module orchport/lib
 * Public surface for `orchport.config.ts`: `defineConfig` / `proxy` and re-exported config types.
 */
import type {
  EnvFn,
  PortPickStrategy,
  RawConfig,
  RawConfigInput,
  UrlFn,
} from "./config/schema.ts";

export type {
  EnvFn,
  PortPickStrategy,
  ProxyConfig,
  RawConfig,
  RawConfigInput,
  ResolvedProxyShape,
  UrlFn,
} from "./config/schema.ts";

/**
 * TypeScript config helper; returns the object unchanged at runtime.
 * Uses {@link RawConfigInput} so optional fields with Valibot defaults stay optional here.
 */
export const defineConfig = <
  const T extends RawConfigInput & {
    url?: UrlFn;
    env?: RawConfig["env"] | EnvFn;
  },
>(
  config: T
): T => config;

/** Proxy value: `true` or `{}` → defaults (`range: auto`, `strategy: deterministic`, `strict: false`). */
export const proxy = <
  const T extends
    | true
    | {
        range?: "auto" | readonly [number, number];
        strategy?: PortPickStrategy;
        strict?: boolean;
        switchables?: readonly string[];
        env?: Record<string, string | number | boolean | null>;
      },
>(
  p: T
): T => p;
