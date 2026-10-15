/**
 * Pure-DATA recogniser for the whole-ability Unit **Accelerate** optional
 * additional cost (schema `optional-play-cost-v1`).
 *
 * Boundary (read this first):
 *
 *   - This is a STRICT, TEXT-MATCHING DATA DESCRIPTOR. It recognises one whole
 *     ability shape and returns a frozen description of the printed cost. It is
 *     NOT an authority, NOT a SourceProgramClosure, NOT an executable card
 *     program, and it is NOT registered in the official-program registry.
 *   - It never mints capabilities: the result carries no `privateUID`, no
 *     per-printing epoch, no mint receipt, no `sourceProof` flag and no encoded
 *     executable reference. A caller must not treat the returned object as a
 *     licence to pay a cost; a trusted catalog layer and the Core executor own
 *     payment, choice receipts and replacement-effect wiring.
 *   - Only the COMPLETE whole ability is recognised. Any extra instruction
 *     (Jinx / discard, Assault, "When you conquer", another keyword, a second
 *     Accelerate, an unknown trailing sentence, …) makes the printing `unknown`.
 *     Containment of the `[Accelerate]` keyword is never sufficient.
 *   - `unknown` NEVER degrades to a blank program or a no-ability template.
 *
 * Source of the literal text: the verified catalog's real Unit Accelerate
 * reminder, consistent with CR v1.4 805.1.a
 * (`As you play me, you may pay [1][C] as an additional cost. If you do, I
 * enter ready.`), 805.1.a.1 (power must match one of the unit's domains) and
 * 805.1.a.2 (a unit with no domain may pay the power with any domain).
 */

import { normalizeAbilityText } from "./ability-bindings.js";
import type { DuelSourcePrintingCard } from "./official-programs.js";

/** Fixed schema kind of a recognised optional-play-cost description. */
export const DUEL_OPTIONAL_PLAY_COST_V1_KIND = "optional-play-cost-v1" as const;

/**
 * The six Rune domains of the current baseline. `Colorless` is deliberately NOT
 * a Rune domain and is never accepted as one; the baseline is exactly these six
 * and no seventh domain is invented.
 */
export const DUEL_OPTIONAL_PLAY_COST_RUNE_DOMAINS = Object.freeze([
  "Fury",
  "Calm",
  "Mind",
  "Body",
  "Chaos",
  "Order",
] as const);

export type DuelOptionalPlayCostRuneDomain =
  (typeof DUEL_OPTIONAL_PLAY_COST_RUNE_DOMAINS)[number];

/** The `[Accelerate]` reminder uses a fixed 1-energy plus one rune-domain symbol. */
const RUNE_SYMBOL_BY_DOMAIN: Readonly<Record<DuelOptionalPlayCostRuneDomain, string>> = Object.freeze({
  Fury: ":rb_rune_fury:",
  Calm: ":rb_rune_calm:",
  Mind: ":rb_rune_mind:",
  Body: ":rb_rune_body:",
  Chaos: ":rb_rune_chaos:",
  Order: ":rb_rune_order:",
});

/**
 * Build the exact whole-ability reminder literal for one domain. The wording is
 * the real catalog reminder; the only variable is the rune-domain symbol.
 */
function accelerateReminder(domain: DuelOptionalPlayCostRuneDomain): string {
  return `[Accelerate] (You may pay :rb_energy_1:${RUNE_SYMBOL_BY_DOMAIN[domain]} as an additional cost to have me enter ready.)`;
}

/** Exact whole-ability literal -> the rune domain it prints. */
const ACCELERATE_WHOLE_TEXT_TO_DOMAIN: ReadonlyMap<string, DuelOptionalPlayCostRuneDomain> = (() => {
  const table = new Map<string, DuelOptionalPlayCostRuneDomain>();
  for (const domain of DUEL_OPTIONAL_PLAY_COST_RUNE_DOMAINS) {
    table.set(accelerateReminder(domain), domain);
  }
  return table;
})();

