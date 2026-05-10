import { describe, expect, test } from "bun:test";

import { formatHumanTable } from "../../src/cli/human-table.ts";

describe("formatHumanTable", () => {
  test("renders one unicode divider and no boxed borders", () => {
    const out = formatHumanTable({
      headers: ["Name", "Value"],
      rows: [["A", "1"]],
      columnWidths: [8, 8],
    });
    expect(out).toContain("Name");
    expect(out).toContain("────────");
    expect(out).not.toContain("--------");
    expect(out).not.toContain("┌");
    expect(out).not.toContain("│");
    expect(out.split("\n").filter((line) => /^─+$/.test(line)).length).toBe(1);
  });

  test("divider spans configured table width, not trimmed header text", () => {
    const out = formatHumanTable({
      headers: ["Short", "H"],
      rows: [["left", "right"]],
      columnWidths: [12, 20],
    });
    const divider = out.split("\n").find((line) => /^─+$/.test(line));
    expect(divider?.length).toBe(33);
  });

  test("renders one divider after multi-row headers", () => {
    const out = formatHumanTable({
      headers: [
        ["Run", "Proxies", "", "Switches"],
        ["", "api", "web", ""],
      ],
      rows: [["abc", "8000", "3000", "yes"]],
      columnWidths: [8, 8, 6, 8],
    });
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toContain("Proxies");
    expect(lines[1]).toContain("api");
    expect(lines.filter((line) => /^─+$/.test(line)).length).toBe(1);
    expect(lines[3]).toContain("8000");
  });

  test("truncates long cells instead of wrapping", () => {
    const out = formatHumanTable({
      headers: ["Name", "Value"],
      rows: [["A", "1234567890"]],
      columnWidths: [4, 5],
    });
    expect(out).toContain("1234…");
    expect(out.trimEnd().split("\n")).toHaveLength(3);
  });
});
