import type { JsonObject, JsonValue, JudgeReviewRequest } from "./types.js";

export function stableStringify(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const objectValue = value as JsonObject;
  const entries = Object.keys(objectValue)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(objectValue[key]!)}`);
  return `{${entries.join(",")}}`;
}

export function stableHash(value: JsonValue): string {
  const bytes = new TextEncoder().encode(stableStringify(value));
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }

  return hash.toString(16).padStart(16, "0");
}

export function createReviewRequestId(
  request: Omit<JudgeReviewRequest, "requestId">
): string {
  return `judge-review-${stableHash(request as unknown as JsonValue)}`;
}
