/**
 * Pure-DATA recogniser for the whole-ability Unit **Hold→score** trigger
 * (schema `hold-score-description-v1`).
 *
 * Boundary (read this first):
 *
 *   - This is a STRICT, TEXT-MATCHING DATA DESCRIPTOR. It recognises ONE whole
 *     ability shape and returns a frozen description of the printed trigger. It
 *     is NOT an authority, NOT a SourceProgramClosure, NOT an executable card
 *     program, and it is NOT registered in the official-program registry.
 *   - It never mints capabilities: the result carries no `privateUID`, no
 *     per-printing epoch, no mint receipt, no `sourceProof` flag, no
 *     `runtimeAuthority`, no `sourceProgramComplete` and no encoded executable
 *     reference. A caller must not treat the returned object as a licence to
 *     score, to grant points or to resolve the trigger.
 *   - Only the COMPLETE whole ability is recognised. Any extra instruction (a
 *     keyword such as `[Shield]`/`[Ganking]`, a second trigger, a condition, a
 *     grant, an aura, a different score amount, an unknown trailing sentence,
 *     …) makes the printing `unknown`. Containment of `hold` or of
 *     `score 1 point` is never sufficient, and the text is never prefix-matched
 *     or truncated into a known shape.
 *   - `unknown` NEVER degrades to a blank program, a no-ability template or a
 *     default score.
 *   - The descriptor only recognises the **Unit** form `When I hold, you score
 *     1 point.` It does NOT recognise the **Battlefield** form
 *     `When you hold here, …` (CR v1.4 383.4.d.1 lists both phrasings): "I" and
 *     "you" bind to DIFFERENT sources, so the two shapes are not interchangeable
 *     and the Battlefield shape is deliberately out of scope here.
 *
 * CR v1.4 evidence (all rule facts; nothing from the post-2026-10-16 ruleset):
 *
 *   - 383.4.d: Hold Effects are Triggered Abilities whose Condition includes a
 *     Unit being present at a Battlefield during the Beginning Phase when a
 *     player scores Victory Points from Holding.
 *   - 383.4.d.1: these are commonly structured as "When I hold…" or
 *     "When you hold…".
 *   - 383.4.d.2 / .d.2.a: the Hold Abilities of UNITS are put on the Chain after
 *     the Unit is present at a Battlefield when a player maintains control of it
 *     and Gains 1 Victory Point during their Beginning Phase from Holding. This
 *     is what "I hold" means for a Unit source.
 *   - 383.4.d.2.b: a Hold Ability that references the player Holding fires when
 *     the controller of the triggering source has performed a Hold.
 *   - 383.4.d.2.c: a negated/replaced hold point still triggers the effect.
 *   - 383.4.d.3: these Triggered Abilities can be referred to as Hold Effects.
 *   - 468 / 468.1 / 469.2: Scoring is gaining a point by seizing or maintaining
 *     control of Battlefields; Hold is maintaining control of a Battlefield the
 *     player did not yet Score this turn during their Beginning Phase.
 *   - 471.2 / 471.2.b: Trigger Score abilities trigger at the Battlefield that
 *     Scored; Hold abilities trigger at a Battlefield that was Held.
 *   - 471.1.a.1: points gained from sources that are not Conquer are not
 *     beholden to the Final Point restrictions. The DESCRIPTOR DOES NOT CLAIM
 *     this closes the Final Point interaction for this card; it is listed as an
 *     explicitly `unmodeled`/unclosed aspect below.
 *   - 190.6.d: "You" in a battlefield's abilities refers to the battlefield's
 *     Controller; used only to CONTRAST with the Unit form (which is the only
 *     form recognised here).
 *   - 191.4.a: by default, the Controller of an Ability's Source is the
 *     Controller of that Ability. This is the evidence that "you" in a Unit's
 *     Hold Ability is the controller of the ability (i.e. the controller of the
 *     source Unit) — the `ability-controller` binding below.
 *
 * The functional effect is modelled ONLY as data:
 *   `{ kind: 'score-points', amount: 1, recipient: 'ability-controller' }`.
 * It is a label, NOT a claim that any executor applies it.
 */

import { normalizeAbilityText } from "./ability-bindings.js";
import type { DuelSourcePrintingCard } from "./official-programs.js";

/** Fixed schema kind of a recognised Hold→score description. */
export const DUEL_HOLD_SCORE_V1_KIND = "hold-score-description-v1" as const;

