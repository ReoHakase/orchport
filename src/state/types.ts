export type RunStateFile = {
  runId: string;
  rootPid: number;
  command: string[];
  workspace: string;
  worktree: string;
  mode: "local-port" | "local-proxy";
  createdAt: string;
  configPath: string | null;
  entries: Record<
    string,
    {
      port: number;
      url: string;
      localUrl: string;
    }
  >;
  proxyPort?: number;
};

export type PortsRegistryFile = {
  version: 1;
  assignments: Record<
    string,
    {
      workspace: string;
      worktree: string;
      entry: string;
      updatedAt: string;
    }
  >;
};

/** Path-based routing: which worktree serves `switchable` paths for an entry. */
export type SwitchRegistryFile = {
  version: 1;
  entries: Record<
    string,
    {
      targetWorktree: string;
      updatedAt: string;
      lastRunId?: string;
    }
  >;
};
