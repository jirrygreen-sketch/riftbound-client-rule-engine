/**
 * Pure-DATA recogniser for the whole-ability Legend Beginning-Phase conditional
 * draw (schema `beginning-draw-description-v1`), CR v1.4.
 *
 * Boundary (read this first):
 *
 *   - This is a STRICT, TEXT-MATCHING DATA DESCRIPTOR. It recognises one whole
 *     ability shape and returns a frozen, source-bound description. It is NOT an
 *     authority, NOT a SourceProgramClosure, NOT an executable card program, and
 *     it is NOT registered in the official-program registry (`official-programs.ts`).
 *   - It never mints capabilities: the result carries no `privateUID`, no
 *     per-printing epoch, no mint receipt, no `sourceProof` flag, no encoded
 *     executable reference and no Core/EffectIR wiring. A caller must not treat
 *     the returned object as a licence to draw a card.
 *   - It never executes the draw, never reads a hand, and never exposes private
 *     hand information. The only hand fact it records is the PUBLIC hand SIZE
 *     comparison (`<= 1`), which CR v1.4 108.7.e makes public information.
 *   - Only the COMPLETE whole ability is recognised, matched as an exact anchored
 *     literal (never a prefix, never a substring). Any extra instruction, a
 *     second sentence, a different turn-start wording, a different comparison or
 *     an unknown tail makes the printing `unknown`.
 *   - `unknown` NEVER degrades to a blank program, a no-ability template, a
 *     default draw 1, or a trigger-time condition.
 *
 * CR v1.4 evidence (all rule facts; nothing from a post-2026-10-16 ruleset):
 *
 *   - 383.1 / 383.2.a: the trigger Condition is the "At <point in time>" clause,
 *     i.e. "At start of your Beginning Phase".
 *   - 315.2 / 315.2.a.1: the Beginning Phase (Beginning Step) is the turn-sequence
 *     point at which Beginning-Phase game effects take place.
 *   - 383.2.a.1 (which NAMES this exact Loose Cannon ability): a conditional
 *     statement that is NOT immediately after the Condition is part of the EFFECT,
 *     not the Condition. So "if you have one or fewer cards in your hand" is an
 *     EFFECT clause, NOT a trigger predicate.
 *   - 383.2.b / 135.2.b.6: the Effect is the Instructions that are not part of the
 *     Condition.
 *   - 108.7.c / 108.7.e: hand cards are Private Information, but the NUMBER of
 *     cards in a hand is Public Information.
 *   - 190.6.d: an implied "you" in instructions like "draw 1" refers to the
 *     controller.
 *   - 191.4.a / 191.4.a.1: an Ability's controller is its Source's controller; if
 *     the Source is in a non-Board Zone (the Legend Zone), it is the Owner.
 *
 * UNCLOSED (stated explicitly, never defaulted):
 *
 *   - WHEN the effect-embedded "if" is evaluated is NOT directly fixed by any
 *     local CR v1.4 rule. Candidate rules (135.2.b.3 no-timing => during
 *     resolution; 359.3.f.2 referents checked on execution; 383.2.c the Condition,
 *     not the effect, is evaluated after the inciting event) are recorded, but the
 *     descriptor does NOT assume that trigger-time equals resolution-time. It marks
 *     the evaluation time `unclosed` and `evaluatedAtClosed: false`.
 *   - The precise draw OWNER beyond "the ability's controller" and any target are
 *     left as recorded source facts only; no runtime owner/target resolution is
 *     claimed.
 */

import { normalizeAbilityText } from "./ability-bindings.js";
import type { DuelSourcePrintingCard } from "./official-programs.js";

/**
 * The upstream source-envelope metadata for one catalog, passed SEPARATELY from
 * the per-printing tuple exactly as the verified loader does (the printing does
 * not carry a per-card dataVersion). Both fields must be non-empty strings; they
 * are copied verbatim onto the binding and are NEVER treated as proof of
 * authenticity — this descriptor does not re-verify the catalog digest.
 */
