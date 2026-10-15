/**
 * Source-bound DATA description for the four reviewed fixed point-damage
 * Spell printings.  This recogniser intentionally has no executable meaning:
 * it only accepts the complete printed ability and carries the whole printing
 * tuple needed by a later registry binding.
 */

import { normalizeAbilityText } from "./ability-bindings.js";
import type { DuelSourcePrintingCard } from "./official-programs.js";

export const DUEL_POINT_DAMAGE_DESCRIPTION_V1_KIND = "point-damage-description-v1" as const;

export type DuelPointDamageLocationV1 = "battlefield" | "any";

export interface DuelPointDamageV1Semantics {
  readonly kind: "point-damage";
  readonly amount: 2 | 3 | 6 | 8;
  readonly target: {
    readonly kind: "unit";
    readonly controller: "any";
    readonly location: DuelPointDamageLocationV1;
    readonly minSelections: 1;
    readonly maxSelections: 1;
  };
}

export interface DuelPointDamageV1Source {
  readonly normalizedAbilityText: string;
  readonly cardType: "Spell";
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
  readonly canonicalCardId: string;
  readonly name: string;
  readonly fullName: string;
  readonly localizedName: string;
  readonly setCode: string;
  readonly cardNumber: string;
  readonly variant: string;
}

export interface DuelPointDamageV1Known {
  readonly status: "known";
  readonly kind: typeof DUEL_POINT_DAMAGE_DESCRIPTION_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly source: DuelPointDamageV1Source;
  readonly printedAmount: 2 | 3 | 6 | 8;
  readonly semantics: DuelPointDamageV1Semantics;
}

export type DuelPointDamageV1UnknownReason =
  | "not-spell"
  | "ability-not-pure-point-damage"
  | "unsupported-damage-amount";

export interface DuelPointDamageV1Unknown {
  readonly status: "unknown";
  readonly kind: typeof DUEL_POINT_DAMAGE_DESCRIPTION_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly normalizedAbilityText: string;
  readonly reason: DuelPointDamageV1UnknownReason;
}

export type DuelPointDamageV1Description = DuelPointDamageV1Known | DuelPointDamageV1Unknown;

