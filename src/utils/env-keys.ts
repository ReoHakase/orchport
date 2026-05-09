/**
 * Reserved keys emitted by orchport or used for nesting. User `env` in config
 * cannot override these (including legacy lowercase `orchport*` for migration).
 */
export const isReservedOrchportEnvKey = (key: string): boolean =>
  key === "ORCHPORT" ||
  key.startsWith("ORCHPORT_") ||
  key === "orchport" ||
  key.startsWith("orchport_");

/** Nested run pass-through: parent sets marker for child wrappers. */
export const isNestedOrchportMarker = (env: NodeJS.ProcessEnv): boolean =>
  env.ORCHPORT === "1" || env.orchport === "1";
