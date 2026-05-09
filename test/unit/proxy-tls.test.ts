import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pickPortInRange } from "../../src/ports/allocate.ts";
import { startReverseProxy } from "../../src/proxy/server.ts";

describe("reverse proxy TLS", () => {
  test("terminates TLS and forwards to backend by Host", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orchport-tls-"));
    const keyPath = join(dir, "key.pem");
    const certPath = join(dir, "cert.pem");
    const gen = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "1",
        "-subj",
        "/CN=api.test.localhost",
        "-addext",
        "subjectAltName=DNS:api.test.localhost",
      ],
      { encoding: "utf8" }
    );
    expect(gen.status).toBe(0);

    const backendPort = await pickPortInRange({
      sld: "orchport_tls_test",
      worktree: "main",
      entryName: "backend",
      min: 43100,
      max: 43999,
      avoid: new Set(),
    });
    const proxyPort = await pickPortInRange({
      sld: "orchport_tls_test",
      worktree: "main",
      entryName: "proxy",
      min: 43100,
      max: 43999,
      avoid: new Set([backendPort]),
    });

    const backend = Bun.serve({
      port: backendPort,
      hostname: "127.0.0.1",
      fetch: () => new Response("proxied-ok"),
    });

    const host = "api.test.localhost";
    const routes = new Map<string, number>([[host, backendPort]]);

    const proxy = startReverseProxy({
      port: proxyPort,
      routes,
      tls: {
        cert: Bun.file(certPath),
        key: Bun.file(keyPath),
      },
    });

    try {
      const res = await fetch(`https://127.0.0.1:${proxyPort}/`, {
        headers: { Host: `${host}:${proxyPort}` },
        tls: { rejectUnauthorized: false },
      });
      expect(res.ok).toBe(true);
      expect(await res.text()).toBe("proxied-ok");
    } finally {
      proxy.stop();
      backend.stop();
    }
  });
});
