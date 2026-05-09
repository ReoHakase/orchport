import { describe, expect, test } from "bun:test";

import { entryKeyToEnvPrefix } from "../../src/utils/snake.ts";

describe("entryKeyToEnvPrefix", () => {
  test("maps admin-api to ADMIN_API", () => {
    expect(entryKeyToEnvPrefix("admin-api")).toBe("ADMIN_API");
  });
  test("maps web to WEB", () => {
    expect(entryKeyToEnvPrefix("web")).toBe("WEB");
  });
});