/**
 * The verified catalog this descriptor's literal text was derived from. Carried
 * verbatim on a known result as FIXED source metadata. It is NOT recomputed and
 * NOT authenticated here: as with the rest of this package, catalog authenticity
 * (and the digest itself) is the responsibility of the upstream verified-catalog
 * layer. A caller must not treat it as proof of a verified catalog.
 */
export const DUEL_HOLD_SCORE_V1_DATA_VERSION = "2026-10-12-official-gallery" as const;
export const DUEL_HOLD_SCORE_V1_CATALOG_DIGEST =
  "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10" as const;

/**
 * The exact complete whole-ability literal of this family (the real catalog
 * text, e.g. `ogn-066-298` / `ogn-066a-298`). The literal has no reminder line
 * and no `:rb_*:` symbol, so there is nothing to normalise beyond the shared
 * whitespace normalisation. Any deviation — an added/removed word, `here`, a
 * different amount, an extra sentence — is a different source and is `unknown`.
 */
export const DUEL_HOLD_SCORE_V1_WHOLE_TEXT = "When I hold, you score 1 point." as const;

/** The literal score amount printed by this family (CR 469.2 / 471.1). */
export const DUEL_HOLD_SCORE_V1_SCORE_AMOUNT = 1 as const;

/** The trigger event name this whole ability is bound to (CR 383.4.d / 471.2.b). */
export const DUEL_HOLD_SCORE_V1_TRIGGER_EVENT = "hold" as const;

/** Why a printing is not recognised as a known Hold→score description. */
export type DuelHoldScoreV1UnknownReason =
  | "not-unit"
  | "empty-ability-text"
  | "ability-not-pure-hold-score";

/**
 * The data-only effect body of the trigger. `recipient: "ability-controller"`
 * encodes the evidenced "you" binding (CR 383.4.d.2.b + 191.4.a); it is NOT a
 * runtime payee and NOT a resource grant.
 */
export interface DuelHoldScoreV1Effect {
  readonly kind: "score-points";
  readonly amount: typeof DUEL_HOLD_SCORE_V1_SCORE_AMOUNT;
  readonly recipient: "ability-controller";
}

export interface DuelHoldScoreV1Semantics {
  /** A Unit "When I hold…" trigger that instructs its controller to score. */
  readonly kind: "hold-trigger-score";
  /** CR 383.4.d / 471.2.b: the Hold event. */
  readonly event: typeof DUEL_HOLD_SCORE_V1_TRIGGER_EVENT;
  /**
   * The Unit form of "I hold" (CR 383.4.d.2.a). Deliberately distinct from the
   * Battlefield-controller scope of "When you hold here…", which is NOT accepted.
   */
  readonly sourceScope: "hold-source-unit";
  /** CR 383.4.d.3: this is a Hold Effect. */
  readonly triggerCategory: "hold-effect";
  /** CR 383.4.d.2.b + 191.4.a: "you" is the controller of this ability. */
  readonly controllerBinding: "ability-controller";
  /** No additional condition is printed on this whole ability. */
  readonly condition: null;
  readonly optional: false;
  readonly effects: readonly [DuelHoldScoreV1Effect];
  /**
   * Aspects this DATA descriptor deliberately does NOT close. Every entry is an
   * open question (unknown), never a claim of executable behaviour.
   */
  readonly unmodeled: readonly string[];
}

/** Source-bound printing projection carried onto a known result. */
export interface DuelHoldScoreV1Source {
  readonly normalizedAbilityText: string;
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
  /** FIXED verified-catalog metadata (carried verbatim, not re-verified here). */
  readonly dataVersion: typeof DUEL_HOLD_SCORE_V1_DATA_VERSION;
  readonly sourceCatalogDigest: typeof DUEL_HOLD_SCORE_V1_CATALOG_DIGEST;
}

export interface DuelHoldScoreV1Known {
  readonly status: "known";
  readonly kind: typeof DUEL_HOLD_SCORE_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly source: DuelHoldScoreV1Source;
  /**
   * Content fingerprint of the WHOLE normalised source text (see
   * `holdScoreWholeSourceFingerprint`). It is identical across the alt-art
   * printings of one canonical identity and is computed from the snapshot, never
   * read from the caller.
   */
  readonly wholeSourceFingerprint: string;
  readonly semantics: DuelHoldScoreV1Semantics;
}

export interface DuelHoldScoreV1Unknown {
  readonly status: "unknown";
  readonly kind: typeof DUEL_HOLD_SCORE_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly normalizedAbilityText: string;
  readonly reason: DuelHoldScoreV1UnknownReason;
}

