import { describe, expect, test } from "bun:test";

import {
  buildInterpolateRoot,
  interpolateString,
} from "../../src/env/interpolate.ts";
import { OrchportError } from "../../src/utils/errors.ts";

describe("interpolateString", () => {
  test("replaces entries paths", () => {
    const root: Record<string, unknown> = {
      entries: { web: { port: 43101, url: "http://localhost:43101" } },
    };
    expect(interpolateString("${entries.web.port}", root)).toBe("43101");
  });

  test("replaces entry shorthand when root includes alias", () => {
    const root = buildInterpolateRoot({
      sld: "w",
      tld: ".localhost",
      worktree: "t",
      worktreeHostPrefix: "",
      entries: {
        web: {
          port: 43101,
          url: "http://x",
          localUrl: "http://127.0.0.1:43101",
        },
      },
      proxyPort: 44_000,
    });
    expect(interpolateString("${web.url}", root)).toBe("http://x");
  });

  test("throws on missing key", () => {
    expect(() =>
      interpolateString("${entries.missing.port}", {
        entries: {},
      })
    ).toThrow(OrchportError);
  });
});
