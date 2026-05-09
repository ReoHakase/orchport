import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_REL = join(".local", "state", "orchport");

export const getStateDir = (): string => {
  const override = process.env.ORCHPORT_STATE_DIR?.trim();
  if (override) {
    return override;
  }
  const xdg = process.env.XDG_STATE_HOME?.trim();
  if (xdg) {
    return join(xdg, "orchport");
  }
  return join(homedir(), DEFAULT_REL);
};
