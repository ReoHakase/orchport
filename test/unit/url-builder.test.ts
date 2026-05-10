import { describe, expect, test } from "bun:test";

import type { LoadedConfig } from "../../src/config/schema.ts";
import type { ResolvedProxyShape } from "../../src/config/schema.ts";
import { buildEntryUrl } from "../../src/core/url-builder.ts";

describe("buildEntryUrl", () => {
  test("local-proxy https implicit 443", () => {
    const config: LoadedConfig = {
      mode: "local-proxy",
      proxies: {
        web: {
          range: "auto",
          strategy: "deterministic",
          strict: false,
        },
      },
      tld: ".localhost",
      configPath: "/c.yaml",
      proxy: { tls: "dev" },
    };

    const proxy: ResolvedProxyShape = {
      name: "web",
      port: 3000,
      host: "localhost",
      url: "http://localhost:3000",
      localUrl: "http://localhost:3000",
    };

    const url = buildEntryUrl({
      config,
      proxy,
      sld: "myapp",
      tld: ".localhost",
      worktree: "main",
      worktreeHostPrefix: "",
      proxyPort: 43_000,
    });
    expect(url).toBe("https://web.myapp.localhost");
  });
});