export type DuelHoldScoreV1Description = DuelHoldScoreV1Known | DuelHoldScoreV1Unknown;

// --- Dependency-free SHA-256 (content fingerprint only, not authentication) ---

const SHA256_K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr32(value: number, shift: number): number {
  return ((value >>> shift) | (value << (32 - shift))) >>> 0;
}

/**
 * Standard SHA-256 over the UTF-8 bytes of `input`, returned as lowercase hex.
 * This exists only because this package has no Node type surface; it is a
 * content fingerprint, NOT a cryptographic guarantee.
 */
function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 4294967296), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15] ?? 0;
      const y = w[i - 2] ?? 0;
      const s0 = rotr32(x, 7) ^ rotr32(x, 18) ^ (x >>> 3);
      const s1 = rotr32(y, 17) ^ rotr32(y, 19) ^ (y >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }
    let a = h[0] ?? 0;
    let b = h[1] ?? 0;
    let c = h[2] ?? 0;
    let d = h[3] ?? 0;
    let e = h[4] ?? 0;
    let f = h[5] ?? 0;
    let g = h[6] ?? 0;
    let hh = h[7] ?? 0;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + (SHA256_K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = ((h[0] ?? 0) + a) >>> 0;
    h[1] = ((h[1] ?? 0) + b) >>> 0;
    h[2] = ((h[2] ?? 0) + c) >>> 0;
    h[3] = ((h[3] ?? 0) + d) >>> 0;
    h[4] = ((h[4] ?? 0) + e) >>> 0;
    h[5] = ((h[5] ?? 0) + f) >>> 0;
    h[6] = ((h[6] ?? 0) + g) >>> 0;
    h[7] = ((h[7] ?? 0) + hh) >>> 0;
  }
  let hex = "";
  for (const word of h) hex += (word >>> 0).toString(16).padStart(8, "0");
  return hex;
}

/**
 * Content fingerprint of the WHOLE normalised source text: `sha256:<hex>`.
 * The SAME text always yields the SAME fingerprint (so the two alt-art
 * printings of one canonical identity agree), and it is computed here from the
 * snapshot — a caller-supplied fingerprint field is never read or trusted.
 */
export function holdScoreWholeSourceFingerprint(normalizedAbilityText: string): string {
  if (typeof normalizedAbilityText !== "string") {
    throw new TypeError("Duel hold score: normalizedAbilityText must be a string.");
  }
  return `sha256:${sha256Hex(normalizedAbilityText)}`;
}

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
    throw new TypeError(`Duel hold score: ${label} must be an object.`);
  }
}

/**
 * Read the whole printing tuple through own DATA descriptors only. Accessors,
 * sparse arrays, symbol keys and non-enumerable fields are rejected rather than
 * read, so no getter is ever invoked while describing a printing. Extra
 * enumerable DATA fields (e.g. the real catalog's `imageUrl`) are tolerated and
 * never read as semantics.
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
    throw new TypeError(`Duel hold score: ${label} must be acyclic data.`);
  }
  const array = Array.isArray(raw);
  const prototype = Object.getPrototypeOf(raw);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Duel hold score: ${label} must be ordinary data.`);
  }
  ancestors.add(raw);
  try {
    const keys = Reflect.ownKeys(raw);
    if (array) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(raw, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor) ||
          !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
          keys.length !== lengthDescriptor.value + 1 || !keys.includes("length")) {
        throw new TypeError(`Duel hold score: ${label} must be a dense array.`);
      }
      const output: unknown[] = [];
      for (let index = 0; index < lengthDescriptor.value; index++) {
        const item = Object.getOwnPropertyDescriptor(raw, String(index));
        if (!item || !("value" in item) || !item.enumerable) {
          throw new TypeError(`Duel hold score: ${label}[${index}] must be an own data property.`);
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
        throw new TypeError(`Duel hold score: ${label} requires enumerable own data fields.`);
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
    throw new TypeError(`Duel hold score: ${label} must be a non-empty string.`);
  }
}

function assertNullableSafeInteger(value: unknown, label: string): asserts value is number | null {
  if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError(`Duel hold score: ${label} must be a nonnegative integer or null.`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`Duel hold score: ${label} must be an ordinary array.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string" ||
      (key !== "length" && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))) {
    throw new TypeError(`Duel hold score: ${label} must have exactly its dense indices and length.`);
  }
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      throw new TypeError(`Duel hold score: ${label} must contain non-empty strings.`);
    }
  }
}

function assertCardSnapshot(value: unknown, label: string): asserts value is Record<string, unknown> {
  assertObject(value, label);
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    const item = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !item || !("value" in item) || !item.enumerable) {
      throw new TypeError(`Duel hold score: ${label} requires enumerable own data fields.`);
    }
  }
  for (const key of CARD_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`Duel hold score: ${label}.${key} is required.`);
    }
  }
  assertNonEmptyString(value.id, `${label}.id`);
  assertNonEmptyString(value.cardType, `${label}.cardType`);
  if (value.ability !== null && value.ability !== undefined && typeof value.ability !== "string") {
    throw new TypeError(`Duel hold score: ${label}.ability must be a string, null or undefined.`);
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

/**
 * Aspects this descriptor deliberately leaves open/unclosed. They are honest
 * unknowns, never executable claims.
 */
