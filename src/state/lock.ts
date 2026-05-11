/**
 * Small cross-process locks under the orchport state directory.
 */
import { mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";

import { ErrorCode, OrchportError } from "../utils/errors.ts";
import { getStateDir } from "./xdg.ts";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const lockPath = (name: string): string =>
  join(getStateDir(), "locks", `${name}.lock`);

const acquireLock = async (
  name: string,
  options?: { optional?: boolean; timeoutMs?: number }
): Promise<(() => Promise<void>) | null> => {
  const dir = lockPath(name);
  const deadline = Date.now() + (options?.timeoutMs ?? 5000);
  try {
    await mkdir(join(getStateDir(), "locks"), { recursive: true });
  } catch (err) {
    if (options?.optional === true) {
      return null;
    }
    throw err;
  }

  for (;;) {
    try {
      /* eslint-disable-next-line no-await-in-loop -- lock acquisition must retry sequentially */
      await mkdir(dir);
      return async () => {
        await rmdir(dir).catch(() => {
          /* stale cleanup is best effort */
        });
      };
    } catch (err) {
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? Reflect.get(err, "code")
          : undefined;
      if (code !== "EEXIST") {
        if (options?.optional === true) {
          return null;
        }
        throw err;
      }
      if (Date.now() > deadline) {
        if (options?.optional === true) {
          return null;
        }
        throw new OrchportError(
          ErrorCode.STATE_LOCK,
          `Timed out waiting for orchport state lock ${name}`,
          {
            hint: "Another orchport process may be stuck; inspect the state directory locks.",
            context: { lock: dir },
          }
        );
      }
      /* eslint-disable-next-line no-await-in-loop -- sequential retry backoff */
      await sleep(25);
    }
  }
};

export const withStateLock = async <T>(
  name: string,
  fn: () => Promise<T>,
  options?: { optional?: boolean; timeoutMs?: number }
): Promise<{ locked: boolean; value: T }> => {
  const release = await acquireLock(name, options);
  if (release === null) {
    return { locked: false, value: await fn() };
  }
  try {
    return { locked: true, value: await fn() };
  } finally {
    await release();
  }
};
