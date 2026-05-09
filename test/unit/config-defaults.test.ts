import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../../src/config/load.ts";
import { OrchportError } from "../../src/utils/errors.ts";

describe("loadConfig defaults", () => {
  test("tld defaults to .localhost and normalizes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-cfg-"));
    await writeFile(
      join(dir, "orchport.yaml"),
      "mode: local-port\ntld: test\nentries:\n  web: true\n",
      "utf8"
    );
    const cfg = await loadConfig({ cwd: dir });
    expect(cfg.tld).toBe(".test");
  });

  test("legacy workspace key maps to sld", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-cfg-"));
    await writeFile(
      join(dir, "orchport.yaml"),
      "mode: local-port\nworkspace: legacy-name\nentries:\n  web: true\n",
      "utf8"
    );
    const cfg = await loadConfig({ cwd: dir });
    expect(cfg.sld).toBe("legacy-name");
  });

  test("conflicting sld and workspace throws", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-cfg-"));
    await writeFile(
      join(dir, "orchport.yaml"),
      "mode: local-port\nsld: a\nworkspace: b\nentries:\n  web: true\n",
      "utf8"
    );
    await expect(loadConfig({ cwd: dir })).rejects.toThrow(OrchportError);
  });

  test("local-proxy omits proxy.tls → dev", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-cfg-"));
    await writeFile(
      join(dir, "orchport.yaml"),
      "mode: local-proxy\nentries:\n  web:\n    range: [3000, 3000]\n",
      "utf8"
    );
    const cfg = await loadConfig({ cwd: dir });
    expect(cfg.mode).toBe("local-proxy");
    expect(cfg.proxy?.tls).toBe("dev");
  });

  test("local-proxy proxy.tls false opts out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-cfg-"));
    await writeFile(
      join(dir, "orchport.yaml"),
      "mode: local-proxy\nproxy:\n  tls: false\nentries:\n  web:\n    range: [3000, 3000]\n",
      "utf8"
    );
    const cfg = await loadConfig({ cwd: dir });
    expect(cfg.proxy?.tls).toBe(false);
  });

  test("local-port does not inject proxy.tls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-cfg-"));
    await writeFile(
      join(dir, "orchport.yaml"),
      "mode: local-port\nentries:\n  web:\n    range: [3000, 3000]\n",
      "utf8"
    );
    const cfg = await loadConfig({ cwd: dir });
    expect(cfg.mode).toBe("local-port");
    expect(cfg.proxy?.tls).toBeUndefined();
  });

  test("entry range accepts inclusive [min, max] tuple", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-cfg-"));
    await writeFile(
      join(dir, "orchport.yaml"),
      "mode: local-port\nentries:\n  web:\n    range: [3000, 3010]\n",
      "utf8"
    );
    const cfg = await loadConfig({ cwd: dir });
    expect(cfg.entries.web?.range).toEqual([3000, 3010]);
    expect(cfg.entries.web?.strategy).toBe("deterministic");
    expect(cfg.entries.web?.strict).toBe(false);
  });

  test("entry: true normalizes to defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-cfg-"));
    await writeFile(
      join(dir, "orchport.yaml"),
      "mode: local-port\nentries:\n  web: true\n",
      "utf8"
    );
    const cfg = await loadConfig({ cwd: dir });
    expect(cfg.entries.web?.range).toBe("auto");
    expect(cfg.entries.web?.strategy).toBe("deterministic");
    expect(cfg.entries.web?.strict).toBe(false);
  });

  test("entry: {} normalizes to defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orchport-cfg-"));
    await writeFile(
      join(dir, "orchport.yaml"),
      "mode: local-port\nentries:\n  web: {}\n",
      "utf8"
    );
    const cfg = await loadConfig({ cwd: dir });
    expect(cfg.entries.web?.range).toBe("auto");
    expect(cfg.entries.web?.strategy).toBe("deterministic");
  });
});
