import { describe, expect, test } from "bun:test";

import {
  normalizeSwitchPattern,
  pathnameMatchesSwitchPattern,
} from "../../src/proxy/path-match.ts";
import { OrchportError } from "../../src/utils/errors.ts";

describe("normalizeSwitchPattern", () => {
  test("exact path", () => {
    expect(normalizeSwitchPattern("/auth/callback")).toBe("/auth/callback");
  });

  test("trailing /*", () => {
    expect(normalizeSwitchPattern("/auth/callback/*")).toBe("/auth/callback/*");
  });

  test("rejects **", () => {
    expect(() => normalizeSwitchPattern("/a/**/b")).toThrow(OrchportError);
  });

  test("rejects * in middle", () => {
    expect(() => normalizeSwitchPattern("/a/*/b")).toThrow(OrchportError);
  });
});

describe("pathnameMatchesSwitchPattern", () => {
  test("exact", () => {
    expect(pathnameMatchesSwitchPattern("/foo", "/foo")).toBe(true);
    expect(pathnameMatchesSwitchPattern("/foo/bar", "/foo")).toBe(false);
  });

  test("prefix with /*", () => {
    const p = "/auth/callback/*";
    expect(pathnameMatchesSwitchPattern("/auth/callback/google", p)).toBe(true);
    expect(pathnameMatchesSwitchPattern("/auth/callback", p)).toBe(true);
    expect(pathnameMatchesSwitchPattern("/auth/callbackx", p)).toBe(false);
    expect(pathnameMatchesSwitchPattern("/auth/foo", p)).toBe(false);
  });
});
