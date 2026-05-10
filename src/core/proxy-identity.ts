/**
 * Workspace identity for proxy hostnames (mirrors `resolveSession` without allocating entry ports).
 */
import { basename } from "node:path";

import type { LoadedConfig } from "../config/schema.ts";
import { normalizeConfigTld } from "../config/tld.ts";
import {
  detectWorktreeName,
  getGitRepositoryBasename,
  resolveWorktreeHostPrefix,
} from "../utils/git.ts";

export type ProxyIdentity = {
  sld: string;
  tld: string;
  worktree: string;
  worktreeHostPrefix: string;
};

export const resolveProxyIdentity = (options: {
  cwd: string;
  config: LoadedConfig;
  sldCli?: string;
  tldCli?: string;
  worktreeCli?: string;
}): ProxyIdentity => {
  const { cwd, config } = options;
  const sldCli = options.sldCli?.trim() || undefined;
  const sld =
    sldCli ||
    config.sld?.trim() ||
    getGitRepositoryBasename(cwd) ||
    basename(cwd).replaceAll(/[^a-zA-Z0-9._-]+/g, "-") ||
    "app";
  const tldRaw = options.tldCli?.trim();
  const tld =
    tldRaw !== undefined && tldRaw !== ""
      ? normalizeConfigTld(tldRaw)
      : config.tld;
  const worktree =
    options.worktreeCli?.trim() ||
    config.worktree?.trim() ||
    detectWorktreeName(cwd);
  const worktreeHostPrefix = resolveWorktreeHostPrefix(worktree, cwd);
  return { sld, tld, worktree, worktreeHostPrefix };
};
