/**
 * Pure-DATA recogniser for the whole-ability Unit attack trigger
 * "When I attack, deal damage equal to my Might to an enemy unit here."
 * (schema `attack-might-damage-description-v1`).
 *
 * Boundary (read this first):
 *
 *   - This is a STRICT, TEXT-MATCHING DATA DESCRIPTOR. It recognises one whole
 *     ability shape and returns a frozen description of the printed instructions.
 *     It is NOT an authority, NOT a SourceProgramClosure, NOT an executable card
 *     program, and it is NOT registered in the official-program registry.
 *   - It never mints capabilities: the result carries no `privateUID`, no
 *     per-printing epoch, no mint receipt, no `sourceProof` flag, no policy
 *     grant and no encoded executable reference. The returned `known` status
 *     only means "this complete printed source description was matched literally".
 *     It is NOT a runtime authority, NOT a `sourceProgramComplete` proof and NOT
 *     a negative proof that the ability is unsupported elsewhere.
 *   - Only the COMPLETE whole ability is recognised. Any extra instruction
 *     (an additional sentence, a `[Shield]`/`[Hunt]` keyword, a cost line, a JP/EN
 *     split line, an unknown trailing sentence, a second trigger, …) makes the
 *     printing `unknown`. Prefix/substring containment of the sentence is never
 *     sufficient, and a known match is never truncated out of a longer composite.
 *   - `unknown` NEVER degrades to a blank program, a no-ability template or a
 *     fabricated fixed damage amount.
 *
 * The dynamic value is modelled ONLY as DATA, preserving the printed literals:
 *
 *   - The damage amount is `equal to my Might` exactly as printed. It is a
 *     DYNAMIC expression, not a fixed number, so no amount is invented here.
 *   - CR v1.4 359.3.f.2: information referenced from the source ("my Might",
 *     "here") is checked on EXECUTION of the instruction, not frozen when the
 *     trigger is created. The rules text explicitly uses this very card as the
 *     example (359.3.f.2 example: "deal damage equal to his current Might of 5")
 *     and 359.3.f.2.a: an illegal referent returns null and its instructions are
 *     ignored (the trigger "mistargets").
 *   - CR v1.4 359.3.f.4: "enemy" is referenced from the triggered ability
 *     itself and is likewise checked on execution; a source that changes
 *     controller does not retarget.
 *   - CR v1.4 383.4.e: an attack trigger fires when the Unit gains the Attacker
 *     designation for the first time during a combat (383.4.e.2.a: only once per
 *     combat).
 *
 * Consequently this descriptor records the evaluation-time semantics as a label
 * (`on-instruction-execution`) and never substitutes the printed Might for the
 * dynamic amount, and never re-checks a chosen target here. The Core executor is
 * NOT wired, and the current Core damage amount is a fixed literal, so this is a
 * source description only.
 *
 * Literal source text (the real catalog wording, single form, no reminder/symbol
 * variants in the 2026-10-12 official gallery):
 *   `When I attack, deal damage equal to my Might to an enemy unit here.`
 */

import { normalizeAbilityText } from "./ability-bindings.js";
import type { DuelSourcePrintingCard } from "./official-programs.js";

/** Fixed schema kind of a recognised attack-Might-damage description. */
export const DUEL_ATTACK_MIGHT_DAMAGE_DESCRIPTION_V1_KIND =
  "attack-might-damage-description-v1" as const;

/**
 * The frozen catalog baseline this descriptor's evidence is bound to. These are
 * module constants: the caller can never supply (and thereby authenticate) them,
 * and the recogniser never reads `dataVersion`/`sourceCatalogDigest` off the
 * printing tuple. Digest authenticity remains the upstream verified-catalog
 * layer's job.
 */
export const DUEL_ATTACK_MIGHT_DAMAGE_SOURCE_DATA_VERSION =
  "2026-10-12-official-gallery" as const;
export const DUEL_ATTACK_MIGHT_DAMAGE_SOURCE_CATALOG_DIGEST =
  "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10" as const;

/**
 * The single exact whole-ability literal for this family in the current baseline.
 * Kept as a set so future reminder/symbol variants can be added explicitly, but
 * only a full-string equality match is ever accepted.
 */
