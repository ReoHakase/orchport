import { describe, expect, test } from "bun:test";

import {
  formatEnvTable,
  formatPerProxyEnvTables,
} from "../../src/commands/env-table.ts";

describe("formatEnvTable", () => {
  test("bordered table without ANSI when useColor false", () => {
    const out = formatEnvTable({ A: "1", Z: "2" }, { useColor: false });
    expect(out).toContain("Variable");
    expect(out).toContain("A");
    expect(out).toContain("Z");
    expect(out).toContain("┌");
    expect(out).not.toContain("\x1b[");
  });

  test("includes ANSI when useColor true", () => {
    const out = formatEnvTable({ X: "y" }, { useColor: true });
    expect(out).toContain("\x1b[");
  });
});

describe("formatPerProxyEnvTables", () => {
  test("section titles and two tables when useColor false", () => {
    const out = formatPerProxyEnvTables(
      {
        api: { ORCHPORT: "1", ONLY_API: "x" },
        web: { ORCHPORT: "1", ONLY_WEB: "y" },
      },
      { useColor: false }
    );
    expect(out).toContain("━━ api ━━");
    expect(out).toContain("━━ web ━━");
    expect(out).toContain("ONLY_API");
    expect(out).toContain("ONLY_WEB");
    expect(out).toContain("┌");
  });
});
