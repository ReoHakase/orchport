export const pickString = (obj: object, key: string): string | undefined => {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    return undefined;
  }
  const v = Reflect.get(obj, key);
  return typeof v === "string" ? v : undefined;
};

export const pickBoolean = (obj: object, key: string): boolean | undefined => {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    return undefined;
  }
  const v = Reflect.get(obj, key);
  return typeof v === "boolean" ? v : undefined;
};

export const pickStringArray = (
  obj: object,
  key: string
): string[] | undefined => {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    return undefined;
  }
  const v = Reflect.get(obj, key);
  return Array.isArray(v) && v.every((x) => typeof x === "string")
    ? v
    : undefined;
};

export const isRecord = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);
