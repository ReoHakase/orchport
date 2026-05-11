export type RunStateFile = {
  runId: string;
  rootPid: number;
  command: string[];
  workspace: string;
  worktree: string;
  mode: "local-port" | "local-proxy";
  createdAt: string;
  configPath: string | null;
  proxies: Record<
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
      pid: number;
      runId: string;
      updatedAt: string;
    }
  >;
};

/** Path-based routing: which worktree serves `switchables` paths for a proxy name. */
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

/** Written by `orchport proxy up` (privileged daemon). */
export type ProxyDaemonStateFile = {
  version: 1;
  pid: number;
  /** Main reverse proxy listener (high port, TLS when configured). */
  mainPort: number;
  /** Privileged extra HTTPS listener (e.g. 443), or null if bind failed / skipped. */
  httpsPort: number | null;
  tls: boolean;
  /** TLS material source. Missing in older state files. */
  tlsKind?: "dev" | "file" | "none";
  /** PEM path for dev TLS or file TLS cert (optional). */
  certPath: string | null;
  /** Hostnames covered by generated dev TLS. Empty/missing for file TLS or older state. */
  tlsHosts?: string[];
  startedAt: string;
};

/** One `orchport run` registration consumed by the daemon (`proxy/routes/<runId>.json`). */
export type ProxyRouteRegistrationFile = {
  version: 1;
  runId: string;
  pid: number;
  routes: Record<string, number>;
  switchRouting?: {
    hostToEntry: Record<string, string>;
    /** Serialized path-switch patterns per proxy name. */
    proxySwitchables: Record<string, string[]>;
    sld: string;
    tld: string;
    worktree: string;
  };
  createdAt: string;
};