/** Why a printing is not recognised as a known optional-play-cost description. */
export type DuelOptionalPlayCostV1UnknownReason =
  | "ability-not-pure-accelerate"
  | "not-unit"
  | "non-numeric-source-stat"
  | "unknown-runedomain-token"
  | "accelerate-rune-symbol-mismatch";

/** The printed cost paid for choosing the optional additional cost. */
export interface DuelOptionalPlayCostV1AdditionalCost {
  readonly energy: 1;
  readonly power: readonly Readonly<{
    readonly allowedDomains: readonly DuelOptionalPlayCostRuneDomain[];
    readonly amount: 1;
  }>[];
}

/** What choosing (and paying) the optional additional cost produces. */
export interface DuelOptionalPlayCostV1PaidEffect {
  readonly kind: "enter-ready-replacement";
  readonly timing: "unit-entry";
}

export interface DuelOptionalPlayCostV1Semantics {
  readonly kind: "accelerate";
  readonly choiceTiming: "card-play-choices";
  readonly optional: true;
  readonly additionalCost: DuelOptionalPlayCostV1AdditionalCost;
  readonly paidEffect: DuelOptionalPlayCostV1PaidEffect;
}

/** Source-bound printing projection carried onto a known result. */
export interface DuelOptionalPlayCostV1Source {
  readonly normalizedAbilityText: string;
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
}

/**
 * The printed base cost, listed SEPARATELY. It is never summed into the
 * additional cost; a consumer that pays the optional cost still pays the base
 * cost in the ordinary play steps.
 */
export interface DuelOptionalPlayCostV1PrintedBaseCost {
  readonly energy: number | null;
  readonly power: number | null;
}

export interface DuelOptionalPlayCostV1Known {
  readonly status: "known";
  readonly kind: typeof DUEL_OPTIONAL_PLAY_COST_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly source: DuelOptionalPlayCostV1Source;
  readonly printedBaseCost: DuelOptionalPlayCostV1PrintedBaseCost;
  readonly semantics: DuelOptionalPlayCostV1Semantics;
}

export interface DuelOptionalPlayCostV1Unknown {
  readonly status: "unknown";
  readonly kind: typeof DUEL_OPTIONAL_PLAY_COST_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly normalizedAbilityText: string;
  readonly reason: DuelOptionalPlayCostV1UnknownReason;
}

export type DuelOptionalPlayCostV1Description =
  | DuelOptionalPlayCostV1Known
  | DuelOptionalPlayCostV1Unknown;

// --- Strict DATA boundary (own-data-descriptor reads, no getter contact) ------

const CARD_FIELDS = [
  "id",
  "cardType",
  "ability",
  "energy",
  "power",
  "might",
  "domains",
  "tags",
  "canonicalCardId",
  "name",
  "fullName",
  "localizedName",
  "setCode",
  "cardNumber",
  "variant",
] as const;

/** Fast membership for the required printing tuple; extras are never read. */
const CARD_FIELD_SET: ReadonlySet<string> = new Set(CARD_FIELDS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new TypeError(`Duel optional play cost: ${label} must be an object.`);
  }
}

/**
 * Read the whole printing tuple through own DATA descriptors only. Accessors,
 * sparse arrays, symbol keys and non-enumerable fields are rejected rather than
 * read, so no getter is ever invoked while describing a printing.
 */
