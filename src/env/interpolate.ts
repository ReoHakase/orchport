/**
 * @module orchport/env/interpolate
 * Template substitution for config `env` values: `${entries.web.port}` or shorthand `${web.port}` (when the entry name does not shadow `sld`, `tld`, `worktree`, …). `${workspace}` is an alias for `${sld}`.
 */
import { OrchportError } from "../utils/errors.ts";
import { isRecord } from "../utils/pick.ts";

export type InterpolateEntries = Record<
  string,
  { port: number; url: string; localUrl: string }
>;

export type InterpolateCtx = {
  sld: string;
  tld: string;
  worktree: string;
  worktreeHostPrefix: string;
  entries: InterpolateEntries;
  proxyPort?: number;
};

const dotPath = (obj: unknown, path: string): unknown => {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) {
      return undefined;
    }
    if (!isRecord(cur)) {
      return undefined;
    }
    cur = cur[p];
  }
  return cur;
};

/** Root keys reserved for the interpolation context; entry names equal to these use only `${entries.<name>.*}`. */
const RESERVED_TEMPLATE_ROOT_KEYS = new Set([
  "sld",
  "tld",
  "workspace",
  "worktree",
  "worktreeHostPrefix",
  "entries",
  "proxyPort",
]);

export const buildInterpolateRoot = (
  ctx: InterpolateCtx
): Record<string, unknown> => {
  const root: Record<string, unknown> = {
    sld: ctx.sld,
    tld: ctx.tld,
    workspace: ctx.sld,
    worktree: ctx.worktree,
    worktreeHostPrefix: ctx.worktreeHostPrefix,
    entries: ctx.entries,
    proxyPort: ctx.proxyPort,
  };
  for (const [name, shape] of Object.entries(ctx.entries)) {
    if (!RESERVED_TEMPLATE_ROOT_KEYS.has(name)) {
      root[name] = shape;
    }
  }
  return root;
};

/**
 * Interpolate `${entries.web.port}` or `${web.port}`-style templates against a plain context object.
 */
export const interpolateString = (
  template: string,
  root: Record<string, unknown>
): string =>
  template.replaceAll(/\$\{([^}]+)\}/g, (_, expr: string) => {
    const trimmed = expr.trim();
    const v = dotPath(root, trimmed);
    if (v === undefined || v === null) {
      throw new OrchportError(
        "INTERPOLATE",
        `Missing template value for \${${trimmed}}`
      );
    }
    return String(v);
  });

/** Resolves every non-null config `env` value to a string using `InterpolateCtx`. */
export const interpolateEnvValues = (
  env: Record<string, string | number | boolean | null>,
  ctx: InterpolateCtx
): Record<string, string> => {
  const root = buildInterpolateRoot(ctx);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(env)) {
    if (val === null) {
      continue;
    }
    const s = typeof val === "string" ? val : String(val);
    out[k] = interpolateString(s, root);
  }
  return out;
};
