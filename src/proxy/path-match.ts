/**
 * @module orchport/proxy/path-match
 * Predictable path patterns for `switchable`: exact path or `/prefix/*` (single trailing wildcard).
 */

import { ErrorCode, OrchportError } from "../utils/errors.ts";

/** Normalize pattern for stable registry keys (trim only; path case preserved). */
export const normalizeSwitchPattern = (raw: string): string => {
  const p = raw.trim();
  if (p === "" || !p.startsWith("/")) {
    throw new OrchportError(
      ErrorCode.CONFIG_SWITCHABLE,
      `switchable pattern must be a non-empty path starting with / (got ${JSON.stringify(raw)})`,
      {
        hint: "Example: `/auth/callback` or `/oauth/*` (see docs for switchable rules).",
      }
    );
  }
  if (p.includes("**")) {
    throw new OrchportError(
      ErrorCode.CONFIG_SWITCHABLE,
      `switchable pattern must not contain **: ${JSON.stringify(raw)}`,
      { hint: "Use a single trailing `/*` wildcard only (no `**`)." }
    );
  }
  if (p.endsWith("/*")) {
    const before = p.slice(0, -2);
    if (before.includes("*")) {
      throw new OrchportError(
        ErrorCode.CONFIG_SWITCHABLE,
        `switchable pattern may only end with /*: ${JSON.stringify(raw)}`,
        {
          hint: "Wildcards are only allowed as a trailing `/prefix/*` segment.",
        }
      );
    }
    return p;
  }
  if (p.includes("*")) {
    throw new OrchportError(
      ErrorCode.CONFIG_SWITCHABLE,
      `switchable pattern: use exact path or trailing /* only: ${JSON.stringify(raw)}`,
      { hint: "Example: `/api/hooks/stripe` or `/webhooks/*`." }
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
