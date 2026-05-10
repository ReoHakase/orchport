/**
 * Per-proxy port allocation with strict/range semantics.
 */
import { getLogger } from "@logtape/logtape";

import type { PortPickStrategy, ProxyConfig } from "../config/schema.ts";
import { isLocalPortFree, pickPortInRange } from "../ports/allocate.ts";
import { ErrorCode, OrchportError } from "../utils/errors.ts";

const log = getLogger(["orchport", "resolve", "port"]);

export const pickEntryPort = async (options: {
  name: string;
  ec: ProxyConfig;
  pMin: number;
  pMax: number;
  used: Set<number>;
  sld: string;
  worktree: string;
}): Promise<number> => {
  const { name, ec, pMin, pMax, used, sld, worktree } = options;
  const { range, strategy, strict } = ec;

  const pickIn = (min: number, max: number, strat: PortPickStrategy) =>
    pickPortInRange({
      sld,
      worktree,
      entryName: name,
      min,
      max,
      avoid: used,
      strategy: strat,
    });

  if (range === "auto") {
    const port = await pickIn(pMin, pMax, strategy);
    log.debug("Entry {name} auto-range port {port}", {
      name,
      port: String(port),
    });
    return port;
  }

  const [rMin, rMax] = range;
  if (rMin === rMax) {
    const p = rMin;
    if (used.has(p)) {
      throw new OrchportError(
        ErrorCode.PORT_TAKEN,
        `Port ${p} already assigned to another entry in this resolution`,
        {
          hint: "Use a different fixed port or remove the duplicate assignment.",
          context: { port: String(p), entry: name },
        }
      );
    }
    /* eslint-disable-next-line no-await-in-loop */
    if (await isLocalPortFree(p)) {
      log.debug("Entry {name} fixed port {port}", { name, port: String(p) });
      return p;
    }
    if (!strict) {
      log.warning(
        "Entry {name}: port {port} unavailable; falling back to global portRange (strict: false)",
        { name, port: String(p) }
      );
      const port = await pickIn(pMin, pMax, "deterministic");
      log.debug("Entry {name} fallback port {port}", {
        name,
        port: String(port),
      });
      return port;
    }
    throw new OrchportError(
      ErrorCode.PORT_IN_USE,
      `Requested port ${p} is not available`,
      {
        hint: "Set `strict: false` on this entry to fall back to an open port in portRange, or free the port.",
        context: { port: String(p), entry: name },
      }
    );
  }

  try {
    const port = await pickIn(rMin, rMax, strategy);
    log.debug("Entry {name} port {port} (range {min}-{max} strategy {strat})", {
      name,
      port: String(port),
      min: String(rMin),
      max: String(rMax),
      strat: strategy,
    });
    return port;
  } catch (err) {
    if (!strict) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warning(
        "Entry {name}: no free port in {min}-{max} ({msg}); falling back to global portRange",
        { name, min: String(rMin), max: String(rMax), msg }
      );
      const port = await pickIn(pMin, pMax, "deterministic");
      log.debug("Entry {name} fallback port {port}", {
        name,
        port: String(port),
      });
      return port;
    }
    throw new OrchportError(
      ErrorCode.PORT_RANGE,
      err instanceof Error ? err.message : String(err),
      {
        hint: "Widen the entry port range or set `strict: false` to fall back to the global portRange.",
        context: { entry: name, min: String(rMin), max: String(rMax) },
      }
    );
  }
};
