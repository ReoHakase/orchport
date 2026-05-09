import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolves the XDG state home directory: `$XDG_STATE_HOME`, or if unset/empty the
 * spec default `$HOME/.local/state`.
 */
const effectiveXdgStateHome = (): string => {
  const xdg = process.env.XDG_STATE_HOME?.trim();
  if (xdg) {
    return xdg;
  }
  return join(homedir(), ".local", "state");
};

/** Shared orchport state lives under `$XDG_STATE_HOME/orchport` (see `effectiveXdgStateHome`). */
export const getStateDir = (): string => {
  const override = process.env.ORCHPORT_STATE_DIR?.trim();
  if (override) {
    return override;
  }
  return join(effectiveXdgStateHome(), "orchport");
};