const CARD_FIELDS = [
  "id", "cardType", "ability", "energy", "power", "might", "domains", "tags",
  "canonicalCardId", "name", "fullName", "localizedName", "setCode", "cardNumber", "variant",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshot(value: unknown, label: string, seen = new Set<object>()): unknown {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || seen.has(value) || seen.size >= 64) {
    throw new TypeError(`Duel point damage: ${label} must be acyclic ordinary data.`);
  }
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Duel point damage: ${label} must be ordinary data.`);
  }
  seen.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, "length");
      if (!length || !("value" in length) || !Number.isSafeInteger(length.value) ||
          length.value < 0 || keys.length !== length.value + 1) {
        throw new TypeError(`Duel point damage: ${label} must be a dense array.`);
      }
      const result: unknown[] = [];
      for (let i = 0; i < length.value; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError(`Duel point damage: ${label}[${i}] must be an own data property.`);
        }
        result.push(snapshot(descriptor.value, `${label}[${i}]`, seen));
      }
      return result;
    }
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== "string" || !descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError(`Duel point damage: ${label} requires enumerable own data fields.`);
      }
      Object.defineProperty(result, key, {
        value: snapshot(descriptor.value, `${label}.${key}`, seen), enumerable: true,
        configurable: true, writable: true,
      });
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function assertCard(value: unknown): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw new TypeError("Duel point damage: card must be an object.");
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Duel point damage: card requires enumerable own data fields.");
    }
  }
  for (const key of CARD_FIELDS) if (!Object.hasOwn(value, key)) {
    throw new TypeError(`Duel point damage: card.${key} is required.`);
  }
  if (typeof value.id !== "string" || value.id.length === 0 || typeof value.cardType !== "string" || value.cardType.length === 0) {
    throw new TypeError("Duel point damage: card id/cardType must be non-empty strings.");
  }
  if (value.ability !== null && value.ability !== undefined && typeof value.ability !== "string") {
    throw new TypeError("Duel point damage: card.ability must be a string, null or undefined.");
  }
  for (const key of ["energy", "power", "might"] as const) {
    if (value[key] !== null && (typeof value[key] !== "number" || !Number.isSafeInteger(value[key]) || value[key] < 0)) {
      throw new TypeError(`Duel point damage: card.${key} must be a nonnegative integer or null.`);
    }
  }
  for (const key of ["domains", "tags"] as const) {
    const list = value[key];
    if (!Array.isArray(list) || Object.getPrototypeOf(list) !== Array.prototype ||
        Reflect.ownKeys(list).length !== list.length + 1 ||
        list.some((item) => typeof item !== "string" || item.length === 0)) {
      throw new TypeError(`Duel point damage: card.${key} must be a dense string array.`);
    }
  }
  for (const key of ["canonicalCardId", "name", "fullName", "localizedName", "setCode", "cardNumber", "variant"] as const) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      throw new TypeError(`Duel point damage: card.${key} must be a non-empty string.`);
    }
  }
}

const ACTION_PREFIX = "[Action] (Play on your turn or in showdowns.)";
const WHOLE_TEXT = new Map<string, { amount: 2 | 3 | 6 | 8; location: DuelPointDamageLocationV1 }>([
  [`${ACTION_PREFIX}\nDeal 2 to a unit at a battlefield.`, { amount: 2, location: "battlefield" }],
  [`${ACTION_PREFIX}\nDeal 3 to a unit at a battlefield.`, { amount: 3, location: "battlefield" }],
  [`${ACTION_PREFIX}\nDeal 6 to a unit at a battlefield.`, { amount: 6, location: "battlefield" }],
  [`${ACTION_PREFIX}\nDeal 8 to a unit.`, { amount: 8, location: "any" }],
]);

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

export function describeDuelPointDamageV1(card: DuelSourcePrintingCard): DuelPointDamageV1Description {
  const copy = snapshot(card, "card") as Record<string, unknown>;
  assertCard(copy);
  const normalized = normalizeAbilityText(copy.ability as string | null | undefined);
  const base = {
    cardId: copy.id as string,
    canonicalCardId: copy.canonicalCardId as string,
  };
  if (copy.cardType !== "Spell") {
    return freezeDeep({ ...base, status: "unknown" as const, kind: DUEL_POINT_DAMAGE_DESCRIPTION_V1_KIND,
      normalizedAbilityText: normalized, reason: "not-spell" as const });
  }
  const parsed = WHOLE_TEXT.get(normalized);
  if (parsed === undefined) {
    return freezeDeep({ ...base, status: "unknown" as const, kind: DUEL_POINT_DAMAGE_DESCRIPTION_V1_KIND,
      normalizedAbilityText: normalized,
      reason: /^\[Action\][\s\S]*\nDeal (?:\d+) to a unit(?: at a battlefield)?\.$/u.test(normalized)
        ? "unsupported-damage-amount" as const : "ability-not-pure-point-damage" as const });
  }
  const source: DuelPointDamageV1Source = {
    normalizedAbilityText: normalized, cardType: "Spell", energy: copy.energy as number | null,
    power: copy.power as number | null, might: copy.might as number | null, domains: [...(copy.domains as string[])],
    tags: [...(copy.tags as string[])], canonicalCardId: copy.canonicalCardId as string,
    name: copy.name as string, fullName: copy.fullName as string,
    localizedName: copy.localizedName as string, setCode: copy.setCode as string,
    cardNumber: copy.cardNumber as string, variant: copy.variant as string,
  };
  const semantics: DuelPointDamageV1Semantics = {
    kind: "point-damage", amount: parsed.amount,
    target: { kind: "unit", controller: "any", location: parsed.location, minSelections: 1, maxSelections: 1 },
  };
  return freezeDeep({ ...base, status: "known" as const, kind: DUEL_POINT_DAMAGE_DESCRIPTION_V1_KIND,
    source, printedAmount: parsed.amount, semantics });
}