export interface DuelBeginningDrawSourceEnvelope {
  readonly dataVersion: string;
  readonly sourceCatalogDigest: string;
}

/** Fixed schema kind of a recognised Beginning-Phase conditional-draw description. */
export const DUEL_BEGINNING_DRAW_DESCRIPTION_V1_KIND = "beginning-draw-description-v1" as const;

/**
 * The exact, single whole-ability literal observed in the real catalog for this
 * family (3 printings of Loose Cannon). There is no variable slot: any deviation
 * is `unknown`. Matched as an anchored literal, never as a prefix or substring.
 */
export const DUEL_BEGINNING_DRAW_WHOLE_TEXT =
  "At start of your Beginning Phase, draw 1 if you have one or fewer cards in your hand." as const;

/** The only card type this descriptor recognises. */
export const DUEL_BEGINNING_DRAW_CARD_TYPE = "Legend" as const;

/** The trigger event: the start of the controlling player's Beginning Phase. */
export const DUEL_BEGINNING_DRAW_TRIGGER_EVENT = "beginning-phase" as const;

/** The rule layer this hand-size clause belongs to (CR 383.2.a.1: the Effect). */
export const DUEL_BEGINNING_DRAW_CONDITION_CLAUSE_ROLE = "effect" as const;

/** Rule that fixes the clause role (it explicitly names this ability). */
export const DUEL_BEGINNING_DRAW_CONDITION_ROLE_SOURCE_RULE = "CR-v1.4:383.2.a.1" as const;

/**
 * The evaluation time of the effect-embedded "if". No local CR v1.4 rule directly
 * fixes it, so it stays `unclosed` rather than being defaulted to trigger or
 * resolution time.
 */
export const DUEL_BEGINNING_DRAW_CONDITION_EVALUATED_AT = "unclosed" as const;

/**
 * Candidate local CR v1.4 rules that bear on the evaluation time but do NOT, on
 * their own, close it. Recorded verbatim so a reviewer can re-derive the gap.
 */
export const DUEL_BEGINNING_DRAW_CONDITION_EVALUATION_EVIDENCE_RULES = Object.freeze([
  "CR-v1.4:383.2.a.1", // clause is part of the effect, not the Trigger Condition.
  "CR-v1.4:135.2.b.3", // an instruction with no timing executes during resolution.
  "CR-v1.4:359.3.f.2", // information referenced in an instruction is checked on execution.
  "CR-v1.4:383.2.c", // the Trigger's CONDITION is evaluated after the inciting event.
] as const);

/** Why a printing is not recognised as a known Beginning-Phase conditional draw. */
export type DuelBeginningDrawV1UnknownReason =
  | "not-legend"
  | "empty-source-text"
  | "ability-not-pure-beginning-draw"
  | "unmodeled-printing-stat";

/** The fixed trigger Condition (CR 383.1 / 383.2.a), DATA only. */
export interface DuelBeginningDrawV1Trigger {
  readonly event: typeof DUEL_BEGINNING_DRAW_TRIGGER_EVENT;
  readonly step: "beginning-step";
  readonly scope: "controller-beginning-phase";
  readonly timing: "start";
  readonly sourceRule: "CR-v1.4:383.1";
}

/** The effect-embedded conditional (CR 383.2.a.1), DATA only. */
export interface DuelBeginningDrawV1Condition {
  readonly kind: "hand-size-at-most";
  readonly maximum: 1;
  readonly scope: "ability-controller-hand";
  /** CR 383.2.a.1: the clause is part of the Effect, not the Trigger Condition. */
  readonly clauseRole: typeof DUEL_BEGINNING_DRAW_CONDITION_CLAUSE_ROLE;
  readonly roleSourceRule: typeof DUEL_BEGINNING_DRAW_CONDITION_ROLE_SOURCE_RULE;
  /** Public-information fact (CR 108.7.e); never the private hand contents. */
  readonly readsPublicInformationOnly: true;
  /** UNCLOSED: no local CR rule directly fixes the evaluation time. */
  readonly evaluatedAt: typeof DUEL_BEGINNING_DRAW_CONDITION_EVALUATED_AT;
  readonly evaluatedAtClosed: false;
  readonly evaluatedAtEvidenceRules: typeof DUEL_BEGINNING_DRAW_CONDITION_EVALUATION_EVIDENCE_RULES;
}

