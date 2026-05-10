import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pickPortInRange } from "../../src/ports/allocate.ts";
import { startReverseProxy } from "../../src/proxy/server.ts";

describe("proxy routing", () => {
  test("unknown Host returns 404", async () => {
    const proxyPort = await pickPortInRange({
      sld: "rt",
      worktree: "main",
      entryName: "px",
      min: 43200,
      max: 43299,
      avoid: new Set(),
    });
    const routes = new Map<string, number>([["known.localhost", 5555]]);
    const backend = Bun.serve({
      port: 5555,
      hostname: "127.0.0.1",
      fetch: () => new Response("backend"),
    });
    const proxy = startReverseProxy({
      port: proxyPort,
      routes,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/`, {
        headers: { Host: "missing.localhost" },
      });
      expect(res.status).toBe(404);
    } finally {
      proxy.stop();
      backend.stop();
    }
  });

  test("known Host forwards", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orchport-route-"));
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
        "/CN=api.rt.localhost",
        "-addext",
        "subjectAltName=DNS:api.rt.localhost",
      ],
      { encoding: "utf8" }
    );
    expect(gen.status).toBe(0);

    const backendPort = await pickPortInRange({
      sld: "rt",
      worktree: "main",
      entryName: "be",
      min: 43200,
      max: 43299,
      avoid: new Set(),
    });
    const proxyPort = await pickPortInRange({
      sld: "rt",
      worktree: "main",
      entryName: "px",
      min: 43200,
      max: 43299,
      avoid: new Set([backendPort]),
    });

    const backend = Bun.serve({
      port: backendPort,
      hostname: "127.0.0.1",
      fetch: () => new Response("hit"),
    });

    const host = "api.rt.localhost";
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
      expect(await res.text()).toBe("hit");
    } finally {
      proxy.stop();
      backend.stop();
    }
  });
});
