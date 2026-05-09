import { describe, expect, test } from "bun:test";

import { hashStable } from "../../src/utils/hash.ts";

describe("hashStable", () => {
  test("is deterministic", () => {
    expect(hashStable("a\0b\0c")).toBe(hashStable("a\0b\0c"));
  });
  test("differs for different inputs", () => {
    expect(hashStable("x")).not.toBe(hashStable("y"));
  });
});
