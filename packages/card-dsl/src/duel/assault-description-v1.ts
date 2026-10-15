/**
 * Pure-DATA recogniser for the whole-ability Unit **Assault** keyword
 * (schema `assault-description-v1`, CR v1.4 rule 807).
 *
 * Boundary (read this first):
 *
 *   - This is a STRICT, TEXT-MATCHING DATA DESCRIPTOR. It recognises one whole
 *     ability shape and returns a frozen description of the printed Assault
 *     value. It is NOT an authority, NOT a SourceProgramClosure, NOT an
 *     executable card program, and it is NOT registered in the official-program
 *     registry.
 *   - It never mints capabilities: the result carries no `privateUID`, no
 *     per-printing epoch, no mint receipt, no `sourceProof` flag and no encoded
 *     executable reference.
 *   - Only the COMPLETE whole ability is recognised. Any extra instruction
 *     (a trigger, `[Shield]`, a grant `Give ... [Assault]`, a conditional
 *     "I have [Assault] when ...", an aura, a dynamic "equal to ..." value, a
 *     second keyword, an unknown trailing sentence, …) makes the printing
 *     `unknown`. Containment of the `[Assault]` keyword is never sufficient.
 *   - `unknown` NEVER degrades to a blank program, a no-ability template or a
 *     default Assault 1.
 *
 * CR v1.4 evidence (all rule facts; nothing from a post-2026-10-16 ruleset):
 *
 *   - 807.1 / 807.1.a: Assault is a Passive Ability keyword present on Units.
 *   - 807.1.b / .b.1 / .b.2: formatted "Assault [X]"; X is the Assault Value.
 *   - 807.1.b.3: if X is omitted, it is presumed to be 1.
 *   - 807.1.c: "While I am an attacker, I have +X [M]." (the functional text).
 *   - 807.1.d / .d.1: being an attacker means holding the Attacker designation
 *     during Combat (rule 459); Assault remains in effect only while the Unit
 *     maintains that designation.
 *   - 807.2: Assault from multiple sources sums.
 *   - 807.3: "has Assault" is a Unit characteristic, readable by other effects.
 *
 * The functional effect is modelled ONLY as data:
 *   `{ kind: 'assault', amount, condition: 'while-attacker', layer: 'add-subtract-might' }`.
 * The layer name reflects the rule-layer the modifier belongs to (a Might
 * add/subtract); it is a label, not a claim that any executor applies it.
 *
 * Literal reminder text (the real catalog wording) is variable only in the
 * Assault Value, e.g. `[Assault 2] (+2 :rb_might: while I'm an attacker.)`.
 */

import { normalizeAbilityText } from "./ability-bindings.js";
import type { DuelSourcePrintingCard } from "./official-programs.js";

/** Fixed schema kind of a recognised Assault description. */
export const DUEL_ASSAULT_DESCRIPTION_V1_KIND = "assault-description-v1" as const;

/**
 * The value presumed when the printed keyword omits the Assault Value
 * (CR v1.4 807.1.b.3).
 */
export const DUEL_ASSAULT_DEFAULT_AMOUNT = 1 as const;

/** The only condition under which a printed Assault modifier applies. */
export const DUEL_ASSAULT_CONDITION = "while-attacker" as const;

/** The rule layer this modifier belongs to: a Might add/subtract. */
export const DUEL_ASSAULT_LAYER = "add-subtract-might" as const;

/**
 * The exact functional reminder for one Assault Value, matching the real
 * catalog wording. Only the Assault Value varies between printings.
 */
export function assaultReminderLiteral(amount: number): string {
  return `[Assault ${amount}] (+${amount} :rb_might: while I'm an attacker.)`;
}

/**
 * Strict whole-ability match: `[Assault]`, `[Assault N]`, or either followed by
 * the exact reminder `(+N :rb_might: while I'm an attacker.)`. Anything else is
 * not a pure whole-ability Assault.
 */
