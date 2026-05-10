import { describe, expect, test } from "bun:test";

import {
  deleteProxyDaemonStateFile,
  readProxyDaemonState,
  writeProxyDaemonState,
} from "../../src/state/proxy-daemon.ts";
import { createTempStateDir } from "../helpers/index.ts";

describe("proxy daemon state file", () => {
  test("write → read → delete", async () => {
    const state = await createTempStateDir();
    const prev = process.env.ORCHPORT_STATE_DIR;
    process.env.ORCHPORT_STATE_DIR = state;
    try {
      deleteProxyDaemonStateFile();
      expect(readProxyDaemonState()).toBeNull();
      await writeProxyDaemonState({
        version: 1,
        pid: 424242,
        mainPort: 44001,
        httpsPort: null,
        tls: true,
        certPath: "/tmp/x.pem",
        startedAt: new Date().toISOString(),
      });
      const s = readProxyDaemonState();
      expect(s?.mainPort).toBe(44001);
      expect(s?.pid).toBe(424242);
      deleteProxyDaemonStateFile();
      expect(readProxyDaemonState()).toBeNull();
    } finally {
      if (prev === undefined) {
        delete process.env.ORCHPORT_STATE_DIR;
      } else {
        process.env.ORCHPORT_STATE_DIR = prev;
      }
    }
  });
});
