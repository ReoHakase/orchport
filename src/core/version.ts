import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isRecord } from "../utils/pick.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const readVersion = (text: string): string => {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw)) {
    return "0.0.0";
  }
  const v = raw.version;
  return typeof v === "string" ? v : "0.0.0";
};

export const packageVersion = (): string => {
  try {
    const text = readFileSync(join(root, "package.json"), "utf8");
    return readVersion(text);
  } catch {
    return "0.0.0";
  }
};