/** The conditional draw effect (DATA only; no executor is wired). */
export interface DuelBeginningDrawV1Effect {
  readonly kind: "draw-cards";
  readonly amount: 1;
  readonly recipient: "ability-controller";
  readonly recipientSourceRule: "CR-v1.4:190.6.d";
  readonly condition: DuelBeginningDrawV1Condition;
}

export interface DuelBeginningDrawV1Semantics {
  readonly kind: "beginning-phase-conditional-draw";
  readonly trigger: DuelBeginningDrawV1Trigger;
  readonly effect: DuelBeginningDrawV1Effect;
}

/** Source-bound printing projection carried onto a known result. */
export interface DuelBeginningDrawV1Source {
  readonly normalizedAbilityText: string;
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
}

/**
 * The whole-source binding. `fingerprint` is RECOMPUTED by this descriptor over
 * the complete source tuple (never accepted from the caller), so it is a drift
 * detector, NOT an authority and NOT a cryptographic attestation.
 */
export interface DuelBeginningDrawV1SourceBinding {
  readonly dataVersion: string;
  readonly sourceCatalogDigest: string;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly fingerprintScheme: "fnv1a64";
  readonly wholeSourceFingerprint: string;
}

export interface DuelBeginningDrawV1Known {
  readonly status: "known";
  readonly kind: typeof DUEL_BEGINNING_DRAW_DESCRIPTION_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly source: DuelBeginningDrawV1Source;
  readonly binding: DuelBeginningDrawV1SourceBinding;
  readonly semantics: DuelBeginningDrawV1Semantics;
}

export interface DuelBeginningDrawV1Unknown {
  readonly status: "unknown";
  readonly kind: typeof DUEL_BEGINNING_DRAW_DESCRIPTION_V1_KIND;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly normalizedAbilityText: string;
  readonly reason: DuelBeginningDrawV1UnknownReason;
}

export type DuelBeginningDrawV1Description = DuelBeginningDrawV1Known | DuelBeginningDrawV1Unknown;

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

