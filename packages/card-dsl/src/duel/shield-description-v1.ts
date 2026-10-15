/**
 * Pure-DATA recogniser for the whole-ability Unit **Shield** keyword
 * (schema `shield-description-v1`, CR v1.4 rule 814).
 *
 * Boundary (read this first):
 *
 *   - This is a STRICT, TEXT-MATCHING DATA DESCRIPTOR. It recognises one whole
 *     ability shape and returns a frozen description of the printed Shield
 *     value. It is NOT an authority, NOT a SourceProgramClosure, NOT an
 *     executable card program, and it is NOT registered in the official-program
 *     registry.
 *   - It never mints capabilities: the result carries no `privateUID`, no
 *     per-printing epoch, no mint receipt, no `sourceProof` flag, no
 *     `sourceProgramComplete` flag and no encoded executable reference. A
 *     `known` result only means "this COMPLETE printed source text is the pure
 *     Unit Shield keyword". It is NOT a negative proof (an `unknown` result,
 *     conversely, says nothing about the printing's real abilities) and it does
 *     NOT compute final Might, resolve combat, or assert any timing/target/owner
 *     semantics of interaction.
 *   - Only the COMPLETE whole ability is recognised. Any extra instruction (a
 *     trigger, `[Tank]`, a grant `Give a unit [Shield 3]`, a conditional
 *     "I have [Shield] while ...", an aura, a dynamic "equal to ..." value, a
 *     second keyword, an unknown trailing sentence, …) makes the printing
 *     `unknown`. Containment of the `[Shield]` keyword is never sufficient.
 *   - `unknown` NEVER degrades to a blank program, a no-ability template or a
 *     default Shield 1.
 *
 * CR v1.4 evidence (all rule facts; nothing from a post-2026-10-16 ruleset):
 *
 *   - 814.1 / 814.1.a: Shield is a Passive Ability keyword present on Units.
 *   - 814.1.b / .b.1 / .b.2: formatted "Shield [X]"; X is the Shield Value.
 *   - 814.1.b.3: if X is omitted, it is presumed to be 1.
 *   - 814.1.c: "While I am a defender, I have +X [M]." (the functional text).
 *   - 814.1.d / .d.1: being a defender means the Unit has the Defender
 *     designation during Combat (rule 459); Shield remains in effect only while
 *     the Unit maintains that designation.
 *   - 814.2: Shield from multiple sources sums.
 *   - 814.3: "has Shield" is a Unit characteristic, readable by other effects.
 *
 * The functional effect is modelled ONLY as data:
 *   `{ kind: 'shield', amount, condition: 'while-defender', layer: 'add-subtract-might' }`.
 * The layer name reflects the rule-layer the modifier belongs to (a Might
 * add/subtract); it is a label, not a claim that any executor applies it.
 *
 * Literal reminder text (the real catalog wording; straight apostrophe U+0027)
 * is variable only in the Shield Value, e.g.
 * `[Shield 2] (+2 :rb_might: while I'm a defender.)`. It describes SELF +X Might
 * only while this Unit is a defender; it is never an Assault/attacker modifier,
 * never a global/aura buff, and a defender role that is not currently known must
 * never default to non-applicable.
 */

import { normalizeAbilityText } from "./ability-bindings.js";
import type { DuelSourcePrintingCard } from "./official-programs.js";

/** Fixed schema kind of a recognised Shield description. */
export const DUEL_SHIELD_DESCRIPTION_V1_KIND = "shield-description-v1" as const;

/**
 * The value presumed when the printed keyword omits the Shield Value
 * (CR v1.4 814.1.b.3).
 */
export const DUEL_SHIELD_DEFAULT_AMOUNT = 1 as const;

/** The only condition under which a printed Shield modifier applies. */
export const DUEL_SHIELD_CONDITION = "while-defender" as const;

/** The rule layer this modifier belongs to: a Might add/subtract. */
export const DUEL_SHIELD_LAYER = "add-subtract-might" as const;

/**
 * The exact functional reminder for one Shield Value, matching the real
 * catalog wording. Only the Shield Value varies between printings.
 */
export function shieldReminderLiteral(amount: number): string {
  return `[Shield ${amount}] (+${amount} :rb_might: while I'm a defender.)`;
}

/**
 * The verified deck-catalog version this descriptor's literal Shield wording was
 * derived from. It is recorded DATA on a known result, NOT an authentication of
 * any caller input: the descriptor never reads or trusts a version/digest field
 * supplied by the caller.
 */
export const DUEL_SHIELD_CATALOG_DATA_VERSION = "2026-10-12-official-gallery" as const;

/**
 * The verified deck-catalog digest (sha256 of the raw catalog bytes) matching
 * `DUEL_SHIELD_CATALOG_DATA_VERSION`. Also recorded DATA only.
 */
export const DUEL_SHIELD_CATALOG_DIGEST =
  "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10" as const;

