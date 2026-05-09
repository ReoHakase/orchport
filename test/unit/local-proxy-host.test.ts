import { describe, expect, test } from "bun:test";

import { buildLocalProxyHost } from "../../src/core/local-proxy-host.ts";

describe("buildLocalProxyHost", () => {
  test("includes worktree segment when prefix is non-empty", () => {
    expect(buildLocalProxyHost("api", "main.", "acme", ".localhost")).toBe(
      "api.main.acme.localhost"
    );
  });

  test("omits extra dot when prefix is empty (default branch)", () => {
    expect(buildLocalProxyHost("api", "", "acme", ".localhost")).toBe(
      "api.acme.localhost"
    );
  });

  test("custom TLD", () => {
    expect(buildLocalProxyHost("api", "main.", "acme", ".test")).toBe(
      "api.main.acme.test"
    );
  });

  test("normalizes to lowercase", () => {
    expect(buildLocalProxyHost("API", "Feat.", "Acme", ".LOCALHOST")).toBe(
      "api.feat.acme.localhost"
    );
  });
});
