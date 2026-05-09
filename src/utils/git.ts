import { execFileSync } from "node:child_process";
import { basename } from "node:path";

const slug = (s: string): string => s.replaceAll(/[^a-zA-Z0-9._-]+/g, "-");

/** Git repo root directory basename (stable workspace default). */
export const getGitRepositoryBasename = (cwd: string): string | null => {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!top) {
      return null;
    }
    return slug(basename(top));
  } catch {
    return null;
  }
};

/** e.g. `main` from `refs/remotes/origin/main`. */
export const getOriginDefaultBranchSlug = (cwd: string): string | null => {
  try {
    const ref = execFileSync(
      "git",
      ["symbolic-ref", "-q", "refs/remotes/origin/HEAD"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    const m = ref.match(/\/([^/]+)$/);
    if (!m?.[1]) {
      return null;
    }
    return slug(m[1]);
  } catch {
    return null;
  }
};

/**
 * Hostname fragment before workspace: `${worktree}.` or `` when on the repo default branch
 * (so `web.main.repo.localhost` becomes `web.repo.localhost`).
 */
export const resolveWorktreeHostPrefix = (
  worktree: string,
  cwd: string
): string => {
  const originDefault = getOriginDefaultBranchSlug(cwd);
  if (originDefault !== null && worktree === originDefault) {
    return "";
  }
  if (
    originDefault === null &&
    (worktree === "main" || worktree === "master")
  ) {
    return "";
  }
  return `${worktree}.`;
};

/** Best-effort git worktree name (branch or folder). */
export const detectWorktreeName = (cwd: string): string => {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (branch && branch !== "HEAD") {
      return slug(branch);
    }
  } catch {
    /* not a git repo */
  }
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (top) {
      const base = top.split("/").pop() ?? "worktree";
      return slug(base);
    }
  } catch {
    /* ignore */
  }
  return "main";
};