/**
 * Scheme label for the whole-source fingerprint. The fingerprint is a CANONICAL,
 * length-unambiguous encoding of the complete printing source (the same ordered
 * field set the registry uses for `DuelProgramSourceFingerprint`); it is a
 * deterministic, collision-free identity of the exact source, NOT a
 * cryptographic hash, NOT an authentication, and NOT a capability.
 */
export const DUEL_SHIELD_SOURCE_FINGERPRINT_SCHEME = "shield-source-v1" as const;

/**
 * Strict whole-ability match: `[Shield]`, `[Shield N]`, or either followed by
 * the exact reminder `(+N :rb_might: while I'm a defender.)`. Anything else is
 * not a pure whole-ability Shield.
 */
const PURE_SHIELD_WHOLE_TEXT =
  /^\[Shield(?: (\d+))?\](?: \(\+(\d+) :rb_might: while I'm a defender\.\))?$/u;

/** Why a printing is not recognised as a known Shield description. */
export type DuelShieldV1UnknownReason =
  | "not-unit"
  | "ability-not-pure-shield"
  | "shield-reminder-mismatch"
  | "non-numeric-source-stat";

export interface DuelShieldV1Semantics {
  readonly kind: "shield";
  readonly amount: number;
  readonly condition: typeof DUEL_SHIELD_CONDITION;
  readonly layer: typeof DUEL_SHIELD_LAYER;
}

/** Source-bound printing projection carried onto a known result. */
export interface DuelShieldV1Source {
  readonly normalizedAbilityText: string;
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
}

export interface DuelShieldV1Known {
  readonly status: "known";
  readonly kind: typeof DUEL_SHIELD_DESCRIPTION_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly catalogDataVersion: typeof DUEL_SHIELD_CATALOG_DATA_VERSION;
  readonly catalogDigest: typeof DUEL_SHIELD_CATALOG_DIGEST;
  /**
   * Deterministic whole-source fingerprint of the COMPLETE printing source. It
   * is recomputed from the snapshot, never taken from a caller-supplied field.
   */
  readonly sourceFingerprint: string;
  readonly source: DuelShieldV1Source;
  readonly printedMight: number;
  readonly semantics: DuelShieldV1Semantics;
}

export interface DuelShieldV1Unknown {
  readonly status: "unknown";
  readonly kind: typeof DUEL_SHIELD_DESCRIPTION_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly normalizedAbilityText: string;
  readonly reason: DuelShieldV1UnknownReason;
}

export type DuelShieldV1Description = DuelShieldV1Known | DuelShieldV1Unknown;

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
    throw new TypeError(`Duel shield: ${label} must be an object.`);
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
    throw new TypeError(`Duel shield: ${label} must be acyclic data.`);
  }
  const array = Array.isArray(raw);
  const prototype = Object.getPrototypeOf(raw);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Duel shield: ${label} must be ordinary data.`);
  }
  ancestors.add(raw);
  try {
    const keys = Reflect.ownKeys(raw);
    if (array) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(raw, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor) ||
          !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
          keys.length !== lengthDescriptor.value + 1 || !keys.includes("length")) {
        throw new TypeError(`Duel shield: ${label} must be a dense array.`);
      }
      const output: unknown[] = [];
      for (let index = 0; index < lengthDescriptor.value; index++) {
        const item = Object.getOwnPropertyDescriptor(raw, String(index));
        if (!item || !("value" in item) || !item.enumerable) {
          throw new TypeError(`Duel shield: ${label}[${index}] must be an own data property.`);
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
        throw new TypeError(`Duel shield: ${label} requires enumerable own data fields.`);
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
    throw new TypeError(`Duel shield: ${label} must be a non-empty string.`);
  }
}

function assertNullableSafeInteger(value: unknown, label: string): asserts value is number | null {
  if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError(`Duel shield: ${label} must be a nonnegative integer or null.`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`Duel shield: ${label} must be an ordinary array.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string" ||
      (key !== "length" && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))) {
    throw new TypeError(`Duel shield: ${label} must have exactly its dense indices and length.`);
  }
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      throw new TypeError(`Duel shield: ${label} must contain non-empty strings.`);
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
      throw new TypeError(`Duel shield: ${label} requires enumerable own data fields.`);
    }
  }
  for (const key of CARD_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`Duel shield: ${label}.${key} is required.`);
    }
  }
  assertNonEmptyString(value.id, `${label}.id`);
  assertNonEmptyString(value.cardType, `${label}.cardType`);
  if (value.ability !== null && value.ability !== undefined && typeof value.ability !== "string") {
    throw new TypeError(`Duel shield: ${label}.ability must be a string, null or undefined.`);
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

// --- Whole-source fingerprint -------------------------------------------------

const FINGERPRINT_FIELDS = [
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

/**
 * Encode one field value in a length-unambiguous, branch-free way. Strings are
 * prefixed by their UTF-16 length, arrays by their element count and the
 * `a`/`n`/`s`/`u` tags distinguish null / number / string / undefined so that no
 * two distinct sources can ever collide on the same encoding.
 */
function encodeFingerprintValue(value: unknown): string {
  if (value === null) return "n";
  if (value === undefined) return "u";
  if (typeof value === "number") return `#${value}`;
  if (typeof value === "string") return `s${value.length}:${value}`;
  if (Array.isArray(value)) {
    const parts = value.map((item) => encodeFingerprintValue(item));
    return `a${parts.length}[${parts.join("|")}]`;
  }
  throw new TypeError("Duel shield: unsupported fingerprint value.");
}

/**
 * Deterministic whole-source fingerprint over the COMPLETE printing tuple. The
 * snapshot is already fully validated, so this never throws for a snapshot.
 */
function wholeSourceFingerprint(snapshot: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const field of FINGERPRINT_FIELDS) {
    parts.push(`${field}=${encodeFingerprintValue(snapshot[field])}`);
  }
  return `${DUEL_SHIELD_SOURCE_FINGERPRINT_SCHEME}:${parts.join(";")}`;
}

// --- Recognition --------------------------------------------------------------

/**
 * Parse a complete pure whole-ability Shield text and return its Shield Value,
 * or `{ mismatch: true }` when the reminder disagrees with the printed value.
 * Returns `null` when the whole text is not a pure Shield ability.
 */
function parsePureShield(normalized: string): { amount: number } | { mismatch: true } | null {
  const match = PURE_SHIELD_WHOLE_TEXT.exec(normalized);
  if (match === null) return null;
  const printed = match[1];
  // CR 814.1.b.3: an omitted Shield Value is presumed to be 1.
  const amount = printed === undefined ? DUEL_SHIELD_DEFAULT_AMOUNT : Number(printed);
  const reminder = match[2];
  // The reminder, when present, must echo the printed Shield Value exactly.
  if (reminder !== undefined && Number(reminder) !== amount) return { mismatch: true };
  return { amount };
}

function makeUnknown(
  cardId: string,
  canonicalCardId: string,
  normalizedAbilityText: string,
  reason: DuelShieldV1UnknownReason,
): DuelShieldV1Unknown {
  return freezeDeep({
    status: "unknown",
    kind: DUEL_SHIELD_DESCRIPTION_V1_KIND,
    cardId,
    canonicalCardId,
    normalizedAbilityText,
    reason,
  });
}

/**
 * Describe one printing's whole-ability Unit Shield, or report `unknown`.
 *
 * The input is snapshotted through own data descriptors (no getter is invoked)
 * and must be an exact `DuelSourcePrintingCard` tuple. A recognised description
 * binds the printing's `id` / `canonicalCardId` / normalized ability text, the
 * whole printed tuple (`energy` / `power` / `might` / `domains` / `tags`) and the
 * printed Might, and returns data-only semantics. It does NOT compute a final
 * Might and does NOT claim combat closure; the Shield Value is the printed
 * modifier only.
 */
export function describeDuelShieldV1(card: DuelSourcePrintingCard): DuelShieldV1Description {
  const snapshot = snapshotCard(card, "card", new Set<object>(), CARD_FIELD_SET);
  assertCardSnapshot(snapshot, "card");
  const cardId = snapshot.id as string;
  const canonicalCardId = snapshot.canonicalCardId as string;
  const normalized = normalizeAbilityText(snapshot.ability as string | null | undefined);

  if (snapshot.cardType !== "Unit") {
    return makeUnknown(cardId, canonicalCardId, normalized, "not-unit");
  }

  const parsed = parsePureShield(normalized);
  if (parsed === null) {
    return makeUnknown(cardId, canonicalCardId, normalized, "ability-not-pure-shield");
  }
  if ("mismatch" in parsed) {
    return makeUnknown(cardId, canonicalCardId, normalized, "shield-reminder-mismatch");
  }

  const might = snapshot.might as number | null;
  if (might === null) {
    return makeUnknown(cardId, canonicalCardId, normalized, "non-numeric-source-stat");
  }

  return freezeDeep({
    status: "known" as const,
    kind: DUEL_SHIELD_DESCRIPTION_V1_KIND,
    cardId,
    canonicalCardId,
    catalogDataVersion: DUEL_SHIELD_CATALOG_DATA_VERSION,
    catalogDigest: DUEL_SHIELD_CATALOG_DIGEST,
    sourceFingerprint: wholeSourceFingerprint(snapshot),
    source: {
      normalizedAbilityText: normalized,
      energy: snapshot.energy as number | null,
      power: snapshot.power as number | null,
      might,
      domains: [...(snapshot.domains as readonly string[])],
      tags: [...(snapshot.tags as readonly string[])],
    },
    printedMight: might,
    semantics: {
      kind: "shield" as const,
      amount: parsed.amount,
      condition: DUEL_SHIELD_CONDITION,
      layer: DUEL_SHIELD_LAYER,
    },
  });
}
