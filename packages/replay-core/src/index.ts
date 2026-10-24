export type ReplaySeed = string | number;
export type ReplayHash = string | null;

export {
  canonicalReplayJson,
  parseCanonicalReplayJson,
  persistedReplayJson,
  reviveLegacyJournalCounters,
  revivePersistedReplayJson,
  stringifyCanonicalReplayJson,
  stringifyPersistedReplayJson
} from "./canonical-json.js";

export interface ReplayPlayerIdentity {
  readonly id: string;
  readonly name: string;
}

export interface ReplayEvent {
  readonly seq: number;
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface ReplayEnvelope {
  readonly rulesetId: string;
  readonly protocolVersion: string;
  readonly cardDataVersion: string;
  readonly seed: ReplaySeed;
  readonly players: readonly ReplayPlayerIdentity[];
  /**
   * Hash of the authoritative state before the first recorded event.
   * `null` is the explicit placeholder for a replay that has not been hashed.
   */
  readonly initialStateHash: ReplayHash;
  /**
   * Hash of the event log before the first recorded event.
   * `null` is the explicit placeholder for a replay that has not been hashed.
   */
  readonly initialEventHash: ReplayHash;
  readonly events: readonly ReplayEvent[];
}

export interface ReplayEnvelopeInput {
  readonly rulesetId: string;
  readonly protocolVersion: string;
  readonly cardDataVersion: string;
  readonly seed: ReplaySeed;
  readonly players: readonly ReplayPlayerIdentity[];
  readonly initialStateHash: ReplayHash;
  readonly initialEventHash: ReplayHash;
  readonly events: readonly ReplayEvent[];
}

export class ReplayValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ReplayValidationError";
    this.path = path;
  }
}

const TOP_LEVEL_KEYS = [
  "rulesetId",
  "protocolVersion",
  "cardDataVersion",
  "seed",
  "players",
  "initialStateHash",
  "initialEventHash",
  "events"
] as const;

const PLAYER_KEYS = ["id", "name"] as const;
const EVENT_KEYS = ["seq", "type", "data"] as const;
const MAX_PLAYERS = 8;
const MAX_EVENT_DEPTH = 64;

const HIDDEN_HAND_KEYS = new Set([
  "hand",
  "hiddenhand",
  "privatehand",
  "concealedhand",
  "opponenthand"
]);

function fail(path: string, message: string): never {
  throw new ReplayValidationError(path, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function setOwn(
  target: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true
  });
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[]
): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function requireExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string
): void {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail(path, "symbol keys are not supported");
  }

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail(`${path}.${key}`, "is required");
    }
  }

  const allowedKeys = new Set(keys);
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknownKey !== undefined) {
    fail(`${path}.${unknownKey}`, "unknown field");
  }
}

function requireText(
  value: unknown,
  path: string,
  maxLength: number
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(path, "must be a non-empty string");
  }
  if (value.length > maxLength) {
    fail(path, `must be at most ${maxLength} characters`);
  }
  return value;
}

function requireInteger(
  value: unknown,
  path: string,
  minimum: number
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(path, `must be a safe integer greater than or equal to ${minimum}`);
  }
  return value as number;
}

function normalizeHash(value: unknown, path: string): ReplayHash {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    fail(path, "must be null or a non-empty hash string");
  }
  if (value.length > 256) {
    fail(path, "must be at most 256 characters");
  }
  return value;
}

function normalizeSeed(value: unknown, path: string): ReplaySeed {
  if (typeof value === "string") {
    return requireText(value, path, 256);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }
  fail(path, "must be a non-empty string or a safe integer");
}

function normalizePlayer(
  value: unknown,
  index: number
): ReplayPlayerIdentity {
  const path = `players[${index}]`;
  if (!isRecord(value)) {
    fail(path, "must be an object");
  }
  requireExactKeys(value, PLAYER_KEYS, path);

  return {
    id: requireText(value.id, `${path}.id`, 128),
    name: requireText(value.name, `${path}.name`, 64)
  };
}

function normalizePlayers(value: unknown): readonly ReplayPlayerIdentity[] {
  if (!Array.isArray(value)) {
    fail("players", "must be an array");
  }
  if (value.length === 0 || value.length > MAX_PLAYERS) {
    fail("players", `must contain between 1 and ${MAX_PLAYERS} players`);
  }

  const players = value.map(normalizePlayer);
  const ids = players.map((player) => player.id);
  if (new Set(ids).size !== ids.length) {
    fail("players", "must contain unique player ids");
  }
  return players;
}