const PURE_ASSAULT_WHOLE_TEXT =
  /^\[Assault(?: (\d+))?\](?: \(\+(\d+) :rb_might: while I'm an attacker\.\))?$/u;

/** Why a printing is not recognised as a known Assault description. */
export type DuelAssaultV1UnknownReason =
  | "not-unit"
  | "ability-not-pure-assault"
  | "assault-reminder-mismatch"
  | "non-numeric-source-stat";

export interface DuelAssaultV1Semantics {
  readonly kind: "assault";
  readonly amount: number;
  readonly condition: typeof DUEL_ASSAULT_CONDITION;
  readonly layer: typeof DUEL_ASSAULT_LAYER;
}

/** Source-bound printing projection carried onto a known result. */
export interface DuelAssaultV1Source {
  readonly normalizedAbilityText: string;
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
}

export interface DuelAssaultV1Known {
  readonly status: "known";
  readonly kind: typeof DUEL_ASSAULT_DESCRIPTION_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly source: DuelAssaultV1Source;
  readonly printedMight: number;
  readonly semantics: DuelAssaultV1Semantics;
}

export interface DuelAssaultV1Unknown {
  readonly status: "unknown";
  readonly kind: typeof DUEL_ASSAULT_DESCRIPTION_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly normalizedAbilityText: string;
  readonly reason: DuelAssaultV1UnknownReason;
}

export type DuelAssaultV1Description = DuelAssaultV1Known | DuelAssaultV1Unknown;

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
    throw new TypeError(`Duel assault: ${label} must be an object.`);
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
    throw new TypeError(`Duel assault: ${label} must be acyclic data.`);
  }
  const array = Array.isArray(raw);
  const prototype = Object.getPrototypeOf(raw);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Duel assault: ${label} must be ordinary data.`);
  }
  ancestors.add(raw);
  try {
    const keys = Reflect.ownKeys(raw);
    if (array) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(raw, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor) ||
          !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
          keys.length !== lengthDescriptor.value + 1 || !keys.includes("length")) {
        throw new TypeError(`Duel assault: ${label} must be a dense array.`);
      }
      const output: unknown[] = [];
      for (let index = 0; index < lengthDescriptor.value; index++) {
        const item = Object.getOwnPropertyDescriptor(raw, String(index));
        if (!item || !("value" in item) || !item.enumerable) {
          throw new TypeError(`Duel assault: ${label}[${index}] must be an own data property.`);
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
        throw new TypeError(`Duel assault: ${label} requires enumerable own data fields.`);
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
    throw new TypeError(`Duel assault: ${label} must be a non-empty string.`);
  }
}

function assertNullableSafeInteger(value: unknown, label: string): asserts value is number | null {
  if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError(`Duel assault: ${label} must be a nonnegative integer or null.`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`Duel assault: ${label} must be an ordinary array.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string" ||
      (key !== "length" && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))) {
    throw new TypeError(`Duel assault: ${label} must have exactly its dense indices and length.`);
  }
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      throw new TypeError(`Duel assault: ${label} must contain non-empty strings.`);
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
      throw new TypeError(`Duel assault: ${label} requires enumerable own data fields.`);
    }
  }
  for (const key of CARD_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`Duel assault: ${label}.${key} is required.`);
    }
  }
  assertNonEmptyString(value.id, `${label}.id`);
  assertNonEmptyString(value.cardType, `${label}.cardType`);
  if (value.ability !== null && value.ability !== undefined && typeof value.ability !== "string") {
    throw new TypeError(`Duel assault: ${label}.ability must be a string, null or undefined.`);
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
 * Parse a complete pure whole-ability Assault text and return its Assault Value,
 * or `{ mismatch: true }` when the reminder disagrees with the printed value.
 * Returns `null` when the whole text is not a pure Assault ability.
 */
function parsePureAssault(normalized: string): { amount: number } | { mismatch: true } | null {
  const match = PURE_ASSAULT_WHOLE_TEXT.exec(normalized);
  if (match === null) return null;
  const printed = match[1];
  // CR 807.1.b.3: an omitted Assault Value is presumed to be 1.
  const amount = printed === undefined ? DUEL_ASSAULT_DEFAULT_AMOUNT : Number(printed);
  const reminder = match[2];
  // The reminder, when present, must echo the printed Assault Value exactly.
  if (reminder !== undefined && Number(reminder) !== amount) return { mismatch: true };
  return { amount };
}

function makeUnknown(
  cardId: string,
  canonicalCardId: string,
  normalizedAbilityText: string,
  reason: DuelAssaultV1UnknownReason,
): DuelAssaultV1Unknown {
  return freezeDeep({
    status: "unknown",
    kind: DUEL_ASSAULT_DESCRIPTION_V1_KIND,
    cardId,
    canonicalCardId,
    normalizedAbilityText,
    reason,
  });
}

/**
 * Describe one printing's whole-ability Unit Assault, or report `unknown`.
 *
 * The input is snapshotted through own data descriptors (no getter is invoked)
 * and must be an exact `DuelSourcePrintingCard` tuple. A recognised description
 * binds the printing's `id` / `canonicalCardId` / normalized ability text, the
 * whole printed tuple (`energy` / `power` / `might` / `domains` / `tags`) and the
 * printed Might, and returns data-only semantics.
 */
export function describeDuelAssaultV1(card: DuelSourcePrintingCard): DuelAssaultV1Description {
  const snapshot = snapshotCard(card, "card", new Set<object>(), CARD_FIELD_SET);
  assertCardSnapshot(snapshot, "card");
  const cardId = snapshot.id as string;
  const canonicalCardId = snapshot.canonicalCardId as string;
  const normalized = normalizeAbilityText(snapshot.ability as string | null | undefined);

  if (snapshot.cardType !== "Unit") {
    return makeUnknown(cardId, canonicalCardId, normalized, "not-unit");
  }

  const parsed = parsePureAssault(normalized);
  if (parsed === null) {
    return makeUnknown(cardId, canonicalCardId, normalized, "ability-not-pure-assault");
  }
  if ("mismatch" in parsed) {
    return makeUnknown(cardId, canonicalCardId, normalized, "assault-reminder-mismatch");
  }

  const might = snapshot.might as number | null;
  if (might === null) {
    return makeUnknown(cardId, canonicalCardId, normalized, "non-numeric-source-stat");
  }

  return freezeDeep({
    status: "known" as const,
    kind: DUEL_ASSAULT_DESCRIPTION_V1_KIND,
    cardId,
    canonicalCardId,
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
      kind: "assault" as const,
      amount: parsed.amount,
      condition: DUEL_ASSAULT_CONDITION,
      layer: DUEL_ASSAULT_LAYER,
    },
  });
}
