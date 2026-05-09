import type { EnvFn, UrlFn } from "./schema.ts";

export const isUrlFn = (x: unknown): x is UrlFn => typeof x === "function";

export const isEnvFn = (x: unknown): x is EnvFn => typeof x === "function";
