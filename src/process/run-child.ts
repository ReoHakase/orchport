import type { Subprocess } from "bun";

export type SpawnOptions = {
  cmd: string[];
  env: Record<string, string | undefined>;
  cwd: string;
};

export const spawnInherit = (options: SpawnOptions): Subprocess => {
  const envObj: Record<string, string> = {};
  for (const [k, v] of Object.entries(options.env)) {
    if (v !== undefined) {
      envObj[k] = v;
    }
  }
  return Bun.spawn({
    cmd: options.cmd,
    env: envObj,
    cwd: options.cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
};

export const forwardSignalsToChild = (child: Subprocess): (() => void) => {
  const handler = (sig: NodeJS.Signals) => {
    try {
      child.kill(sig);
    } catch {
      /* ignore */
    }
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
};
