import { describe, expect, test } from "bun:test";

import { pickEntryPort } from "../../src/core/port-picker.ts";
import { ErrorCode } from "../../src/utils/errors.ts";

describe("pickEntryPort", () => {
  test("strict fixed port in use throws PORT_IN_USE", async () => {
    await expect(
      pickEntryPort({
        name: "web",
        ec: {
          range: [45_671, 45_671],
          strict: true,
          strategy: "deterministic",
        },
        pMin: 43100,
        pMax: 43999,
        used: new Set(),
        sld: "x",
        worktree: "main",
        probe: async () => false,
      })
    ).rejects.toMatchObject({ code: ErrorCode.PORT_IN_USE });
  });

  test("non-strict fixed port in use falls back to portRange", async () => {
    const picked = await pickEntryPort({
      name: "web",
      ec: {
        range: [45_672, 45_672],
        strict: false,
        strategy: "deterministic",
      },
      pMin: 43100,
      pMax: 43999,
      used: new Set(),
      sld: "y",
      worktree: "main",
      probe: async (p) => p !== 45_672,
    });
    expect(picked).not.toBe(45_672);
    expect(picked).toBeGreaterThanOrEqual(43100);
    expect(picked).toBeLessThanOrEqual(43999);
  });
});
