import { describe, expect, test } from "bun:test";

import { pickEntryPort } from "../../src/core/port-picker.ts";
import { ErrorCode } from "../../src/utils/errors.ts";

describe("pickEntryPort", () => {
  test("strict fixed port in use throws PORT_IN_USE", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("x"),
    });
    const port = server.port;
    await expect(
      pickEntryPort({
        name: "web",
        ec: {
          range: [port, port],
          strict: true,
          strategy: "deterministic",
        },
        pMin: 43100,
        pMax: 43999,
        used: new Set(),
        sld: "x",
        worktree: "main",
      })
    ).rejects.toMatchObject({ code: ErrorCode.PORT_IN_USE });
    server.stop();
  });

  test("non-strict fixed port in use falls back to portRange", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("x"),
    });
    const port = server.port;
    const picked = await pickEntryPort({
      name: "web",
      ec: {
        range: [port, port],
        strict: false,
        strategy: "deterministic",
      },
      pMin: 43100,
      pMax: 43999,
      used: new Set(),
      sld: "y",
      worktree: "main",
    });
    expect(picked).not.toBe(port);
    expect(picked).toBeGreaterThanOrEqual(43100);
    expect(picked).toBeLessThanOrEqual(43999);
    server.stop();
  });
});
