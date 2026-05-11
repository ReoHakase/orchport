/**
 * @module orchport/lib
 * Public surface for `orchport.config.ts`: `defineConfig` / `proxy` and re-exported config types.
 */
export type PortPickStrategy = "deterministic" | "smaller" | "larger";

export type ProxyConfig = {
  range?: "auto" | readonly [number, number];
  strategy?: PortPickStrategy;
  strict?: boolean;
  switchables?: readonly string[];
  env?: Record<string, string | number | boolean | null>;
};

export type ResolvedProxyShape<Name extends string = string> = {
  name: Name;
  port: number;
  host: string;
  url: string;
  localUrl: string;
};

export type ProxyInput = true | ProxyConfig;

export type ResolvedProxyMap<Proxies extends Record<string, ProxyInput>> = {
  [K in keyof Proxies]: ResolvedProxyShape<Extract<K, string>>;
};

export type EnvValue = string | number | boolean | null;

export type UrlFn<
  Proxies extends Record<string, ProxyInput> = Record<string, ProxyInput>,
> = (ctx: {
  proxy: ResolvedProxyShape<Extract<keyof Proxies, string>>;
  sld: string;
  tld: string;
  worktree: string;
  worktreeHostPrefix: string;
  mode: "local-port" | "local-proxy";
}) => string;

export type EnvFn<
  Proxies extends Record<string, ProxyInput> = Record<string, ProxyInput>,
> = (ctx: {
  proxies: ResolvedProxyMap<Proxies>;
  sld: string;
  worktree: string;
  worktreeHostPrefix: string;
}) => Record<string, EnvValue>;

export type RawConfigInput<
  Proxies extends Record<string, ProxyInput> = Record<string, ProxyInput>,
> = {
  sld?: string;
  /** @deprecated Use `sld`. Merged when loading config. */
  workspace?: string;
  tld?: string;
  worktree?: string;
  portRange?: readonly [number, number];
  mode?: "local-port" | "local-proxy";
  proxy?: {
    port?: "auto" | number;
    httpsPort?: false | number;
    tls?: false | "dev" | { cert: string; key: string; ca?: string };
  };
  proxies: Proxies;
  url?: UrlFn<Proxies>;
  env?: Record<string, EnvValue> | EnvFn<Proxies>;
};

export type RawConfig<
  Proxies extends Record<string, ProxyInput> = Record<string, ProxyInput>,
> = RawConfigInput<Proxies>;

/**
 * TypeScript config helper; returns the object unchanged at runtime.
 * Uses {@link RawConfigInput} so optional fields with Valibot defaults stay optional here.
 */
export const defineConfig = <
  const Proxies extends Record<string, ProxyInput>,
  const T extends RawConfigInput<Proxies>,
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