function normalizeEventData(
  value: unknown,
  path: string,
  depth: number
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    fail(path, "must be a JSON object");
  }
  if (depth > MAX_EVENT_DEPTH) {
    fail(path, `must not exceed ${MAX_EVENT_DEPTH} levels of nesting`);
  }

  const data: Record<string, unknown> = {};
  const keys = Object.keys(value).sort();
  for (const key of keys) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");
    if (HIDDEN_HAND_KEYS.has(normalizedKey)) {
      fail(`${path}.${key}`, "hidden hand data cannot be recorded");
    }
    setOwn(
      data,
      key,
      normalizeJsonValue(value[key], `${path}.${key}`, depth + 1)
    );
  }
  return data;
}

function normalizeJsonValue(
  value: unknown,
  path: string,
  depth: number
): unknown {
  if (depth > MAX_EVENT_DEPTH) {
    fail(path, `must not exceed ${MAX_EVENT_DEPTH} levels of nesting`);
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    if (typeof value === "string" && value.length > 16_384) {
      fail(path, "string values must be at most 16384 characters");
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(path, "number values must be finite");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      fail(path, "symbol keys are not supported");
    }
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        fail(`${path}[${index}]`, "sparse arrays are not supported");
      }
      result.push(normalizeJsonValue(value[index], `${path}[${index}]`, depth + 1));
    }
    return result;
  }
  if (isRecord(value)) {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      fail(path, "symbol keys are not supported");
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");
      if (HIDDEN_HAND_KEYS.has(normalizedKey)) {
        fail(`${path}.${key}`, "hidden hand data cannot be recorded");
      }
      setOwn(
        result,
        key,
        normalizeJsonValue(value[key], `${path}.${key}`, depth + 1)
      );
    }
    return result;
  }
  fail(path, "must contain only JSON values");
}

function normalizeEvent(value: unknown, index: number): ReplayEvent {
  const path = `events[${index}]`;
  if (!isRecord(value)) {
    fail(path, "must be an object");
  }
  requireExactKeys(value, EVENT_KEYS, path);

  const seq = requireInteger(value.seq, `${path}.seq`, 1);
  if (seq !== index + 1) {
    if (seq < index + 1) {
      fail(
        `${path}.seq`,
        `must be strictly increasing; expected ${index + 1}, received ${seq}`
      );
    }
    fail(`${path}.seq`, `must be contiguous; expected ${index + 1}, received ${seq}`);
  }

  return {
    seq,
    type: requireText(value.type, `${path}.type`, 128),
    data: normalizeEventData(value.data, `${path}.data`, 0)
  };
}

function normalizeEvents(value: unknown): readonly ReplayEvent[] {
  if (!Array.isArray(value)) {
    fail("events", "must be an array");
  }
  return value.map(normalizeEvent);
}

function stableClone(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stableClone);
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      setOwn(result, key, stableClone(value[key]));
    }
    return result;
  }
  fail("$", "cannot serialize a non-JSON value");
}

/**
 * Validate and normalize a replay envelope without mutating the input.
 * Event sequences must be contiguous and start at 1.
 */
export function validateReplayEnvelope(input: unknown): ReplayEnvelope {
  if (!isRecord(input)) {
    fail("$", "replay must be an object");
  }
  requireExactKeys(input, TOP_LEVEL_KEYS, "$");

  return {
    rulesetId: requireText(input.rulesetId, "rulesetId", 128),
    protocolVersion: requireText(input.protocolVersion, "protocolVersion", 64),
    cardDataVersion: requireText(input.cardDataVersion, "cardDataVersion", 128),
    seed: normalizeSeed(input.seed, "seed"),
    players: normalizePlayers(input.players),
    initialStateHash: normalizeHash(
      input.initialStateHash,
      "initialStateHash"
    ),
    initialEventHash: normalizeHash(input.initialEventHash, "initialEventHash"),
    events: normalizeEvents(input.events)
  };
}

/**
 * Serialize a replay using a deterministic, stable key order.
 */
export function serializeReplay(input: ReplayEnvelopeInput): string {
  const replay = validateReplayEnvelope(input);
  return JSON.stringify(stableClone(replay));
}

/**
 * Parse a serialized replay and reject malformed JSON or invalid envelopes.
 */
export function parseReplay(serialized: string): ReplayEnvelope {
  if (typeof serialized !== "string") {
    fail("$", "serialized replay must be a string");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    fail("$", `could not parse replay JSON: ${detail}`);
  }

  return validateReplayEnvelope(parsed);
}

export function isReplayEnvelope(value: unknown): value is ReplayEnvelope {
  try {
    validateReplayEnvelope(value);
    return true;
  } catch {
    return false;
  }
}