/** Fingerprint order: the whole source tuple, canonicalised deterministically. */
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new TypeError(`Duel beginning draw: ${label} must be an object.`);
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
    throw new TypeError(`Duel beginning draw: ${label} must be acyclic data.`);
  }
  const array = Array.isArray(raw);
  const prototype = Object.getPrototypeOf(raw);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Duel beginning draw: ${label} must be ordinary data.`);
  }
  ancestors.add(raw);
  try {
    const keys = Reflect.ownKeys(raw);
    if (array) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(raw, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor) ||
          !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
          keys.length !== lengthDescriptor.value + 1 || !keys.includes("length")) {
        throw new TypeError(`Duel beginning draw: ${label} must be a dense array.`);
      }
      const output: unknown[] = [];
      for (let index = 0; index < lengthDescriptor.value; index++) {
        const item = Object.getOwnPropertyDescriptor(raw, String(index));
        if (!item || !("value" in item) || !item.enumerable) {
          throw new TypeError(`Duel beginning draw: ${label}[${index}] must be an own data property.`);
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
        throw new TypeError(`Duel beginning draw: ${label} requires enumerable own data fields.`);
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
    throw new TypeError(`Duel beginning draw: ${label} must be a non-empty string.`);
  }
}

function assertNullableSafeInteger(value: unknown, label: string): asserts value is number | null {
  if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError(`Duel beginning draw: ${label} must be a nonnegative integer or null.`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`Duel beginning draw: ${label} must be an ordinary array.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string" ||
      (key !== "length" && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))) {
    throw new TypeError(`Duel beginning draw: ${label} must have exactly its dense indices and length.`);
  }
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      throw new TypeError(`Duel beginning draw: ${label} must contain non-empty strings.`);
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
      throw new TypeError(`Duel beginning draw: ${label} requires enumerable own data fields.`);
    }
  }
  for (const key of CARD_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`Duel beginning draw: ${label}.${key} is required.`);
    }
  }
  assertNonEmptyString(value.id, `${label}.id`);
  assertNonEmptyString(value.cardType, `${label}.cardType`);
  if (value.ability !== null && value.ability !== undefined && typeof value.ability !== "string") {
    throw new TypeError(`Duel beginning draw: ${label}.ability must be a string, null or undefined.`);
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

function snapshotEnvelope(raw: unknown): DuelBeginningDrawSourceEnvelope {
  assertObject(raw, "source");
  const keys = Reflect.ownKeys(raw);
  for (const key of keys) {
    const item = Object.getOwnPropertyDescriptor(raw, key);
    if (typeof key !== "string" || !item || !("value" in item) || !item.enumerable) {
      throw new TypeError("Duel beginning draw: source requires enumerable own data fields.");
    }
  }
  assertNonEmptyString(raw.dataVersion, "source.dataVersion");
  assertNonEmptyString(raw.sourceCatalogDigest, "source.sourceCatalogDigest");
  return { dataVersion: raw.dataVersion, sourceCatalogDigest: raw.sourceCatalogDigest };
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

// --- Whole-source fingerprint (recomputed here; never accepted from a caller) --

function canonicalFingerprintJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalFingerprintJson).join(",")}]`;
  const objectValue = value as Record<string, unknown>;
  const entries = Object.keys(objectValue).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalFingerprintJson(objectValue[key])}`);
  return `{${entries.join(",")}}`;
}

/**
 * Whole-source FNV-1a-64 over the canonicalised COMPLETE source tuple. The ability
 * slot uses the shared `normalizeAbilityText` form (the same form the source
 * binding exposes), so CRLF / edge-whitespace-equivalent printings of the same
 * literal fingerprint identically; every other tuple field is used verbatim. This
 * is a deterministic drift detector, not a cryptographic digest and not an authority.
 */
