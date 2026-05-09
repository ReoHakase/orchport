import { describe, expect, test } from "bun:test";

import { generateDevSelfSignedTlsSync } from "../../src/proxy/dev-tls.ts";

describe("generateDevSelfSignedTlsSync", () => {
  test("creates PEMs with SAN for all hostnames", async () => {
    const { certPath, keyPath, cleanup } = generateDevSelfSignedTlsSync([
      "api.repo.localhost",
      "web.repo.localhost",
    ]);
    try {
      expect(certPath.endsWith(".pem")).toBe(true);
      expect(keyPath.endsWith(".pem")).toBe(true);
      const text = await Bun.file(certPath).text();
      expect(text.includes("BEGIN CERTIFICATE")).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("dedupes hostnames", () => {
    const { cleanup } = generateDevSelfSignedTlsSync([
      "API.repo.localhost",
      "api.repo.localhost",
    ]);
    cleanup();
  });
});