function snapshotCard(
  raw: unknown,
  label: string,
  ancestors = new Set<object>(),
  allowKeys?: ReadonlySet<string>,
): unknown {
  if (raw === null || raw === undefined || typeof raw === "string" || typeof raw === "boolean") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "object" || ancestors.has(raw) || ancestors.size >= 64) {
    throw new TypeError(`Duel optional play cost: ${label} must be acyclic data.`);
  }
  const array = Array.isArray(raw);
  const prototype = Object.getPrototypeOf(raw);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Duel optional play cost: ${label} must be ordinary data.`);
  }
  ancestors.add(raw);
  try {
    const keys = Reflect.ownKeys(raw);
    if (array) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(raw, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor) ||
          !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
          keys.length !== lengthDescriptor.value + 1 || !keys.includes("length")) {
        throw new TypeError(`Duel optional play cost: ${label} must be a dense array.`);
      }
      const output: unknown[] = [];
      for (let index = 0; index < lengthDescriptor.value; index++) {
        const item = Object.getOwnPropertyDescriptor(raw, String(index));
        if (!item || !("value" in item) || !item.enumerable) {
          throw new TypeError(`Duel optional play cost: ${label}[${index}] must be an own data property.`);
        }
        output.push(snapshotCard(item.value, `${label}[${index}]`, ancestors));
      }
      return output;
    }
    const output: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const item = Object.getOwnPropertyDescriptor(raw, key);
      // Accessors, symbol keys and non-enumerable fields are rejected, never read.
      if (typeof key !== "string" || !item || !("value" in item) || !item.enumerable) {
        throw new TypeError(`Duel optional play cost: ${label} requires enumerable own data fields.`);
      }
      // When an allow-list is supplied, only the required printing-tuple fields
      // are snapshotted (read); extra fields are validated but never read.
      if (allowKeys !== undefined && !allowKeys.has(key)) continue;
      Object.defineProperty(output, key, {
        value: snapshotCard(item.value, `${label}.${key}`, ancestors),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return output;
  } finally {
    ancestors.delete(raw);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Duel optional play cost: ${label} must be a non-empty string.`);
  }
}

