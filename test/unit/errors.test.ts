import { describe, expect, test } from "bun:test";

import {
  ErrorCode,
  orchportErrorToJson,
  OrchportError,
} from "../../src/utils/errors.ts";

describe("OrchportError", () => {
  test("carries code hint and context", () => {
    const e = new OrchportError(ErrorCode.CONFIG_NOT_FOUND, "missing", {
      hint: "run init",
      context: { cwd: "/tmp" },
    });
    expect(e.code).toBe(ErrorCode.CONFIG_NOT_FOUND);
    expect(e.message).toBe("missing");
    expect(e.hint).toBe("run init");
    expect(e.context?.cwd).toBe("/tmp");
  });

  test("orchportErrorToJson merges cwd", () => {
    const e = new OrchportError(ErrorCode.PORT_IN_USE, "busy", {
      context: { port: "443" },
    });
    const j = orchportErrorToJson(e, "/project");
    expect(j.error).toBe(true);
    expect(j.code).toBe(ErrorCode.PORT_IN_USE);
    expect(j.context?.cwd).toBe("/project");
    expect(j.context?.port).toBe("443");
  });
});
