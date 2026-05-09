/**
 * @module orchport/proxy/dev-tls
 * Ephemeral self-signed TLS for local HTTPS (requires `openssl` on PATH).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getLogger } from "@logtape/logtape";

import { OrchportError } from "../utils/errors.ts";

const log = getLogger(["orchport", "dev-tls"]);

export type DevTlsResult = {
  certPath: string;
  keyPath: string;
  /** Remove temp PEMs (call after proxy listeners are stopped). */
  cleanup: () => void;
};

/**
 * Writes a 2-day self-signed cert with SAN covering all given hostnames (lowercase DNS).
 */
export const generateDevSelfSignedTlsSync = (
  hostnames: string[]
): DevTlsResult => {
  const unique = [...new Set(hostnames.map((h) => h.toLowerCase()))];
  if (unique.length === 0) {
    throw new OrchportError("DEV_TLS", "No hostnames for dev TLS");
  }
  log.trace("dev TLS SAN hostnames: {hosts}", { hosts: unique.join(", ") });
  const dir = mkdtempSync(join(tmpdir(), "orchport-devtls-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  const san = unique.map((h) => `DNS:${h}`).join(",");
  const cn = unique[0];
  const r = spawnSync(
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
      "2",
      "-subj",
      `/CN=${cn}`,
      "-addext",
      `subjectAltName=${san}`,
    ],
    { encoding: "utf8" }
  );
  if (r.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    const detail = [r.stderr, r.stdout].filter(Boolean).join("\n").trim();
    throw new OrchportError(
      "DEV_TLS",
      detail
        ? `openssl failed (is openssl installed?): ${detail}`
        : "openssl failed (is openssl installed?)"
    );
  }
  return {
    certPath,
    keyPath,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
};
