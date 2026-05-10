import { randomBytes } from "node:crypto";

export const newRunId = (): string => randomBytes(8).toString("hex");
