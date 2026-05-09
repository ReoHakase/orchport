import { isRecord } from "../utils/pick.ts";
import type { RunStateFile } from "./types.ts";

export const parseRunStateFile = (text: string): RunStateFile | null => {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw)) {
    return null;
  }
  if (typeof raw.runId !== "string" || typeof raw.rootPid !== "number") {
    return null;
  }
  if (
    !Array.isArray(raw.command) ||
    !raw.command.every((c) => typeof c === "string")
  ) {
    return null;
  }
  if (typeof raw.workspace !== "string" || typeof raw.worktree !== "string") {
    return null;
  }
  if (raw.mode !== "local-port" && raw.mode !== "local-proxy") {
    return null;
  }
  if (typeof raw.createdAt !== "string") {
    return null;
  }
  if (!isRecord(raw.entries)) {
    return null;
  }
  const entries: RunStateFile["entries"] = {};
  for (const [k, v] of Object.entries(raw.entries)) {
    if (!isRecord(v)) {
      return null;
    }
    if (
      typeof v.port !== "number" ||
      typeof v.url !== "string" ||
      typeof v.localUrl !== "string"
    ) {
      return null;
    }
    entries[k] = { port: v.port, url: v.url, localUrl: v.localUrl };
  }
  const proxyPort = raw.proxyPort;
  return {
    runId: raw.runId,
    rootPid: raw.rootPid,
    command: raw.command,
    workspace: raw.workspace,
    worktree: raw.worktree,
    mode: raw.mode,
    createdAt: raw.createdAt,
    configPath:
      raw.configPath === null
        ? null
        : typeof raw.configPath === "string"
          ? raw.configPath
          : null,
    entries,
    proxyPort: typeof proxyPort === "number" ? proxyPort : undefined,
  };
};
