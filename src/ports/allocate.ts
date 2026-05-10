/**
 * @module orchport/ports/allocate
 * Free-port selection in a range: deterministic (hash-rotated), smaller-first, or larger-first.
 */
import { createServer } from "node:net";

import type { PortPickStrategy } from "../config/schema.ts";
import { hashStable } from "../utils/hash.ts";

export type PortProbe = (port: number) => Promise<boolean>;

const tryListenPort = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen({ port, host: "127.0.0.1" }, () => {
      s.close(() => resolve(true));
    });
  });

const buildProbeOrder = (options: {
  min: number;
  max: number;
  strategy: PortPickStrategy;
  sld: string;
  worktree: string;
  entryName: string;
}): number[] => {
  const { min, max, strategy, sld, worktree, entryName } = options;
  const span = max - min + 1;
  if (strategy === "smaller") {
    return Array.from({ length: span }, (_, i) => min + i);
  }
  if (strategy === "larger") {
    return Array.from({ length: span }, (_, i) => max - i);
  }
  const h = hashStable(`${sld}\0${worktree}\0${entryName}`);
  const start = min + (h % span);
  return Array.from(
    { length: span },
    (_, i) => min + ((start - min + i) % span)
  );
};

/** First free port in `min..max` per `strategy`, skipping `avoid`. */
export const pickPortInRange = async (options: {
  /** Used with `worktree` and `entryName` for deterministic port hashing. */
  sld: string;
  worktree: string;
  entryName: string;
  min: number;
  max: number;
  avoid: ReadonlySet<number>;
  strategy?: PortPickStrategy;
  probe?: PortProbe;
}): Promise<number> => {
  const {
    sld,
    worktree,
    entryName,
    min,
    max,
    avoid,
    strategy = "deterministic",
    probe = tryListenPort,
  } = options;
  if (min > max) {
    throw new Error(`Invalid port range: ${min}-${max}`);
  }
  const order = buildProbeOrder({
    min,
    max,
    strategy,
    sld,
    worktree,
    entryName,
  });
  for (const p of order) {
    if (avoid.has(p)) {
      continue;
    }
    /* Sequential probe: ports must be checked one at a time */
    /* eslint-disable-next-line no-await-in-loop */
    if (await probe(p)) {
      return p;
    }
  }
  throw new Error(`No free port in range ${min}-${max} for ${entryName}`);
};

/** True if nothing is listening on `127.0.0.1:port` (brief TCP listen probe). */
export const isLocalPortFree = tryListenPort;