export const DUEL_ATTACK_MIGHT_DAMAGE_WHOLE_TEXTS: ReadonlySet<string> = new Set([
  "When I attack, deal damage equal to my Might to an enemy unit here.",
]);

/** Why a printing is not recognised as a known attack-Might-damage description. */
export type DuelAttackMightDamageV1UnknownReason =
  | "not-unit"
  | "ability-not-pure-attack-might-damage"
  | "non-numeric-source-stat";

/** The literal attack-trigger shape (CR v1.4 383.4.e). */
export interface DuelAttackMightDamageV1Trigger {
  readonly kind: "triggered-ability";
  readonly event: "attack";
  readonly subject: "source";
  readonly firesOncePerCombat: true;
}

/**
 * The damage amount, kept DYNAMIC and literal. `equal-to-source-might` is never
 * evaluated to a fixed number here; `on-instruction-execution` records the CR
 * v1.4 359.3.f.2 evaluation point.
 */
export interface DuelAttackMightDamageV1Amount {
  readonly kind: "equal-to-source-might";
  readonly dynamic: true;
  readonly evaluationTime: "on-instruction-execution";
}

/**
 * The target, kept literal. "enemy" is referenced from the triggered ability and
 * "here" from the source (CR v1.4 359.3.f.2 / 359.3.f.4), both checked on
 * execution; the descriptor never pre-selects or re-checks a target.
 */
export interface DuelAttackMightDamageV1Targets {
  readonly kind: "unit";
  readonly controller: "enemy";
  readonly location: "here";
  readonly minSelections: 1;
  readonly maxSelections: 1;
  readonly referentEvaluationTime: "on-instruction-execution";
}

export interface DuelAttackMightDamageV1Effect {
  readonly kind: "deal-damage";
  readonly amount: DuelAttackMightDamageV1Amount;
  readonly targets: DuelAttackMightDamageV1Targets;
}

export interface DuelAttackMightDamageV1Semantics {
  readonly kind: "attack-trigger-deal-damage";
  readonly trigger: DuelAttackMightDamageV1Trigger;
  readonly effect: DuelAttackMightDamageV1Effect;
}

/** Source-bound printing projection carried onto a known result. */
export interface DuelAttackMightDamageV1Source {
  readonly normalizedAbilityText: string;
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
}

/**
 * The exact fields a whole-source fingerprint is computed over. Every field of
 * the printing tuple that this descriptor reads is included so the fingerprint
 * binds the description to its complete source, not just the ability text.
 */
