/**
 * Pure-DATA recogniser for the whole-ability Unit **[Temporary]** keyword
 * (schema `temporary-description-v1`, CR v1.4 rule 816).
 *
 * Boundary (read this first):
 *
 *   - This is a STRICT, TEXT-MATCHING DATA DESCRIPTOR. It recognises one whole
 *     ability shape and returns a frozen, source-bound description of the
 *     printed keyword. It is NOT an authority, NOT a SourceProgramClosure, NOT
 *     an executable card program, and it is NOT registered in the
 *     official-program registry.
 *   - It never mints capabilities: the result carries no `privateUID`, no
 *     per-printing epoch, no mint receipt, no `sourceProof` flag, no
 *     `sourceProgramComplete` flag, no negative proof and no encoded executable
 *     reference. A caller must not treat the returned object as a licence to
 *     kill, create or play anything.
 *   - Recognising `[Temporary]` grants NO play permission: the descriptor always
 *     reports `grantsPlayFromHand: false`. It does not create a Unit, does not
 *     kill anything, and does NOT treat every Unit as a token. A printing is
 *     labelled `token-definition` ONLY when the source `tags` carry the real
 *     `Token` tag; every other Unit is `physical-printing`.
 *   - Only the COMPLETE whole ability is recognised. Any extra instruction
 *     (`[Hidden]`, `[Equip]`, a trigger, a grant `Give ... [Temporary]`, a
 *     conditional, a second keyword, an unknown trailing sentence, a stray
 *     rune/energy symbol, …) makes the printing `unknown`. Containment of the
 *     `[Temporary]` keyword is never sufficient, and no prefix match is done.
 *   - `unknown` NEVER degrades to a blank program or a no-ability template.
 *
 * CR v1.4 evidence (all rule facts; nothing from a post-2026-10-16 ruleset):
 *
 *   - 816.1   Temporary is a Triggered Ability keyword.
 *   - 816.1.a It is present on Permanents.
 *   - 816.1.b It is functionally short for "At the start of this permanent's
 *             controller's Beginning Phase, before scoring, kill this."
 *   - 816.1.c The Trigger Condition is the controller of the permanent's
 *             Beginning Phase starting.
 *   - 816.2   Multiple instances of Temporary are redundant.
 *   - 816.2.a Regardless of how many instances there are, it triggers once.
 *   - 816.3   "has Temporary" is a permanent characteristic, readable by other
 *             Game Effects.
 *   - 315.2 / 315.2.a.1 / 315.2.b  The Beginning Phase has a Beginning Step
 *             ("At the start of Beginning Phase game effects take place")
 *             that runs before the Scoring Step, so the printed "before
 *             scoring" ordering is the Beginning Step.
 *   - 187.2   a 3 [M] Sprite token with Temporary is a domainless unit token
 *             with 3 Might, the Fae tag, and the Temporary keyword.
 *
 * The functional meaning is recorded ONLY as data:
 *   `{ kind: 'temporary', trigger: { kind: 'beginning-phase-start',
 *   controllerRelative: 'controller', ordering: 'before-scoring' },
 *   effect: { kind: 'kill', subject: 'self' } }`.
 * Those labels describe the printed keyword; they are NOT a claim that any
 * executor applies them. The exact precision of the kill/target/owner
 * interpretation at runtime remains the Core executor's responsibility.
 *
 * Source of the literal text: the verified catalog's real Unit Temporary
 * reminder, e.g. `[Temporary] (Kill me at the start of your Beginning Phase,
 * before scoring.)` on the two token printings `ogn-274-298` / `unl-t07`.
 */

import { normalizeAbilityText } from "./ability-bindings.js";
import type { DuelSourcePrintingCard } from "./official-programs.js";

/** Fixed schema kind of a recognised Temporary description. */
export const DUEL_TEMPORARY_DESCRIPTION_V1_KIND = "temporary-description-v1" as const;

/**
 * The `[Temporary]` reminder bodies observed in the real catalog for a
 * one-sentence, whole-ability Temporary. `Kill me at the start of your
 * Beginning Phase` is the pure Unit token wording (CR 816.1.b self form);
 * `Kill me at the start of my controller's Beginning Phase` is the other
 * self-relative wording observed on a Unit. The whole ability must be exactly
 * `[Temporary] (<body>)`; containment is never sufficient.
 */
