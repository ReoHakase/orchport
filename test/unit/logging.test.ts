import { describe, expect, test } from "bun:test";

import { isProductionLogStyle } from "../../src/logging/setup.ts";

describe("isProductionLogStyle", () => {
  test("verbose forces non-production style", () => {
    expect(isProductionLogStyle({ verbose: true })).toBe(false);
  });
});
