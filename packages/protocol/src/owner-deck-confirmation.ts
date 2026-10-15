import { DUEL_RULESET_ID } from "./duel-contract.js";

/** Owner-only server state, never part of RoomView, events or a request ACK. */
export const OWNER_DECK_CONFIRMATION_SCHEMA = "owner-deck-confirmation-v1" as const;
export const OWNER_DECK_ZONES = [
  "mainDeck", "runes", "legend", "champion", "battlefields", "sideboard"
] as const;

export type OwnerDeckZone = (typeof OWNER_DECK_ZONES)[number];
export interface OwnerDeckEntry {
  readonly cardId: string;
  readonly quantity: number;
}
/** A canonical, unique-per-zone printing inventory (not a password digest). */
export type OwnerDeckEcho = Readonly<Partial<Record<OwnerDeckZone, readonly OwnerDeckEntry[]>>>;

export interface OwnerDeckConfirmationMessage {
  readonly type: "owner-deck-confirmation";
  readonly schema: typeof OWNER_DECK_CONFIRMATION_SCHEMA;
  readonly roomId: string;
  readonly playerId: string;
  readonly rulesetId: "riftbound-foundation" | typeof DUEL_RULESET_ID;
  readonly roomVersion: number;
  readonly roomEventSeq: number;
  readonly catalog: {
    readonly dataVersion: string;
    readonly digest: string;
  };
  /** Null is an explicit server-owned absence, NOT an empty or inferred deck. */
  readonly deck: OwnerDeckEcho | null;
}

/**
 * Plain record: a non-null, non-array object whose prototype is exactly
 * `Object.prototype` or `null`. A custom prototype (including one carrying
 * inherited "extra" keys) is rejected so nothing is smuggled through the chain.
 * Frozen / readonly objects remain valid (`writable` is not part of the check).
 */
function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Own keys must all be enumerable string data properties. A symbol key, a
 * non-enumerable key, or an own accessor (getter/setter) makes the object
 * non-canonical. Accessors are detected through their property DESCRIPTOR, so a
 * getter is never invoked just to be inspected. Returns the own string keys, or
 * `null` when the object is not canonical.
 */
function ownDataKeys(value: object): string[] | null {
  const keys: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return null;
    keys.push(key);
  }
  return keys;
}

/** Exact key set computed over ALL own keys (`Reflect.ownKeys`), never `Object.keys`. */
function exact(value: object, keys: readonly string[]): boolean {
  const own = ownDataKeys(value);
  return own !== null && own.length === keys.length && keys.every(key => own.includes(key));
}

/**
 * Strict dense plain array: exactly `Array.prototype` with only canonical,
 * in-range index data properties plus the non-enumerable `length`. Rejects holes,
 * accessors (without invoking them), symbol/non-index extras and exotic
 * prototypes (e.g. `Object.setPrototypeOf(arr, null)` or an `Array` subclass).
 */
function plainArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Array.prototype) return false;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) return false;
  const length = value.length;
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string") return false;
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return false;
  }
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) return false;
  }
  return true;
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function parseOwnerDeckConfirmation(value: unknown): boolean {
  if (!record(value) || !exact(value, [
    "type", "schema", "roomId", "playerId", "rulesetId", "roomVersion",
    "roomEventSeq", "catalog", "deck"
  ]) || value.type !== "owner-deck-confirmation" ||
      value.schema !== OWNER_DECK_CONFIRMATION_SCHEMA ||
      !text(value.roomId, 64) || !text(value.playerId, 128) ||
      (value.rulesetId !== "riftbound-foundation" && value.rulesetId !== DUEL_RULESET_ID) ||
      !Number.isSafeInteger(value.roomVersion) || (value.roomVersion as number) < 1 ||
      !Number.isSafeInteger(value.roomEventSeq) || (value.roomEventSeq as number) < 0) return false;

  const catalog = value.catalog;
  if (!record(catalog) || !exact(catalog, ["dataVersion", "digest"]) ||
      !text(catalog.dataVersion, 256) || !text(catalog.digest, 256)) return false;

  const deck = value.deck;
  if (deck === null) return true;
  if (!record(deck)) return false;
  const zones = ownDataKeys(deck);
  if (zones === null ||
      zones.some(zone => !(OWNER_DECK_ZONES as readonly string[]).includes(zone))) return false;

  let total = 0;
  for (const zone of OWNER_DECK_ZONES) {
    const entries = deck[zone];
    if (entries === undefined) continue;
    if (!plainArray(entries)) return false;
    const ids = new Set<string>();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!record(entry) || !exact(entry, ["cardId", "quantity"]) ||
          !text(entry.cardId, 256) || ids.has(entry.cardId) ||
          !Number.isSafeInteger(entry.quantity) || (entry.quantity as number) < 1 ||
          !Number.isSafeInteger(total + (entry.quantity as number))) return false;
      ids.add(entry.cardId);
      total += entry.quantity as number;
    }
  }
  return total > 0;
}

/**
 * Strictly parse only an outbound private echo; this does NOT parse deck submissions.
 *
 * Canonical shape: plain records (Object.prototype or null prototype) with exact
 * enumerable own string data keys, dense `Array.prototype` arrays, and no accessors.
 * A raw `Proxy` has no side-effect-free guarantee; a hostile trap that throws is
 * converted to `false` (fail closed) rather than propagating or authenticating.
 */
export function isOwnerDeckConfirmationMessage(value: unknown): value is OwnerDeckConfirmationMessage {
  try {
    return parseOwnerDeckConfirmation(value);
  } catch {
    return false;
  }
}
