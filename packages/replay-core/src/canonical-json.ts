/**
 * Convert journal-bearing runtime values to their persisted JSON form.
 *
 * The headless journal can contain Map/Set instances and own properties whose
 * value is undefined. Plain JSON.stringify silently turns an empty Map into
 * `{}` and drops undefined-valued properties, so a digest made before storage
 * can disagree with the same journal read back from disk. Keep the runtime
 * encoding explicit and use it for both hashing and serialization.
 */
function encodeReplayJson(value: unknown, path: string, sortKeys: boolean): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only finite JSON numbers`);
    return value;
  }
  if (value === undefined) return undefined;
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`${path} must contain only JSON-compatible replay values`);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      const canonical = encodeReplayJson(entry, `${path}[${index}]`, sortKeys);
      if (canonical === undefined) throw new TypeError(`${path}[${index}] must not be undefined`);
      return canonical;
    });
  }
  if (value instanceof Map) {
    return { map: [...value.entries()].map(([key, entry], index) => {
      const canonicalKey = encodeReplayJson(key, `${path}.<map-key:${index}>`, sortKeys);
      const canonicalEntry = encodeReplayJson(entry, `${path}.<map-value:${index}>`, sortKeys);
      if (canonicalKey === undefined || canonicalEntry === undefined) {
        throw new TypeError(`${path} must not contain undefined Map entries`);
      }
      return [canonicalKey, canonicalEntry];
    }) };
  }
  if (value instanceof Set) {
    return { set: [...value].map((entry, index) => {
      const canonical = encodeReplayJson(entry, `${path}.<set:${index}>`, sortKeys);
      if (canonical === undefined) throw new TypeError(`${path} must not contain undefined Set entries`);
      return canonical;
    }) };
  }
  if (typeof value !== "object") throw new TypeError(`${path} has an unsupported value type`);

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain only plain JSON objects`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${path} must not contain symbol keys`);
  }

  const output: Record<string, unknown> = {};
  const keys = Object.keys(value as Record<string, unknown>);
  if (sortKeys) keys.sort();
  for (const key of keys) {
    const canonical = encodeReplayJson((value as Record<string, unknown>)[key], `${path}.${key}`, sortKeys);
    if (canonical !== undefined) output[key] = canonical;
  }
  return output;
}

/** Runtime JSON projection that preserves the integrity hash's existing key order. */
export function persistedReplayJson(value: unknown): unknown {
  return encodeReplayJson(value, "$", false);
}

/** JSON used by the persisted headless journal and its integrity hash. */
export function stringifyPersistedReplayJson(value: unknown): string {
  return JSON.stringify(persistedReplayJson(value));
}

/** Stable key-sorted JSON for callers that explicitly need canonical ordering. */
export function canonicalReplayJson(value: unknown): unknown {
  return encodeReplayJson(value, "$", true);
}

export function stringifyCanonicalReplayJson(value: unknown): string {
  return JSON.stringify(canonicalReplayJson(value));
}

/** Recreate exactly the journal shape obtained after a canonical JSON round-trip. */
export function parseCanonicalReplayJson<T = unknown>(serialized: string): T {
  return JSON.parse(serialized) as T;
}

/** Restore Maps and Sets represented by the persistent replay encoding. */
export function revivePersistedReplayJson(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(entry => revivePersistedReplayJson(entry));
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === "map" && Array.isArray(record.map)) {
    return new Map(record.map.map(entry => {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new TypeError("Persisted replay map entries must be [key, value] pairs");
      }
      return [revivePersistedReplayJson(entry[0]), revivePersistedReplayJson(entry[1])];
    }));
  }
  if (keys.length === 1 && keys[0] === "set" && Array.isArray(record.set)) {
    return new Set(record.set.map(revivePersistedReplayJson));
  }
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [
    key,
    revivePersistedReplayJson(entry),
  ]));
}

/**
 * Restore one persisted journal after a legacy plain-JSON write.
 *
 * Older headless archives serialized every empty Map counter collection as
 * `{}`. The event contract identifies `counters` as a string-to-number map,
 * so restoring that exact field is a lossless migration; no other `{}` is
 * reinterpreted as a Map.
 */
export function reviveLegacyJournalCounters(value: unknown, path = "$"): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((entry, index) => reviveLegacyJournalCounters(entry, `${path}[${index}]`));
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return value;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
    key,
    key === "counters" && isPersistedCounterRecord(entry)
      ? { map: Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)) }
      : reviveLegacyJournalCounters(entry, `${path}.${key}`),
  ]));
}

function isPersistedCounterRecord(value: unknown): value is Record<string, number> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    !(value instanceof Map) && !(value instanceof Set) &&
    Object.values(value as Record<string, unknown>).every(entry =>
      typeof entry === "number" && Number.isFinite(entry));
}

