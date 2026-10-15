/**
 * Pure-DATA recogniser for the whole-ability Gear **[Equip]** keyword
 * (schema `equip-description-v1`; CR v1.4 rule 818).
 *
 * Boundary (read this first):
 *
 *   - This is a STRICT, TEXT-MATCHING DATA DESCRIPTOR. It recognises one whole
 *     ability shape — a Gear whose *entire* ability is a single `[Equip]` line —
 *     and returns a frozen description of the printed Equip cost. It is NOT an
 *     authority, NOT a SourceProgramClosure, NOT an executable card program, and
 *     it is NOT registered in the official-program registry.
 *   - It never mints capabilities: the result carries no `privateUID`, no
 *     per-printing epoch, no mint receipt, no `sourceProof` flag and no encoded
 *     executable reference. It never grants a right to pay a cost, never attaches
 *     anything and never chooses a target. A trusted catalog layer plus the Core
 *     executor own payment, attachment, choice receipts and timing.
 *   - Only the COMPLETE whole ability is recognised. Any extra instruction (a
 *     card-play reminder such as `[Quick-Draw]`/`[Unique]`, a `Weaponmaster`
 *     grant, a second ability line, a copy/XP clause, an unknown trailing
 *     sentence, …) makes the printing `unknown`. Containment of the `[Equip]`
 *     token is never sufficient, and a longer sentence is never truncated to a
 *     known prefix.
 *   - `unknown` NEVER degrades to a blank program, a no-ability template or a
 *     default Equip cost.
 *
 * Source descriptor is DATA, not proof: `dataVersion` / `catalogDigest` are
 * carried transport metadata (not cryptographically re-verified here), and the
 * `sourceFingerprint` is a content-addressed identity of the whole printed
 * source tuple — NOT runtime authority, NOT `sourceProgramComplete`, NOT a
 * negative proof.
 *
 * CR v1.4 evidence (all rule facts; nothing from a post-2026-10-16 ruleset):
 *
 *   - 818.1 / 818.1.a: Equip is an Activated Ability keyword, present on Gear
 *     with the tag Equipment.
 *   - 818.1.b: Equip has an activation cost and Attaches the card to a chosen
 *     Unit when the cost is paid; 818.1.b.1 that choice is a Target; 818.1.b.2
 *     the chosen Unit becomes the Top-Most Card.
 *   - 818.1.c: formatted "Equip [Cost]"; 818.1.c.2 functionally short for
 *     "[Cost]: Attach this gear to a unit you control."; 818.1.c.3 the cost may
 *     include resource and non-resource costs; 818.1.c.4 Equip text may ALTER the
 *     cost (taken into account when paying); 818.1.c.5 may alter timing/targeting.
 *   - 818.4: multiple instances of Equip are separate Activated Abilities.
 *   - 818.5 / 818.5.a: "has Equip" is a Gear characteristic, checkable even when
 *     the Rules Text is Inactive.
 *   - 151 / 151.1 + 376 / 377.1: Gear Activated Abilities are written as a cost,
 *     a ":", then the effect; 377 identifies the ":" shape.
 *   - 135.2.d.1-.d.3: reminder text is italic parenthesis that has NO effect on
 *     game function — so the parenthesised wording is descriptive, not a grant.
 *   - 135.2.e.5 / 135.2.e.5.a: Power of any Domain is the rainbow symbol `[A]`;
 *     when required as a cost it can be paid by Power of any Domain.
 *   - 149.1-.2 / 150.1-.4: Gear/Equipment intrinsic properties.
 *
 * Because CR 135.2.d.3 makes reminder wording non-functional and CR 818.1.c.4/c.5
 * allow cost/timing/targeting alterations, the descriptor records the printed
 * cost and reminder wording LITERALLY but marks the exact attach target, owner and
 * activation timing as `unknown`; it never infers permissions from keywords.
 */

import { normalizeAbilityText } from "./ability-bindings.js";
import type { DuelSourcePrintingCard } from "./official-programs.js";