function wholeSourceFingerprint(
  snapshot: Record<string, unknown>,
  normalizedAbilityText: string,
  envelope: DuelBeginningDrawSourceEnvelope,
): string {
  const material: Record<string, unknown> = {};
  for (const key of FINGERPRINT_FIELDS) {
    material[key] = key === "ability" ? normalizedAbilityText : snapshot[key];
  }
  // The upstream envelope metadata is part of the whole-source binding.
  material.dataVersion = envelope.dataVersion;
  material.sourceCatalogDigest = envelope.sourceCatalogDigest;
  const bytes = new TextEncoder().encode(canonicalFingerprintJson(material));
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

// --- Recognition --------------------------------------------------------------

function makeUnknown(
  cardId: string,
  canonicalCardId: string,
  normalizedAbilityText: string,
  reason: DuelBeginningDrawV1UnknownReason,
): DuelBeginningDrawV1Unknown {
  return freezeDeep({
    status: "unknown",
    kind: DUEL_BEGINNING_DRAW_DESCRIPTION_V1_KIND,
    cardId,
    canonicalCardId,
    normalizedAbilityText,
    reason,
  });
}

/**
 * Describe one printing's whole-ability Legend Beginning-Phase conditional draw,
 * or report `unknown`.
 *
 * The printing tuple and the separate source-envelope metadata are both snapshotted
 * through own data descriptors (no getter is invoked). A recognised description
 * binds the printing's `id` / `canonicalCardId` / normalized ability text, the
 * whole printed tuple (`energy` / `power` / `might` / `domains` / `tags`), the
 * envelope `dataVersion` / `sourceCatalogDigest` and a RECOMPUTED whole-source
 * fingerprint. A caller-supplied fingerprint or proof field is never read or
 * trusted; passing the wrong envelope only makes the result `not-legend`/`unknown`
 * at worst, never authoritative.
 */
export function describeDuelBeginningDrawV1(
  card: DuelSourcePrintingCard,
  envelopeSource: DuelBeginningDrawSourceEnvelope,
): DuelBeginningDrawV1Description {
  const envelope = snapshotEnvelope(envelopeSource);
  const snapshot = snapshotCard(card, "card", new Set<object>(), CARD_FIELD_SET);
  assertCardSnapshot(snapshot, "card");
  const cardId = snapshot.id as string;
  const canonicalCardId = snapshot.canonicalCardId as string;
  const normalized = normalizeAbilityText(snapshot.ability as string | null | undefined);

  if (snapshot.cardType !== DUEL_BEGINNING_DRAW_CARD_TYPE) {
    return makeUnknown(cardId, canonicalCardId, normalized, "not-legend");
  }

  if (normalized.length === 0) {
    return makeUnknown(cardId, canonicalCardId, normalized, "empty-source-text");
  }

  if (normalized !== DUEL_BEGINNING_DRAW_WHOLE_TEXT) {
    return makeUnknown(cardId, canonicalCardId, normalized, "ability-not-pure-beginning-draw");
  }

  // A Legend carries no printed Energy / Power / Might. A non-null stat on a
  // Legend is an unmodeled field shape; refuse to fold it into a known result.
  const energy = snapshot.energy as number | null;
  const power = snapshot.power as number | null;
  const might = snapshot.might as number | null;
  if (energy !== null || power !== null || might !== null) {
    return makeUnknown(cardId, canonicalCardId, normalized, "unmodeled-printing-stat");
  }

  const domains = [...(snapshot.domains as readonly string[])];
  const tags = [...(snapshot.tags as readonly string[])];

  return freezeDeep({
    status: "known" as const,
    kind: DUEL_BEGINNING_DRAW_DESCRIPTION_V1_KIND,
    cardId,
    canonicalCardId,
    source: {
      normalizedAbilityText: normalized,
      energy,
      power,
      might,
      domains,
      tags,
    },
    binding: {
      dataVersion: envelope.dataVersion,
      sourceCatalogDigest: envelope.sourceCatalogDigest,
      cardId,
      canonicalCardId,
      fingerprintScheme: "fnv1a64" as const,
      wholeSourceFingerprint: wholeSourceFingerprint(snapshot, normalized, envelope),
    },
    semantics: {
      kind: "beginning-phase-conditional-draw" as const,
      trigger: {
        event: DUEL_BEGINNING_DRAW_TRIGGER_EVENT,
        step: "beginning-step" as const,
        scope: "controller-beginning-phase" as const,
        timing: "start" as const,
        sourceRule: "CR-v1.4:383.1" as const,
      },
      effect: {
        kind: "draw-cards" as const,
        amount: 1 as const,
        recipient: "ability-controller" as const,
        recipientSourceRule: "CR-v1.4:190.6.d" as const,
        condition: {
          kind: "hand-size-at-most" as const,
          maximum: 1 as const,
          scope: "ability-controller-hand" as const,
          clauseRole: DUEL_BEGINNING_DRAW_CONDITION_CLAUSE_ROLE,
          roleSourceRule: DUEL_BEGINNING_DRAW_CONDITION_ROLE_SOURCE_RULE,
          readsPublicInformationOnly: true as const,
          evaluatedAt: DUEL_BEGINNING_DRAW_CONDITION_EVALUATED_AT,
          evaluatedAtClosed: false as const,
          evaluatedAtEvidenceRules: DUEL_BEGINNING_DRAW_CONDITION_EVALUATION_EVIDENCE_RULES,
        },
      },
    },
  });
}
