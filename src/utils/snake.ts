/** entry key `admin-api` -> env prefix `ADMIN_API` */
export const entryKeyToEnvPrefix = (key: string): string =>
  key
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .toUpperCase();