/** Fixed schema kind of a recognised Equip description. */
export const DUEL_EQUIP_DESCRIPTION_V1_KIND = "equip-description-v1" as const;

/**
 * The six Rune domains of the current baseline. `Colorless` is deliberately NOT
 * a Rune domain and is never accepted as one.
 */
export const DUEL_EQUIP_RUNE_DOMAINS = Object.freeze([
  "Fury",
  "Calm",
  "Mind",
  "Body",
  "Chaos",
  "Order",
] as const);

export type DuelEquipRuneDomain = (typeof DUEL_EQUIP_RUNE_DOMAINS)[number];

/** CR 135.2.e.4: a specific Domain prints as its rune symbol. */
const RUNE_SYMBOL_BY_DOMAIN: Readonly<Record<DuelEquipRuneDomain, string>> = Object.freeze({
  Fury: ":rb_rune_fury:",
  Calm: ":rb_rune_calm:",
  Mind: ":rb_rune_mind:",
  Body: ":rb_rune_body:",
  Chaos: ":rb_rune_chaos:",
  Order: ":rb_rune_order:",
});

/** CR 135.2.e.5: Power of any Domain prints as the rainbow symbol `[A]`. */
const RAINBOW_RUNE_SYMBOL = ":rb_rune_rainbow:";

/** Why a printing is not recognised as a known Equip description. */
export type DuelEquipV1UnknownReason =
  | "not-gear"
  | "not-equipment-tag"
  | "ability-not-pure-equip"
  | "non-numeric-source-stat"
  | "equip-rune-symbol-domain-mismatch";

/** The Power portion of a printed Equip cost, exactly as printed. */
export type DuelEquipV1PowerCost =
  | { readonly kind: "specific-domain"; readonly domain: DuelEquipRuneDomain }
  | { readonly kind: "any-domain" };

/**
 * The printed Equip cost. `energy` is the number of printed energy symbols (0
 * when none appears); `power` is the printed Power portion or `null` when the
 * cost prints power only / non-resource text only. `nonResourceLiteral` is the
 * verbatim non-resource cost text (e.g. "exhaust a friendly unit") and is
 * deliberately UNMODELED: it is recorded as DATA and never executed.
 */
export interface DuelEquipV1Cost {
  readonly literal: string;
  readonly energy: number;
  readonly power: DuelEquipV1PowerCost | null;
  readonly nonResourceLiteral: string | null;
}

/** Where the printed cost/reminder wording came from (literal form). */
export type DuelEquipV1ReminderForm = "cost-colon" | "pay-the-cost-colon";

export interface DuelEquipV1Semantics {
  readonly kind: "equip";
  /** CR 818.1 / 376: Equip is an Activated Ability. */
  readonly abilityClass: "activated-ability";
  readonly cost: DuelEquipV1Cost;
  /** CR 818.1.c.4: verbatim cost-alteration sentences; recorded, never applied. */
  readonly costAlterations: readonly string[];
  readonly reminderForm: DuelEquipV1ReminderForm;
  /**
   * The exact attach target/owner is NOT modelled: CR 135.2.d.3 gives the
   * reminder wording no game function and CR 818.1.c.5 allows targeting
   * alterations, so this stays `unknown` rather than a permission.
   */
  readonly attachTarget: "unknown";
  /** CR 151.1 / 376: the activated timing window is NOT modelled here. */
  readonly timing: "unknown";
}

/** Source-bound printing projection carried onto a known result. */
export interface DuelEquipV1Source {
  readonly normalizedAbilityText: string;
  readonly cardType: string;
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
}

/** Optional source envelope; carried verbatim as DATA, never used to authenticate. */
export interface DuelEquipV1SourceEnvelope {
  readonly dataVersion: string;
  readonly catalogDigest: string;
}