export const DUEL_TEMPORARY_V1_REMINDER_BODIES = Object.freeze([
  "Kill me at the start of your Beginning Phase, before scoring.",
  "Kill me at the start of my controller's Beginning Phase, before scoring.",
] as const);

export type DuelTemporaryV1ReminderBody =
  (typeof DUEL_TEMPORARY_V1_REMINDER_BODIES)[number];

/** Exact whole-ability literal for one reminder body. */
export function temporaryReminderLiteral(body: DuelTemporaryV1ReminderBody): string {
  return `[Temporary] (${body})`;
}

/** Exact whole-ability literal -> the reminder body it prints. */
const TEMPORARY_WHOLE_TEXT_TO_BODY: ReadonlyMap<string, DuelTemporaryV1ReminderBody> = (() => {
  const table = new Map<string, DuelTemporaryV1ReminderBody>();
  for (const body of DUEL_TEMPORARY_V1_REMINDER_BODIES) {
    table.set(temporaryReminderLiteral(body), body);
  }
  return table;
})();

/**
 * Structurally exactly one `[Temporary] (<body>)` ability with no additional
 * sentence. Used only to pick the `temporary-reminder-mismatch` reason: the body
 * is then compared against the two observed reminders, which must match whole.
 */
const PURE_TEMPORARY_SINGLE_ABILITY = /^\[Temporary\] \(([^()]*)\)$/u;

/** Why a printing is not recognised as a known Temporary description. */
export type DuelTemporaryV1UnknownReason =
  | "not-unit"
  | "ability-not-pure-temporary"
  | "temporary-reminder-mismatch";

/** The source envelope: catalog metadata plus the exact printing tuple. */
export interface DuelTemporaryV1Envelope {
  /** Non-empty; carried verbatim, NOT cryptographically re-verified here. */
  readonly dataVersion: string;
  /** Non-empty; transport metadata only, NOT re-verified here. */
  readonly sourceCatalogDigest: string;
  readonly card: DuelSourcePrintingCard;
}

/**
 * The complete source fingerprint embedded in a description. It mirrors the
 * whole printed tuple plus the envelope version/digest so a description is bound
 * to EXACTLY the source it was derived from. The descriptor recomputes this from
 * its own snapshot; a caller-claimed fingerprint is never read or trusted.
 */
export interface DuelTemporaryV1SourceFingerprint {
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
  readonly dataVersion: string;
  readonly sourceCatalogDigest: string;
}

/**
 * Whether the source is a token definition or a constructible physical
 * printing. Derived from the real source `Token` tag; a Unit is NEVER assumed to
 * be a token. `[Temporary]` grants no play permission.
 */
export interface DuelTemporaryV1PrintingClass {
  readonly kind: "token-definition" | "physical-printing";
  readonly tokenDefinition: boolean;
  readonly grantsPlayFromHand: false;
}

export interface DuelTemporaryV1Source {
  readonly normalizedAbilityText: string;
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
}

export interface DuelTemporaryV1Trigger {
  readonly kind: "beginning-phase-start";
  readonly controllerRelative: "controller";
  readonly ordering: "before-scoring";
}

export interface DuelTemporaryV1Effect {
  readonly kind: "kill";
  readonly subject: "self";
}

export interface DuelTemporaryV1Semantics {
  readonly kind: "temporary";
  readonly abilityKind: "triggered-ability-keyword";
  readonly reminderBody: DuelTemporaryV1ReminderBody;
  readonly redundantIfMultiple: true;
  readonly trigger: DuelTemporaryV1Trigger;
  readonly effect: DuelTemporaryV1Effect;
}

export interface DuelTemporaryV1Known {
  readonly status: "known";
  readonly kind: typeof DUEL_TEMPORARY_DESCRIPTION_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly dataVersion: string;
  readonly sourceCatalogDigest: string;
  readonly sourceFingerprint: DuelTemporaryV1SourceFingerprint;
  readonly printing: DuelTemporaryV1PrintingClass;
  readonly source: DuelTemporaryV1Source;
  readonly semantics: DuelTemporaryV1Semantics;
}

export interface DuelTemporaryV1Unknown {
  readonly status: "unknown";
  readonly kind: typeof DUEL_TEMPORARY_DESCRIPTION_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly dataVersion: string;
  readonly sourceCatalogDigest: string;
  readonly normalizedAbilityText: string;
  readonly reason: DuelTemporaryV1UnknownReason;
}

export type DuelTemporaryV1Description = DuelTemporaryV1Known | DuelTemporaryV1Unknown;

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

