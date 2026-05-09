/**
 * Normalize config `tld` for hostnames: default `.localhost`; ensure a leading `.`.
 * Accepts `localhost`, `.test`, `internal`, etc.
 */
export const normalizeConfigTld = (raw: string | undefined): string => {
  if (raw === undefined || raw.trim() === "") {
    return ".localhost";
  }
  const t = raw.trim();
  return t.startsWith(".") ? t : `.${t}`;
};
