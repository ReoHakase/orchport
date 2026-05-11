/**
 * Merges `proxy/routes/*.json` for the daemon into live Host→port maps.
 */
import { watch } from "node:fs";
import { readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

import { getLogger } from "@logtape/logtape";

import { proxyRoutesDir } from "../state/proxy-routes.ts";
import type { ProxyRouteRegistrationFile } from "../state/types.ts";
import { isRecord } from "../utils/pick.ts";
import { pidAlive } from "../utils/process.ts";
import type { ProxyRouteResolver, SwitchRoutingContext } from "./server.ts";

const log = getLogger(["orchport", "proxy", "routes"]);

const isRouteRegistration = (
  raw: unknown
): raw is ProxyRouteRegistrationFile => {
  if (!isRecord(raw) || raw.version !== 1) {
    return false;
  }
  if (
    typeof raw.runId !== "string" ||
    typeof raw.pid !== "number" ||
    !isRecord(raw.routes)
  ) {
    return false;
  }
  return true;
};

const parseRouteFile = (text: string): ProxyRouteRegistrationFile | null => {
  try {
    const raw: unknown = JSON.parse(text);
    if (!isRouteRegistration(raw)) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
};

const recordToSwitchRouting = (
  r: NonNullable<ProxyRouteRegistrationFile["switchRouting"]> & {
    /** @deprecated Old route files used `entrySwitchable`. */
    entrySwitchable?: Record<string, string[]>;
  }
): SwitchRoutingContext => {
  const emptyPatterns: Record<string, string[]> = {};
  const rawPatterns = r.proxySwitchables ?? r.entrySwitchable ?? emptyPatterns;
  return {
    hostToEntry: new Map(Object.entries(r.hostToEntry)),
    proxySwitchables: new Map(Object.entries(rawPatterns)),
    sld: r.sld,
    tld: r.tld,
    worktree: r.worktree,
  };
};

export class ProxyRouteWatcher {
  private mergedRoutes = new Map<string, number>();

  private registrations: ProxyRouteRegistrationFile[] = [];

  private readonly routesDir: string;

  private watcher: ReturnType<typeof watch> | null = null;

  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor(routesDir?: string) {
    this.routesDir = routesDir ?? proxyRoutesDir();
  }

  /** Merge registration files; stale PIDs are removed from disk. */
  async rebuild(): Promise<void> {
    const dir = this.routesDir;
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      this.mergedRoutes = new Map();
      this.registrations = [];
      return;
    }
    const regs: ProxyRouteRegistrationFile[] = [];
    /* Sequential reads keep behavior predictable under rapid edits. */
    /* eslint-disable-next-line no-await-in-loop */
    for (const name of names) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const path = join(dir, name);
      try {
        /* eslint-disable-next-line no-await-in-loop */
        const text = await readFile(path, "utf8");
        const reg = parseRouteFile(text);
        if (reg === null) {
          continue;
        }
        if (!pidAlive(reg.pid)) {
          /* eslint-disable-next-line no-await-in-loop */
          await unlink(path).catch(() => {
            /* ignore */
          });
          log.trace("proxy routes: removed stale file {file}", { file: name });
          continue;
        }
        regs.push(reg);
      } catch {
        /* skip */
      }
    }
    regs.sort((a, b) => {
      const byTime = a.createdAt.localeCompare(b.createdAt);
      return byTime === 0 ? a.runId.localeCompare(b.runId) : byTime;
    });
    const next = new Map<string, number>();
    for (const reg of regs) {
      for (const [host, port] of Object.entries(reg.routes)) {
        next.set(host.toLowerCase(), port);
      }
    }
    this.registrations = regs;
    this.mergedRoutes = next;
    log.trace("proxy routes: merged {n} host(s)", {
      n: String(this.mergedRoutes.size),
    });
  }

  scheduleRebuild(): void {
    if (this.debounce !== null) {
      clearTimeout(this.debounce);
    }
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.rebuild();
    }, 50);
  }

  async startWatching(): Promise<void> {
    await this.rebuild();
    try {
      this.watcher = watch(this.routesDir, { persistent: true }, () => {
        this.scheduleRebuild();
      });
    } catch {
      log.warning("proxy routes: could not watch directory {dir}", {
        dir: this.routesDir,
      });
    }
  }

  stop(): void {
    if (this.watcher !== null) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounce !== null) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
  }

  getResolver(): ProxyRouteResolver {
    return {
      getRoutes: () => this.mergedRoutes,
      refresh: () => this.rebuild(),
      getSwitchRoutingForHost: (
        hostLower: string
      ): SwitchRoutingContext | undefined => {
        const h = hostLower.toLowerCase();
        for (let i = this.registrations.length - 1; i >= 0; i--) {
          const reg = this.registrations[i];
          const hit = Object.keys(reg.routes).find(
            (k) => k.toLowerCase() === h
          );
          if (hit !== undefined && reg.switchRouting !== undefined) {
            return recordToSwitchRouting(reg.switchRouting);
          }
        }
        return undefined;
      },
    };
  }
}
