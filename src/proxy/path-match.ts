/**
 * @module orchport/proxy/path-match
 * Predictable path patterns for `switchable`: exact path or `/prefix/*` (single trailing wildcard).
 */

import { OrchportError } from "../utils/errors.ts";

/** Normalize pattern for stable registry keys (trim only; path case preserved). */
export const normalizeSwitchPattern = (raw: string): string => {
  const p = raw.trim();
  if (p === "" || !p.startsWith("/")) {
    throw new OrchportError(
      "CONFIG",
      `switchable pattern must be a non-empty path starting with / (got ${JSON.stringify(raw)})`
    );
  }
  if (p.includes("**")) {
    throw new OrchportError(
      "CONFIG",
      `switchable pattern must not contain **: ${JSON.stringify(raw)}`
    );
  }
  if (p.endsWith("/*")) {
    const before = p.slice(0, -2);
    if (before.includes("*")) {
      throw new OrchportError(
        "CONFIG",
        `switchable pattern may only end with /*: ${JSON.stringify(raw)}`
      );
    }
    return p;
  }
  if (p.includes("*")) {
    throw new OrchportError(
      "CONFIG",
      `switchable pattern: use exact path or trailing /* only: ${JSON.stringify(raw)}`
    );
  }
  return p;
};

/** True if `pathname` matches `pattern` (already normalized). */
export const pathnameMatchesSwitchPattern = (
  pathname: string,
  pattern: string
): boolean => {
  if (pattern.endsWith("/*")) {
    const base = pattern.slice(0, -2);
    return pathname === base || pathname.startsWith(`${base}/`);
  }
  return pathname === pattern;
};