export interface DuelEquipV1Known {
  readonly status: "known";
  readonly kind: typeof DUEL_EQUIP_DESCRIPTION_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly dataVersion: string | null;
  readonly catalogDigest: string | null;
  readonly sourceFingerprint: string;
  readonly source: DuelEquipV1Source;
  readonly semantics: DuelEquipV1Semantics;
}

export interface DuelEquipV1Unknown {
  readonly status: "unknown";
  readonly kind: typeof DUEL_EQUIP_DESCRIPTION_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly normalizedAbilityText: string;
  readonly reason: DuelEquipV1UnknownReason;
}

export type DuelEquipV1Description = DuelEquipV1Known | DuelEquipV1Unknown;

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
    throw new TypeError(`Duel equip: ${label} must be an object.`);
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
    throw new TypeError(`Duel equip: ${label} must be acyclic data.`);
  }
  const array = Array.isArray(raw);
  const prototype = Object.getPrototypeOf(raw);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Duel equip: ${label} must be ordinary data.`);
  }
  ancestors.add(raw);
  try {
    const keys = Reflect.ownKeys(raw);
    if (array) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(raw, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor) ||
          !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
          keys.length !== lengthDescriptor.value + 1 || !keys.includes("length")) {
        throw new TypeError(`Duel equip: ${label} must be a dense array.`);
      }
      const output: unknown[] = [];
      for (let index = 0; index < lengthDescriptor.value; index++) {
        const item = Object.getOwnPropertyDescriptor(raw, String(index));
        if (!item || !("value" in item) || !item.enumerable) {
          throw new TypeError(`Duel equip: ${label}[${index}] must be an own data property.`);
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
        throw new TypeError(`Duel equip: ${label} requires enumerable own data fields.`);
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
    throw new TypeError(`Duel equip: ${label} must be a non-empty string.`);
  }
}

function assertNullableSafeInteger(value: unknown, label: string): asserts value is number | null {
  if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError(`Duel equip: ${label} must be a nonnegative integer or null.`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`Duel equip: ${label} must be an ordinary array.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string" ||
      (key !== "length" && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))) {
    throw new TypeError(`Duel equip: ${label} must have exactly its dense indices and length.`);
  }
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      throw new TypeError(`Duel equip: ${label} must contain non-empty strings.`);
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
      throw new TypeError(`Duel equip: ${label} requires enumerable own data fields.`);
    }
  }
  for (const key of CARD_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`Duel equip: ${label}.${key} is required.`);
    }
  }
  assertNonEmptyString(value.id, `${label}.id`);
  assertNonEmptyString(value.cardType, `${label}.cardType`);
  if (value.ability !== null && value.ability !== undefined && typeof value.ability !== "string") {
    throw new TypeError(`Duel equip: ${label}.ability must be a string, null or undefined.`);
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

// --- Self-contained fingerprint (content-addressed identity only) -------------

/*
 * A minimal, dependency-free SHA-256 so the descriptor can bind a stable
 * `sourceFingerprint` without a Node-only import. This is an identity/audit
 * helper, NOT authentication: it cannot re-verify the upstream catalog digest
 * and must not be treated as a capability or a source proof.
 */
const SHA256_K = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = BigInt(bytes.length) * 8n;
  view.setUint32(padded.length - 8, Number((bitLength >> 32n) & 0xffffffffn));
  view.setUint32(padded.length - 4, Number(bitLength & 0xffffffffn));
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  for (let offset = 0; offset < padded.length; offset += 64) {
    const schedule = new Array<number>(64);
    for (let index = 0; index < 16; index++) schedule[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index++) {
      const x = schedule[index - 15]!;
      const y = schedule[index - 2]!;
      schedule[index] = (schedule[index - 16]! + (rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3)) +
        schedule[index - 7]! + (rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state as [number, number, number, number, number, number, number, number];
    for (let index = 0; index < 64; index++) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const temp1 = (h + sigma1 + ((e & f) ^ (~e & g)) + SHA256_K[index]! + schedule[index]!) >>> 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const temp2 = (sigma0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    const merged = [a, b, c, d, e, f, g, h];
    for (let index = 0; index < 8; index++) state[index] = (state[index]! + merged[index]!) >>> 0;
  }
  return state.map((word) => word.toString(16).padStart(8, "0")).join("");
}

/**
 * The exact canonical JSON string fingerprinted for a whole source tuple. It is
 * exported so a reviewer can re-derive the fingerprint independently. It carries
 * the printed source (identity + ability + stats + the optional envelope
 * metadata), and never a caller-supplied fingerprint.
 */
export function duelEquipSourceFingerprintMaterial(
  card: DuelSourcePrintingCard,
  envelope?: DuelEquipV1SourceEnvelope,
): string {
  const snapshot = snapshotCard(card, "card", new Set<object>(), CARD_FIELD_SET);
  assertCardSnapshot(snapshot, "card");
  return duelEquipSourceFingerprintMaterialFromSnapshot(snapshot, readEnvelope(envelope));
}

/**
 * Fingerprint material derived from an ALREADY-snapshotted, already-validated
 * printing tuple plus an optional envelope. Kept internal so the describe path
 * never re-reads the caller's object after its single snapshot.
 */
function duelEquipSourceFingerprintMaterialFromSnapshot(
  snapshot: Record<string, unknown>,
  meta: DuelEquipV1SourceEnvelope | undefined,
): string {
  return JSON.stringify({
    id: snapshot.id,
    cardType: snapshot.cardType,
    normalizedAbilityText: normalizeAbilityText(snapshot.ability as string | null | undefined),
    energy: snapshot.energy,
    power: snapshot.power,
    might: snapshot.might,
    domains: [...(snapshot.domains as readonly string[])],
    tags: [...(snapshot.tags as readonly string[])],
    canonicalCardId: snapshot.canonicalCardId,
    name: snapshot.name,
    fullName: snapshot.fullName,
    localizedName: snapshot.localizedName,
    setCode: snapshot.setCode,
    cardNumber: snapshot.cardNumber,
    variant: snapshot.variant,
    dataVersion: meta?.dataVersion ?? null,
    catalogDigest: meta?.catalogDigest ?? null,
  });
}

function readEnvelope(envelope: DuelEquipV1SourceEnvelope | undefined): DuelEquipV1SourceEnvelope | undefined {
  if (envelope === undefined) return undefined;
  const snapshot = snapshotCard(envelope, "envelope", new Set<object>());
  assertObject(snapshot, "envelope");
  assertNonEmptyString(snapshot.dataVersion, "envelope.dataVersion");
  assertNonEmptyString(snapshot.catalogDigest, "envelope.catalogDigest");
  return {
    dataVersion: snapshot.dataVersion,
    catalogDigest: snapshot.catalogDigest,
  };
}

// --- Recognition --------------------------------------------------------------

interface EquipCostLiteral {
  readonly literal: string;
  readonly energy: number;
  readonly power: DuelEquipV1PowerCost | null;
  readonly nonResourceLiteral: string | null;
  readonly costAlterations: readonly string[];
  readonly reminderForm: DuelEquipV1ReminderForm;
}

/**
 * Every recognised whole-ability text, keyed by its complete verbatim literal.
 * Whole-string equality is the ONLY acceptance rule: there is no prefix match and
 * no trailing sentence is ever swallowed. The three em-dash variants and the
 * cost-altered Hextech Gauntlets line are kept as DATA only (their non-resource
 * cost and alteration are never executed).
 */
function buildEquipTable(): ReadonlyMap<string, EquipCostLiteral> {
  const rows: EquipCostLiteral[] = [];
  const runeReminder = (domain: DuelEquipRuneDomain): string =>
    `[Equip] ${RUNE_SYMBOL_BY_DOMAIN[domain]} (${RUNE_SYMBOL_BY_DOMAIN[domain]}: Attach this to a unit you control.)`;
  const energyRuneReminder = (energy: number, domain: DuelEquipRuneDomain): string =>
    `[Equip] :rb_energy_${energy}:${RUNE_SYMBOL_BY_DOMAIN[domain]} (:rb_energy_${energy}:${RUNE_SYMBOL_BY_DOMAIN[domain]}: Attach this to a unit you control.)`;

  for (const domain of DUEL_EQUIP_RUNE_DOMAINS) {
    rows.push({
      literal: `[Equip] ${RUNE_SYMBOL_BY_DOMAIN[domain]} (${RUNE_SYMBOL_BY_DOMAIN[domain]}: Attach this to a unit you control.)`,
      energy: 0,
      power: { kind: "specific-domain", domain },
      nonResourceLiteral: null,
      costAlterations: [],
      reminderForm: "cost-colon",
    });
  }
  rows.push({
    literal: energyRuneReminder(1, "Fury"),
    energy: 1,
    power: { kind: "specific-domain", domain: "Fury" },
    nonResourceLiteral: null,
    costAlterations: [],
    reminderForm: "cost-colon",
  });
  rows.push({
    literal: energyRuneReminder(1, "Body"),
    energy: 1,
    power: { kind: "specific-domain", domain: "Body" },
    nonResourceLiteral: null,
    costAlterations: [],
    reminderForm: "cost-colon",
  });
  rows.push({
    literal: `[Equip] — ${RAINBOW_RUNE_SYMBOL} or exhaust a friendly unit. (Pay the cost: Attach this to a unit you control.)`,
    energy: 0,
    power: { kind: "any-domain" },
    nonResourceLiteral: "exhaust a friendly unit",
    costAlterations: [],
    reminderForm: "pay-the-cost-colon",
  });
  rows.push({
    literal: `[Equip] — ${RUNE_SYMBOL_BY_DOMAIN.Chaos}, Recycle 2 cards from your trash (Pay the cost: Attach this to a unit you control.)`,
    energy: 0,
    power: { kind: "specific-domain", domain: "Chaos" },
    nonResourceLiteral: "Recycle 2 cards from your trash",
    costAlterations: [],
    reminderForm: "pay-the-cost-colon",
  });
  rows.push({
    literal: `[Equip] — ${RUNE_SYMBOL_BY_DOMAIN.Order}, Kill a friendly unit (Pay the cost: Attach this to a unit you control.)`,
    energy: 0,
    power: { kind: "specific-domain", domain: "Order" },
    nonResourceLiteral: "Kill a friendly unit",
    costAlterations: [],
    reminderForm: "pay-the-cost-colon",
  });
  rows.push({
    literal: `[Equip] :rb_energy_3:${RAINBOW_RUNE_SYMBOL}. This ability's Energy cost is reduced by the Might of the unit you choose. (Pay the cost: Attach this to a unit you control.)`,
    energy: 3,
    power: { kind: "any-domain" },
    nonResourceLiteral: null,
    costAlterations: ["This ability's Energy cost is reduced by the Might of the unit you choose."],
    reminderForm: "pay-the-cost-colon",
  });

  const table = new Map<string, EquipCostLiteral>();
  for (const row of rows) table.set(row.literal, row);
  return table;
}

const EQUIP_TABLE: ReadonlyMap<string, EquipCostLiteral> = buildEquipTable();

const RUNE_DOMAIN_SET: ReadonlySet<string> = new Set(DUEL_EQUIP_RUNE_DOMAINS);

/** The unit's actual Rune domains, in card order, or `null` on an unknown token. */
function runeDomainsOf(domains: readonly string[]): DuelEquipRuneDomain[] | null {
  const seen = new Set<string>();
  const result: DuelEquipRuneDomain[] = [];
  for (const domain of domains) {
    if (domain === "Colorless") return null;
    if (!RUNE_DOMAIN_SET.has(domain)) return null;
    if (seen.has(domain)) continue;
    seen.add(domain);
    result.push(domain as DuelEquipRuneDomain);
  }
  return result;
}

function makeUnknown(
  cardId: string,
  canonicalCardId: string,
  normalizedAbilityText: string,
  reason: DuelEquipV1UnknownReason,
): DuelEquipV1Unknown {
  return freezeDeep({
    status: "unknown",
    kind: DUEL_EQUIP_DESCRIPTION_V1_KIND,
    cardId,
    canonicalCardId,
    normalizedAbilityText,
    reason,
  });
}

/**
 * Describe one printing's whole-ability Gear Equip cost, or report `unknown`.
 *
 * The input is snapshotted through own data descriptors (no getter is invoked)
 * and must be an exact `DuelSourcePrintingCard` tuple. A recognised description
 * binds the printing's `id` / `canonicalCardId`, the whole printed tuple, an
 * optional source envelope carried verbatim, and a `sourceFingerprint` computed
 * from the whole source — never accepted from the caller.
 */
export function describeDuelEquipV1(
  card: DuelSourcePrintingCard,
  envelope?: DuelEquipV1SourceEnvelope,
): DuelEquipV1Description {
  const snapshot = snapshotCard(card, "card", new Set<object>(), CARD_FIELD_SET);
  assertCardSnapshot(snapshot, "card");
  const meta = readEnvelope(envelope);
  const cardId = snapshot.id as string;
  const canonicalCardId = snapshot.canonicalCardId as string;
  const normalized = normalizeAbilityText(snapshot.ability as string | null | undefined);

  // CR 818.1.a: Equip is present on Gear with the tag Equipment.
  if (snapshot.cardType !== "Gear") {
    return makeUnknown(cardId, canonicalCardId, normalized, "not-gear");
  }
  const tags = snapshot.tags as readonly string[];
  if (!tags.includes("Equipment")) {
    return makeUnknown(cardId, canonicalCardId, normalized, "not-equipment-tag");
  }

  const row = EQUIP_TABLE.get(normalized);
  if (row === undefined) {
    return makeUnknown(cardId, canonicalCardId, normalized, "ability-not-pure-equip");
  }

  const energy = snapshot.energy as number | null;
  const might = snapshot.might as number | null;
  if (energy === null || might === null) {
    return makeUnknown(cardId, canonicalCardId, normalized, "non-numeric-source-stat");
  }

  const runeDomains = runeDomainsOf(snapshot.domains as readonly string[]);
  if (runeDomains === null) {
    return makeUnknown(cardId, canonicalCardId, normalized, "equip-rune-symbol-domain-mismatch");
  }
  if (row.power !== null && row.power.kind === "specific-domain" && runeDomains.length > 0 &&
      !runeDomains.includes(row.power.domain)) {
    return makeUnknown(cardId, canonicalCardId, normalized, "equip-rune-symbol-domain-mismatch");
  }

  const fingerprintMaterial = duelEquipSourceFingerprintMaterialFromSnapshot(snapshot, meta);

  return freezeDeep({
    status: "known" as const,
    kind: DUEL_EQUIP_DESCRIPTION_V1_KIND,
    cardId,
    canonicalCardId,
    dataVersion: meta?.dataVersion ?? null,
    catalogDigest: meta?.catalogDigest ?? null,
    sourceFingerprint: `sha256:${sha256Hex(fingerprintMaterial)}`,
    source: {
      normalizedAbilityText: normalized,
      cardType: snapshot.cardType as string,
      energy,
      power: snapshot.power as number | null,
      might,
      domains: [...(snapshot.domains as readonly string[])],
      tags: [...tags],
    },
    semantics: {
      kind: "equip",
      abilityClass: "activated-ability",
      cost: {
        literal: row.literal,
        energy: row.energy,
        power: row.power,
        nonResourceLiteral: row.nonResourceLiteral,
      },
      costAlterations: [...row.costAlterations],
      reminderForm: row.reminderForm,
      attachTarget: "unknown",
      timing: "unknown",
    },
  });
}
