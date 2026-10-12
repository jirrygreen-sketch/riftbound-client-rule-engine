export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonObject = { readonly [key: string]: JsonValue };

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 64) {
    return false;
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return typeof value !== "number" || Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(item => isJsonValue(item, depth + 1));
  }

  return isPlainRecord(value) &&
    Object.getOwnPropertySymbols(value).length === 0 &&
    Object.values(value).every(item => isJsonValue(item, depth + 1));
}

export function requireJsonValue(value: unknown, path: string): JsonValue {
  if (!isJsonValue(value)) {
    throw new Error(`${path} must contain only JSON values`);
  }
  return value as JsonValue;
}

export function requireJsonObject(value: unknown, path: string): JsonObject {
  if (!isPlainRecord(value) || !isJsonValue(value)) {
    throw new Error(`${path} must be a JSON object`);
  }
  return value as JsonObject;
}

export function stableStringify(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(",")}]`;
  }

  const record = value as { [key: string]: JsonValue };
  const entries = Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key] as JsonValue)}`);
  return `{${entries.join(",")}}`;
}