const ENVELOPE_FIELDS = ["dataVersion", "sourceCatalogDigest", "card"] as const;

/**
 * Fast membership for the envelope. A caller-supplied `fingerprint` / any other
 * extra field is validated but NEVER read, so it can never authenticate a
 * description.
 */
const ENVELOPE_FIELD_SET: ReadonlySet<string> = new Set(ENVELOPE_FIELDS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new TypeError(`Duel temporary: ${label} must be an object.`);
  }
}

/**
 * Read the whole envelope/printing tuple through own DATA descriptors only.
 * Accessors, sparse arrays, symbol keys and non-enumerable fields are rejected
 * rather than read, so no getter is ever invoked while describing a printing.
 * When an allow-list is supplied, only the required fields are snapshotted
 * (read); extra fields are validated but never read.
 */
function snapshotValue(
  raw: unknown,
  label: string,
  ancestors = new Set<object>(),
  allowKeys?: ReadonlySet<string>,
): unknown {
  if (raw === null || raw === undefined || typeof raw === "string" || typeof raw === "boolean") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "object" || ancestors.has(raw) || ancestors.size >= 64) {
    throw new TypeError(`Duel temporary: ${label} must be acyclic data.`);
  }
  const array = Array.isArray(raw);
  const prototype = Object.getPrototypeOf(raw);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Duel temporary: ${label} must be ordinary data.`);
  }
  ancestors.add(raw);
  try {
    const keys = Reflect.ownKeys(raw);
    if (array) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(raw, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor) ||
          !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
          keys.length !== lengthDescriptor.value + 1 || !keys.includes("length")) {
        throw new TypeError(`Duel temporary: ${label} must be a dense array.`);
      }
      const output: unknown[] = [];
      for (let index = 0; index < lengthDescriptor.value; index++) {
        const item = Object.getOwnPropertyDescriptor(raw, String(index));
        if (!item || !("value" in item) || !item.enumerable) {
          throw new TypeError(`Duel temporary: ${label}[${index}] must be an own data property.`);
        }
        output.push(snapshotValue(item.value, `${label}[${index}]`, ancestors));
      }
      return output;
    }
    const output: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const item = Object.getOwnPropertyDescriptor(raw, key);
      // Accessors, symbol keys and non-enumerable fields are rejected, never read.
      if (typeof key !== "string" || !item || !("value" in item) || !item.enumerable) {
        throw new TypeError(`Duel temporary: ${label} requires enumerable own data fields.`);
      }
      if (allowKeys !== undefined && !allowKeys.has(key)) continue;
      Object.defineProperty(output, key, {
        value: snapshotValue(item.value, `${label}.${key}`, ancestors),
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
    throw new TypeError(`Duel temporary: ${label} must be a non-empty string.`);
  }
}

function assertNullableSafeInteger(value: unknown, label: string): asserts value is number | null {
  if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError(`Duel temporary: ${label} must be a nonnegative integer or null.`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`Duel temporary: ${label} must be an ordinary array.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string" ||
      (key !== "length" && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))) {
    throw new TypeError(`Duel temporary: ${label} must have exactly its dense indices and length.`);
  }
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      throw new TypeError(`Duel temporary: ${label} must contain non-empty strings.`);
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
      throw new TypeError(`Duel temporary: ${label} requires enumerable own data fields.`);
    }
  }
  for (const key of CARD_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`Duel temporary: ${label}.${key} is required.`);
    }
  }
  assertNonEmptyString(value.id, `${label}.id`);
  assertNonEmptyString(value.cardType, `${label}.cardType`);
  if (value.ability !== null && value.ability !== undefined && typeof value.ability !== "string") {
    throw new TypeError(`Duel temporary: ${label}.ability must be a string, null or undefined.`);
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

function assertEnvelopeSnapshot(value: unknown, label: string): asserts value is Record<string, unknown> {
  assertObject(value, label);
  assertNonEmptyString(value.dataVersion, `${label}.dataVersion`);
  assertNonEmptyString(value.sourceCatalogDigest, `${label}.sourceCatalogDigest`);
  if (!isPlainObject(value.card)) {
    throw new TypeError(`Duel temporary: ${label}.card must be an object.`);
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

function makeUnknown(
  cardId: string,
  canonicalCardId: string,
  dataVersion: string,
  sourceCatalogDigest: string,
  normalizedAbilityText: string,
  reason: DuelTemporaryV1UnknownReason,
): DuelTemporaryV1Unknown {
  return freezeDeep({
    status: "unknown",
    kind: DUEL_TEMPORARY_DESCRIPTION_V1_KIND,
    cardId,
    canonicalCardId,
    dataVersion,
    sourceCatalogDigest,
    normalizedAbilityText,
    reason,
  });
}

/**
 * Describe one printing's whole-ability Unit `[Temporary]`, or report `unknown`.
 *
 * The envelope and the printing tuple are snapshotted through own data
 * descriptors (no getter is invoked, no caller field is trusted); a caller
 * supplied fingerprint is never read. A recognised description binds the
 * printing's `id` / `canonicalCardId` / normalized ability text, the whole
 * printed tuple (`energy` / `power` / `might` / `domains` / `tags`), the envelope
 * `dataVersion` / `sourceCatalogDigest`, and a recomputed whole-source
 * fingerprint. It returns DATA only.
 */
export function describeDuelTemporaryV1(envelope: DuelTemporaryV1Envelope): DuelTemporaryV1Description {
  const envSnapshot = snapshotValue(envelope, "envelope", new Set<object>(), ENVELOPE_FIELD_SET);
  assertEnvelopeSnapshot(envSnapshot, "envelope");
  const cardSnapshot = envSnapshot.card;
  assertCardSnapshot(cardSnapshot, "card");

  const dataVersion = envSnapshot.dataVersion as string;
  const sourceCatalogDigest = envSnapshot.sourceCatalogDigest as string;
  const cardId = cardSnapshot.id as string;
  const canonicalCardId = cardSnapshot.canonicalCardId as string;
  const normalized = normalizeAbilityText(cardSnapshot.ability as string | null | undefined);

  if (cardSnapshot.cardType !== "Unit") {
    return makeUnknown(cardId, canonicalCardId, dataVersion, sourceCatalogDigest, normalized, "not-unit");
  }

  const reminderBody = TEMPORARY_WHOLE_TEXT_TO_BODY.get(normalized);
  if (reminderBody === undefined) {
    // A structurally single `[Temporary] (...)` ability whose body is NOT one of
    // the two observed self-relative reminders is a reminder mismatch. Anything
    // else (a bare keyword, another keyword, a compound/extra sentence, a
    // prefix-only match) is simply not a pure whole-ability Temporary.
    const reason: DuelTemporaryV1UnknownReason = PURE_TEMPORARY_SINGLE_ABILITY.test(normalized)
      ? "temporary-reminder-mismatch"
      : "ability-not-pure-temporary";
    return makeUnknown(cardId, canonicalCardId, dataVersion, sourceCatalogDigest, normalized, reason);
  }

  const energy = cardSnapshot.energy as number | null;
  const power = cardSnapshot.power as number | null;
  const might = cardSnapshot.might as number | null;
  const domains = [...(cardSnapshot.domains as readonly string[])];
  const tags = [...(cardSnapshot.tags as readonly string[])];
  const tokenDefinition = tags.includes("Token");

  return freezeDeep({
    status: "known" as const,
    kind: DUEL_TEMPORARY_DESCRIPTION_V1_KIND,
    cardId,
    canonicalCardId,
    dataVersion,
    sourceCatalogDigest,
    sourceFingerprint: {
      cardId,
      cardType: cardSnapshot.cardType as string,
      normalizedAbilityText: normalized,
      energy,
      power,
      might,
      domains,
      tags,
      canonicalCardId,
      name: cardSnapshot.name as string,
      fullName: cardSnapshot.fullName as string,
      localizedName: cardSnapshot.localizedName as string,
      setCode: cardSnapshot.setCode as string,
      cardNumber: cardSnapshot.cardNumber as string,
      variant: cardSnapshot.variant as string,
      dataVersion,
      sourceCatalogDigest,
    },
    printing: {
      kind: tokenDefinition ? "token-definition" : "physical-printing",
      tokenDefinition,
      grantsPlayFromHand: false,
    },
    source: {
      normalizedAbilityText: normalized,
      energy,
      power,
      might,
      domains,
      tags,
    },
    semantics: {
      kind: "temporary",
      abilityKind: "triggered-ability-keyword",
      reminderBody,
      redundantIfMultiple: true,
      trigger: {
        kind: "beginning-phase-start",
        controllerRelative: "controller",
        ordering: "before-scoring",
      },
      effect: {
        kind: "kill",
        subject: "self",
      },
    },
  });
}