export interface DuelAttackMightDamageV1SourceFingerprintFields {
  readonly cardId: string;
  readonly cardType: string;
  readonly normalizedAbilityText: string;
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

export interface DuelAttackMightDamageV1Known {
  readonly status: "known";
  readonly kind: typeof DUEL_ATTACK_MIGHT_DAMAGE_DESCRIPTION_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly dataVersion: typeof DUEL_ATTACK_MIGHT_DAMAGE_SOURCE_DATA_VERSION;
  readonly catalogDigest: typeof DUEL_ATTACK_MIGHT_DAMAGE_SOURCE_CATALOG_DIGEST;
  readonly source: DuelAttackMightDamageV1Source;
  /**
   * `sha256:` fingerprint over the canonical whole-source tuple, recomputed by
   * the recogniser from its own snapshot. It binds the description to its exact
   * source. It is NOT a secret, an auth token or a proof of anything, and a
   * caller-supplied fingerprint is never trusted.
   */
  readonly sourceFingerprint: string;
  readonly printedMight: number;
  readonly semantics: DuelAttackMightDamageV1Semantics;
}

export interface DuelAttackMightDamageV1Unknown {
  readonly status: "unknown";
  readonly kind: typeof DUEL_ATTACK_MIGHT_DAMAGE_DESCRIPTION_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly dataVersion: typeof DUEL_ATTACK_MIGHT_DAMAGE_SOURCE_DATA_VERSION;
  readonly catalogDigest: typeof DUEL_ATTACK_MIGHT_DAMAGE_SOURCE_CATALOG_DIGEST;
  readonly normalizedAbilityText: string;
  readonly reason: DuelAttackMightDamageV1UnknownReason;
}

export type DuelAttackMightDamageV1Description =
  | DuelAttackMightDamageV1Known
  | DuelAttackMightDamageV1Unknown;

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
    throw new TypeError(`Duel attack might damage: ${label} must be an object.`);
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
    throw new TypeError(`Duel attack might damage: ${label} must be acyclic data.`);
  }
  const array = Array.isArray(raw);
  const prototype = Object.getPrototypeOf(raw);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Duel attack might damage: ${label} must be ordinary data.`);
  }
  ancestors.add(raw);
  try {
    const keys = Reflect.ownKeys(raw);
    if (array) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(raw, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor) ||
          !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
          keys.length !== lengthDescriptor.value + 1 || !keys.includes("length")) {
        throw new TypeError(`Duel attack might damage: ${label} must be a dense array.`);
      }
      const output: unknown[] = [];
      for (let index = 0; index < lengthDescriptor.value; index++) {
        const item = Object.getOwnPropertyDescriptor(raw, String(index));
        if (!item || !("value" in item) || !item.enumerable) {
          throw new TypeError(`Duel attack might damage: ${label}[${index}] must be an own data property.`);
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
        throw new TypeError(`Duel attack might damage: ${label} requires enumerable own data fields.`);
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
    throw new TypeError(`Duel attack might damage: ${label} must be a non-empty string.`);
  }
}

function assertNullableSafeInteger(value: unknown, label: string): asserts value is number | null {
  if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError(`Duel attack might damage: ${label} must be a nonnegative integer or null.`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`Duel attack might damage: ${label} must be an ordinary array.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string" ||
      (key !== "length" && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))) {
    throw new TypeError(`Duel attack might damage: ${label} must have exactly its dense indices and length.`);
  }
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      throw new TypeError(`Duel attack might damage: ${label} must contain non-empty strings.`);
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
      throw new TypeError(`Duel attack might damage: ${label} requires enumerable own data fields.`);
    }
  }
  for (const key of CARD_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`Duel attack might damage: ${label}.${key} is required.`);
    }
  }
  assertNonEmptyString(value.id, `${label}.id`);
  assertNonEmptyString(value.cardType, `${label}.cardType`);
  if (value.ability !== null && value.ability !== undefined && typeof value.ability !== "string") {
    throw new TypeError(`Duel attack might damage: ${label}.ability must be a string, null or undefined.`);
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

/** Canonical, key-sorted serialization used only as SHA-256 input. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/**
 * Minimal, dependency-free SHA-256 (FIPS 180-4) so this browser-targeted module
 * can emit the repo's standard `sha256:` fingerprint without importing
 * `node:crypto`. The output is verified against `node:crypto` in the tests.
 */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const length = bytes.length;
  const bitLength = length * 8;
  // Padded length: message + 0x80 + zeros so that (total % 64) === 56, + 8-byte length.
  const withPadding = ((length + 8) >> 6 << 6) + 64;
  const buffer = new Uint8Array(withPadding);
  buffer.set(bytes);
  buffer[length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(withPadding - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(withPadding - 4, bitLength >>> 0);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let offset = 0; offset < withPadding; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotateRight(w[i - 15]!, 7) ^ rotateRight(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotateRight(w[i - 2]!, 17) ^ rotateRight(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const S0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, "0")).join("");
}

// --- Recognition --------------------------------------------------------------

function makeUnknown(
  cardId: string,
  canonicalCardId: string,
  normalizedAbilityText: string,
  reason: DuelAttackMightDamageV1UnknownReason,
): DuelAttackMightDamageV1Unknown {
  return freezeDeep({
    status: "unknown",
    kind: DUEL_ATTACK_MIGHT_DAMAGE_DESCRIPTION_V1_KIND,
    cardId,
    canonicalCardId,
    dataVersion: DUEL_ATTACK_MIGHT_DAMAGE_SOURCE_DATA_VERSION,
    catalogDigest: DUEL_ATTACK_MIGHT_DAMAGE_SOURCE_CATALOG_DIGEST,
    normalizedAbilityText,
    reason,
  });
}

/**
 * Describe one printing's whole-ability attack-Might-damage trigger, or report
 * `unknown`.
 *
 * The input is snapshotted through own data descriptors (no getter is invoked)
 * and must be an exact `DuelSourcePrintingCard` tuple. A recognised description
 * binds the printing's `id` / `canonicalCardId` / normalized ability text, the
 * whole printed tuple (`energy` / `power` / `might` / `domains` / `tags`), the
 * fixed baseline `dataVersion` / `catalogDigest` and a recomputed whole-source
 * fingerprint, and returns data-only semantics.
 */
export function describeDuelAttackMightDamageV1(
  card: DuelSourcePrintingCard,
): DuelAttackMightDamageV1Description {
  const snapshot = snapshotCard(card, "card", new Set<object>(), CARD_FIELD_SET);
  assertCardSnapshot(snapshot, "card");
  const cardId = snapshot.id as string;
  const canonicalCardId = snapshot.canonicalCardId as string;
  const normalized = normalizeAbilityText(snapshot.ability as string | null | undefined);

  if (snapshot.cardType !== "Unit") {
    return makeUnknown(cardId, canonicalCardId, normalized, "not-unit");
  }

  // Whole-ability equality only: a substring or a truncated prefix is never
  // sufficient, and an extra sentence can never be absorbed into a known match.
  if (!DUEL_ATTACK_MIGHT_DAMAGE_WHOLE_TEXTS.has(normalized)) {
    return makeUnknown(cardId, canonicalCardId, normalized, "ability-not-pure-attack-might-damage");
  }

  const might = snapshot.might as number | null;
  // The printed Might is DATA evidence (the dynamic amount is read at resolution,
  // CR 359.3.f.2); a Unit with no defined Might cannot be a Might-reading source.
  if (might === null) {
    return makeUnknown(cardId, canonicalCardId, normalized, "non-numeric-source-stat");
  }

  const fingerprintFields: DuelAttackMightDamageV1SourceFingerprintFields = {
    cardId,
    cardType: snapshot.cardType as string,
    normalizedAbilityText: normalized,
    energy: snapshot.energy as number | null,
    power: snapshot.power as number | null,
    might,
    domains: [...(snapshot.domains as readonly string[])],
    tags: [...(snapshot.tags as readonly string[])],
    canonicalCardId,
    name: snapshot.name as string,
    fullName: snapshot.fullName as string,
    localizedName: snapshot.localizedName as string,
    setCode: snapshot.setCode as string,
    cardNumber: snapshot.cardNumber as string,
    variant: snapshot.variant as string,
  };
  // The fingerprint is recomputed from the snapshot over the whole source tuple;
  // a caller-claimed fingerprint is never read. It binds the description to its
  // exact source and is a deterministic content binding, not an auth token.
  const sourceFingerprint = `sha256:${sha256Hex(canonicalJson(fingerprintFields))}`;

  return freezeDeep({
    status: "known",
    kind: DUEL_ATTACK_MIGHT_DAMAGE_DESCRIPTION_V1_KIND,
    cardId,
    canonicalCardId,
    dataVersion: DUEL_ATTACK_MIGHT_DAMAGE_SOURCE_DATA_VERSION,
    catalogDigest: DUEL_ATTACK_MIGHT_DAMAGE_SOURCE_CATALOG_DIGEST,
    source: {
      normalizedAbilityText: normalized,
      energy: snapshot.energy as number | null,
      power: snapshot.power as number | null,
      might,
      domains: [...(snapshot.domains as readonly string[])],
      tags: [...(snapshot.tags as readonly string[])],
    },
    sourceFingerprint,
    printedMight: might,
    semantics: {
      kind: "attack-trigger-deal-damage",
      trigger: {
        kind: "triggered-ability",
        event: "attack",
        subject: "source",
        firesOncePerCombat: true,
      },
      effect: {
        kind: "deal-damage",
        amount: {
          kind: "equal-to-source-might",
          dynamic: true,
          evaluationTime: "on-instruction-execution",
        },
        targets: {
          kind: "unit",
          controller: "enemy",
          location: "here",
          minSelections: 1,
          maxSelections: 1,
          referentEvaluationTime: "on-instruction-execution",
        },
      },
    },
  });
}
