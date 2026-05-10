import { describe, expect, test } from "bun:test";

import {
  formatEnvTable,
  formatPerProxyEnvTables,
  splitEnvSections,
} from "../../src/commands/env-table.ts";

describe("formatEnvTable", () => {
  test("borderless table without ANSI when useColor false", () => {
    const out = formatEnvTable({ A: "1", Z: "2" }, { useColor: false });
    expect(out).toContain("Variable");
    expect(out).toContain("A");
    expect(out).toContain("Z");
    expect(out).toContain("────────");
    expect(out).not.toContain("┌");
    expect(out).not.toContain("│");
    expect(out).not.toContain("\x1b[");
  });

  test("includes ANSI when useColor true", () => {
    const out = formatEnvTable({ X: "y" }, { useColor: true });
    expect(out).toContain("\x1b[");
    expect(out).toContain("Variable");
    expect(out).toContain("X");
    expect(out).not.toContain("\x1b[1m\x1b[33mX");
  });
});

describe("formatPerProxyEnvTables", () => {
  test("global and proxy sections avoid duplicate global keys", () => {
    const out = formatPerProxyEnvTables(
      {
        api: {
          ORCHPORT: "1",
          APP_BASE_URL: "https://web.myapp.test",
          ORCHPORT_API_URL: "https://api.myapp.test",
          ORCHPORT_WEB_URL: "https://web.myapp.test",
          DB_URL: "https://db.myapp.test",
        },
        web: {
          ORCHPORT: "1",
          APP_BASE_URL: "https://web.myapp.test",
          ORCHPORT_API_URL: "https://api.myapp.test",
          ORCHPORT_WEB_URL: "https://web.myapp.test",
          WEB_ONLY: "1",
        },
      },
      {
        useColor: false,
        header: {
          mode: "local-proxy",
          workspace: "myapp",
          worktree: "main",
        },
        proxies: {
          api: {
            url: "https://api.myapp.test",
            localUrl: "http://localhost:8001",
          },
          web: {
            url: "https://web.myapp.test",
            localUrl: "http://localhost:3001",
          },
        },
      }
    );
    expect(out).toContain("orchport env");
    expect(out).toContain("mode local-proxy");
    expect(out).toContain("global");
    expect(out).toContain("● api  https://api.myapp.test");
    expect(out).toContain("(→ http://localhost:8001)");
    expect(out).toContain("● web  https://web.myapp.test");
    expect(out).toContain("DB_URL");
    expect(out).toContain("WEB_ONLY");
    expect(out).not.toContain("┌");
    expect(out).not.toContain("│");
    expect(out.match(/APP_BASE_URL/g)?.length).toBe(1);
  });

  test("splitEnvSections exposes global once and proxy-specific env separately", () => {
    const sections = splitEnvSections(
      {
        api: {
          ORCHPORT: "1",
          APP_BASE_URL: "https://web.myapp.test",
          ORCHPORT_API_PORT: "8001",
          DB_URL: "https://db.myapp.test",
        },
        web: {
          ORCHPORT: "1",
          APP_BASE_URL: "https://web.myapp.test",
          ORCHPORT_WEB_PORT: "3001",
        },
      },
      {}
    );
    expect(sections.find((section) => section.name === "global")?.env).toEqual({
      APP_BASE_URL: "https://web.myapp.test",
      ORCHPORT: "1",
    });
    expect(sections.find((section) => section.name === "api")?.env).toEqual({
      DB_URL: "https://db.myapp.test",
      ORCHPORT_API_PORT: "8001",
    });
  });

  test("splitEnvSections keeps proxy-scoped PORT out of global", () => {
    const sections = splitEnvSections(
      {
        api: {
          ORCHPORT: "1",
          PORT: "8001",
          SHARED: "both",
          ORCHPORT_API_PORT: "8001",
        },
        web: {
          ORCHPORT: "1",
          PORT: "3001",
          SHARED: "both",
          ORCHPORT_WEB_PORT: "3001",
        },
      },
      {}
    );
    expect(sections.find((section) => section.name === "global")?.env).toEqual({
      ORCHPORT: "1",
      SHARED: "both",
    });
    expect(sections.find((section) => section.name === "api")?.env.PORT).toBe(
      "8001"
    );
    expect(sections.find((section) => section.name === "web")?.env.PORT).toBe(
      "3001"
    );
  });
});
