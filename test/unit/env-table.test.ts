import { describe, expect, test } from "bun:test";

import { formatEnvTable } from "../../src/commands/env-table.ts";

describe("formatEnvTable", () => {
  test("box table without ANSI when useColor false", () => {
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