function assertNullableSafeInteger(value: unknown, label: string): asserts value is number | null {
  if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError(`Duel optional play cost: ${label} must be a nonnegative integer or null.`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`Duel optional play cost: ${label} must be an ordinary array.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string" ||
      (key !== "length" && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))) {
    throw new TypeError(`Duel optional play cost: ${label} must have exactly its dense indices and length.`);
  }
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      throw new TypeError(`Duel optional play cost: ${label} must contain non-empty strings.`);
    }
  }
}

function assertCardSnapshot(value: unknown, label: string): asserts value is Record<string, unknown> {
  assertObject(value, label);
  // Reject symbol keys, accessors and non-enumerable fields, but tolerate extra
  // enumerable DATA fields exactly as the upstream verified catalog does (e.g.
  // `imageUrl`); only the required printing tuple below is read as semantics.
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    const item = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !item || !("value" in item) || !item.enumerable) {
      throw new TypeError(`Duel optional play cost: ${label} requires enumerable own data fields.`);
    }
  }
  for (const key of CARD_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`Duel optional play cost: ${label}.${key} is required.`);
    }
  }
  assertNonEmptyString(value.id, `${label}.id`);
  assertNonEmptyString(value.cardType, `${label}.cardType`);
  if (value.ability !== null && value.ability !== undefined && typeof value.ability !== "string") {
    throw new TypeError(`Duel optional play cost: ${label}.ability must be a string, null or undefined.`);
  }
  assertNullableSafeInteger(value.energy, `${label}.energy`);
  assertNullableSafeInteger(value.power, `${label}.power`);
  assertNullableSafeInteger(value.might, `${label}.might`);
  assertStringArray(value.domains, `${label}.domains`);
  assertStringArray(value.tags, `${label}.tags`);
  for (const key of [
    "canonicalCardId",
    "name",
    "fullName",
    "localizedName",
    "setCode",
    "cardNumber",
    "variant",
  ] as const) {
    assertNonEmptyString(value[key], `${label}.${key}`);
  }
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

// --- Recognition --------------------------------------------------------------

const RUNE_DOMAIN_SET: ReadonlySet<string> = new Set(DUEL_OPTIONAL_PLAY_COST_RUNE_DOMAINS);

/**
 * The unit's actual Rune domains, in card order. Unknown tokens, including the
 * catalog's unresolved Colorless convention, stay unknown rather than being
 * converted to a domainless rule. Only an explicit empty domain list is
 * domainless for this descriptor.
 */
function runeDomainsOf(domains: readonly string[]): DuelOptionalPlayCostRuneDomain[] | null {
  const seen = new Set<string>();
  const result: DuelOptionalPlayCostRuneDomain[] = [];
  for (const domain of domains) {
    if (domain === "Colorless") return null;
    if (!RUNE_DOMAIN_SET.has(domain)) return null;
    if (seen.has(domain)) continue;
    seen.add(domain);
    result.push(domain as DuelOptionalPlayCostRuneDomain);
  }
  return result;
}

function makeUnknown(
  cardId: string,
  canonicalCardId: string,
  normalizedAbilityText: string,
  reason: DuelOptionalPlayCostV1UnknownReason,
): DuelOptionalPlayCostV1Unknown {
  return freezeDeep({
    status: "unknown",
    kind: DUEL_OPTIONAL_PLAY_COST_V1_KIND,
    cardId,
    canonicalCardId,
    normalizedAbilityText,
    reason,
  });
}

/**
 * Describe one printing's whole-ability Unit Accelerate cost, or report `unknown`.
 *
 * The input is snapshotted through own data descriptors (no getter is invoked)
 * and must be an exact `DuelSourcePrintingCard` tuple. A recognised description
 * binds the printing's `id` / `canonicalCardId` / normalized ability text and the
 * whole printed tuple (`energy` / `power` / `might` / `domains` / `tags`).
 */
export function describeDuelOptionalPlayCostV1(card: DuelSourcePrintingCard): DuelOptionalPlayCostV1Description {
  const snapshot = snapshotCard(card, "card", new Set<object>(), CARD_FIELD_SET);
  assertCardSnapshot(snapshot, "card");
  const cardId = snapshot.id as string;
  const canonicalCardId = snapshot.canonicalCardId as string;
  const normalized = normalizeAbilityText(snapshot.ability as string | null | undefined);

  if (snapshot.cardType !== "Unit") {
    return makeUnknown(cardId, canonicalCardId, normalized, "not-unit");
  }

  const printedDomain = ACCELERATE_WHOLE_TEXT_TO_DOMAIN.get(normalized);
  if (printedDomain === undefined) {
    return makeUnknown(cardId, canonicalCardId, normalized, "ability-not-pure-accelerate");
  }

  const energy = snapshot.energy as number | null;
  const might = snapshot.might as number | null;
  if (energy === null || might === null) {
    return makeUnknown(cardId, canonicalCardId, normalized, "non-numeric-source-stat");
  }

  const runeDomains = runeDomainsOf(snapshot.domains as readonly string[]);
  if (runeDomains === null) {
    return makeUnknown(cardId, canonicalCardId, normalized, "unknown-runedomain-token");
  }
  if (runeDomains.length > 0 && !runeDomains.includes(printedDomain)) {
    return makeUnknown(cardId, canonicalCardId, normalized, "accelerate-rune-symbol-mismatch");
  }

  // Multi-domain: any one of the unit's domains pays the power portion (not all).
  // Domainless (an explicit empty domain list): any of the six domains
  // may pay it (CR 805.1.a.2).
  const allowedDomains: readonly DuelOptionalPlayCostRuneDomain[] =
    runeDomains.length > 0 ? [...runeDomains] : [...DUEL_OPTIONAL_PLAY_COST_RUNE_DOMAINS];

  return freezeDeep({
    status: "known",
    kind: DUEL_OPTIONAL_PLAY_COST_V1_KIND,
    cardId,
    canonicalCardId,
    source: {
      normalizedAbilityText: normalized,
      energy,
      power: snapshot.power as number | null,
      might,
      domains: [...(snapshot.domains as readonly string[])],
      tags: [...(snapshot.tags as readonly string[])],
    },
    printedBaseCost: {
      energy,
      power: snapshot.power as number | null,
    },
    semantics: {
      kind: "accelerate",
      choiceTiming: "card-play-choices",
      optional: true,
      additionalCost: {
        energy: 1,
        power: [{ allowedDomains, amount: 1 }],
      },
      paidEffect: { kind: "enter-ready-replacement", timing: "unit-entry" },
    },
  });
}
