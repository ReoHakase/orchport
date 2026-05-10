import { describe, expect, test } from "bun:test";

import {
  formatNextLine,
  formatOrchportCliError,
  formatRouteLine,
  muted,
} from "../../src/cli/format.ts";
import { ErrorCode, OrchportError } from "../../src/utils/errors.ts";

describe("cli format helpers", () => {
  test("route line renders resolved target without ANSI when color is off", () => {
    const out = formatRouteLine(
      {
        incomingUrl: "https://api.myapp.test/auth/callback/*",
        localTargetUrl: "http://localhost:8001/auth/callback/*",
        targetPublicUrl: "https://api.fix.myapp.test/auth/callback/*",
      },
      { color: false }
    );
    expect(out).toContain(
      "https://api.myapp.test/auth/callback/* → http://localhost:8001/auth/callback/*"
    );
    expect(out).toContain("(← https://api.fix.myapp.test/auth/callback/*)");
    expect(out).not.toContain("\x1b[");
  });

  test("route line renders unresolved target", () => {
    const out = formatRouteLine(
      {
        incomingUrl: "https://api.myapp.test/auth/callback/*",
        unresolvedReason:
          "target feature-auth is not running; requests return 502",
      },
      { color: false }
    );
    expect(out).toContain("→ unresolved");
    expect(out).toContain("requests return 502");
  });

  test("next line and muted text support ANSI color", () => {
    expect(formatNextLine("try again.", { color: true })).toContain("\x1b[");
    expect(muted("stopped", { color: true })).toContain("\x1b[90m");
  });

  test("human error includes hint, context, and next action", () => {
    const out = formatOrchportCliError(
      new OrchportError(ErrorCode.RUN_NO_COMMAND, "run requires a command", {
        hint: "Put the child command after `--`.",
        context: { command: "run" },
      }),
      { tty: false }
    );
    expect(out).toContain("hint: Put the child command");
    expect(out).toContain("context: command=run");
    expect(out).toContain("Next: Pass the child command");
  });
});