const UNMODELED_ASPECTS: readonly string[] = Object.freeze([
  "final-point-restriction-interaction",
  "score-vs-gain-point-exact-classification",
  "chain-ordering-and-priority",
  "replacement-and-negation-interaction",
  "runtime-execution",
]);

function makeUnknown(
  cardId: string,
  canonicalCardId: string,
  normalizedAbilityText: string,
  reason: DuelHoldScoreV1UnknownReason,
): DuelHoldScoreV1Unknown {
  return freezeDeep({
    status: "unknown",
    kind: DUEL_HOLD_SCORE_V1_KIND,
    cardId,
    canonicalCardId,
    normalizedAbilityText,
    reason,
  });
}

/**
 * Describe one printing's whole-ability Unit Hold→score trigger, or report
 * `unknown`.
 *
 * The input is snapshotted through own data descriptors (no getter is invoked)
 * and must be an exact `DuelSourcePrintingCard` tuple. A recognised description
 * binds the printing's `id` / `canonicalCardId` / normalized ability text, the
 * whole printed tuple (`energy` / `power` / `might` / `domains` / `tags`), the
 * FIXED verified-catalog metadata and a content fingerprint of the whole source
 * text, and returns data-only semantics.
 */
export function describeDuelHoldScoreV1(card: DuelSourcePrintingCard): DuelHoldScoreV1Description {
  const snapshot = snapshotCard(card, "card", new Set<object>(), CARD_FIELD_SET);
  assertCardSnapshot(snapshot, "card");
  const cardId = snapshot.id as string;
  const canonicalCardId = snapshot.canonicalCardId as string;
  const normalized = normalizeAbilityText(snapshot.ability as string | null | undefined);

  if (snapshot.cardType !== "Unit") {
    return makeUnknown(cardId, canonicalCardId, normalized, "not-unit");
  }
  if (normalized.length === 0) {
    return makeUnknown(cardId, canonicalCardId, normalized, "empty-ability-text");
  }
  if (normalized !== DUEL_HOLD_SCORE_V1_WHOLE_TEXT) {
    return makeUnknown(cardId, canonicalCardId, normalized, "ability-not-pure-hold-score");
  }

  return freezeDeep({
    status: "known" as const,
    kind: DUEL_HOLD_SCORE_V1_KIND,
    cardId,
    canonicalCardId,
    source: {
      normalizedAbilityText: normalized,
      energy: snapshot.energy as number | null,
      power: snapshot.power as number | null,
      might: snapshot.might as number | null,
      domains: [...(snapshot.domains as readonly string[])],
      tags: [...(snapshot.tags as readonly string[])],
      dataVersion: DUEL_HOLD_SCORE_V1_DATA_VERSION,
      sourceCatalogDigest: DUEL_HOLD_SCORE_V1_CATALOG_DIGEST,
    },
    wholeSourceFingerprint: holdScoreWholeSourceFingerprint(normalized),
    semantics: {
      kind: "hold-trigger-score" as const,
      event: DUEL_HOLD_SCORE_V1_TRIGGER_EVENT,
      sourceScope: "hold-source-unit" as const,
      triggerCategory: "hold-effect" as const,
      controllerBinding: "ability-controller" as const,
      condition: null,
      optional: false as const,
      effects: [{
        kind: "score-points" as const,
        amount: DUEL_HOLD_SCORE_V1_SCORE_AMOUNT,
        recipient: "ability-controller" as const,
      }] as readonly [DuelHoldScoreV1Effect],
      unmodeled: UNMODELED_ASPECTS,
    },
  });
}
