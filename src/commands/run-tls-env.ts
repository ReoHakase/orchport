/**
 * Inject dev TLS PEM paths into the child environment for Node/Bun/Deno trust.
 */
import { resolve } from "node:path";

import { getLogger } from "@logtape/logtape";

const log = getLogger(["orchport", "run"]);

export const applyProxyTlsCertToChildEnv = (
  childEnv: Record<string, string | undefined>,
  certPath: string
): void => {
  const certAbs = resolve(certPath);
  childEnv.ORCHPORT_DEV_TLS_CERT_FILE = certAbs;
  log.trace("run: child ORCHPORT_DEV_TLS_CERT_FILE={path}", { path: certAbs });

  if (!childEnv.NODE_EXTRA_CA_CERTS?.trim()) {
    childEnv.NODE_EXTRA_CA_CERTS = certAbs;
    log.trace("run: child NODE_EXTRA_CA_CERTS set from proxy TLS cert");
  } else {
    log.debug(
      "run: NODE_EXTRA_CA_CERTS already set; not overriding (merge ORCHPORT_DEV_TLS_CERT_FILE manually if needed)"
    );
  }

  if (!childEnv.DENO_CERT?.trim()) {
    childEnv.DENO_CERT = certAbs;
    log.trace("run: child DENO_CERT set from proxy TLS cert");
  } else {
    log.debug(
      "run: DENO_CERT already set; not overriding (merge ORCHPORT_DEV_TLS_CERT_FILE manually for Deno if needed)"
    );
  }
};
