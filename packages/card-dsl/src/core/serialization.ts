import type { JsonObject, JsonValue } from "./types.js";
import { parseCardDsl } from "./validation.js";

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const objectValue = value as JsonObject;
  const entries = Object.keys(objectValue)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(objectValue[key]!)}`);
  return `{${entries.join(",")}}`;
}

export function serializeCardDsl(input: unknown): string {
  return canonicalJson(parseCardDsl(input) as unknown as JsonValue);
}

export function stableHashCardDsl(input: unknown): string {
  const bytes = new TextEncoder().encode(serializeCardDsl(input));
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }

  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}
