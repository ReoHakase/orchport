import { describe, expect, test } from "bun:test";

import type { LoadedConfig } from "../../src/config/schema.ts";
import {
  assertTlsFilesExist,
  selectExtraProxyPort,
} from "../../src/proxy/tls-material.ts";
import { ErrorCode } from "../../src/utils/errors.ts";

const minimalConfig = (proxy: LoadedConfig["proxy"]): LoadedConfig => ({
  sld: "app",
  tld: ".localhost",
  worktree: "main",
  portRange: [43100, 43999],
  mode: "local-proxy",
  proxy,
  proxies: {
    web: {
      range: "auto",
      strategy: "deterministic",
      strict: false,
    },
  },
  configPath: null,
});

describe("tls-material", () => {
  test("missing cert file throws CONFIG_TLS_FILE with context", () => {
    expect(() =>
      assertTlsFilesExist({
        cert: "/definitely/missing/cert.pem",
        key: "/definitely/missing/key.pem",
      })
    ).toThrow(expect.objectContaining({ code: ErrorCode.CONFIG_TLS_FILE }));
  });

  test("httpsPort false skips extra listener", () => {
    const config = minimalConfig({ tls: "dev", httpsPort: false });
    expect(
      selectExtraProxyPort({
        httpsPort: config.proxy?.httpsPort,
        tlsActive: true,
      })
    ).toBeUndefined();
  });

  test("omitted httpsPort uses 443 only when TLS is active", () => {
    const config = minimalConfig({ tls: "dev" });
    expect(
      selectExtraProxyPort({
        httpsPort: config.proxy?.httpsPort,
        tlsActive: true,
      })
    ).toBe(443);
    expect(
      selectExtraProxyPort({
        httpsPort: config.proxy?.httpsPort,
        tlsActive: false,
      })
    ).toBeUndefined();
  });

  test("numeric httpsPort is preserved", () => {
    const config = minimalConfig({ tls: "dev", httpsPort: 4443 });
    expect(
      selectExtraProxyPort({
        httpsPort: config.proxy?.httpsPort,
        tlsActive: true,
      })
    ).toBe(4443);
  });
});
