/**
 * Source-bound static-ability binding for the two fixed official ability texts
 * decided by the parent:
 *
 *   - `[Ganking] (I can move from battlefield to battlefield.)`
 *     CR v1.4 810 (Ganking, Passive Ability keyword) + CR v1.4 144.4.c
 *     (Ganking affects a Unit's Standard Move: Battlefield -> Battlefield).
 *     CR 810.1.a  "It is present on Units."
 *     CR 810.1.b  functionally short for "I may move to a battlefield from another
 *                 battlefield with a standard move."
 *     CR 810.1.c  passive ability that adds permissions to the Unit's Standard Move.
 *     CR 810.2    multiple instances of Ganking are redundant.
 *
 *   - `I enter ready.`
 *     CR v1.4 143.4 (Units enter the Board exhausted) altered by a replacement
 *     effect; CR 364.3.a example: "I enter ready." and the CR 143.4.a note about
 *     Accelerate / similar effects.
 *
 * MECHANICAL METADATA BINDING ONLY. This module does not decide rules semantics,
 * does not implement movement, readying, costs, or payment, and is NOT an
 * executable ability loader. It recognizes the exact literal texts above (and
 * only those) on Unit printings and reports the recognised fragments plus a
 * `fullyBound` flag. It is NOT an English natural-language ability compiler and
 * it does NOT generalize to other keyword/effect texts.
 *
 * The literals are NOT invented. They are the real official card texts observed
 * in `packages/card-data/data/deck-catalog.json`, and they are the exact reminder
 * text consistent with CR 810 / 144.4.c.
 *
 * ## Source binding and its honest limits
 *
 * Bindings may ONLY be obtained through the exported entry points
 * (`bindPrintingAbility`, `bindAbilityRegistry`, `bindAbilityByCardId`), and those
 * entry points verify that a supplied card matches a TRUSTED source record: its id
 * must occur exactly once in `source.cards`, its raw `cardType` must equal the
 * source record's `cardType`, and its normalized ability text must equal the
 * source record's normalized ability text. A forged card that reuses a real id, a
 * real type or a real text without the matching source tuple is rejected with a
 * `TypeError`; object identity is never required, so a genuine value clone with
 * the same id/type/normalized text still binds.
 *
 * `dataVersion` and `sourceCatalogDigest` are required to be non-empty strings and
 * are copied verbatim onto every binding. IMPORTANT: this projection does NOT
 * cryptographically re-verify the catalog digest. It carries no complete
 * card/group set from which the upstream catalog digest could be recomputed, so
 * the digest is only transport metadata here. Digest authenticity remains the
 * responsibility of the UPSTREAM verified-catalog layer; a caller must not treat
 * `sourceCatalogDigest` as proof of a verified catalog. Client supplied ability
 * strings or raw booleans are never authoritative input.
 */

/** Exact official Ganking text (keyword tag + CR-consistent reminder). */
export const GANKING_REMINDER_TEXT = '[Ganking] (I can move from battlefield to battlefield.)';

/** Exact official self-enter-ready text (whole statement, no condition). */
export const ENTER_READY_TEXT = 'I enter ready.';

export type StaticAbilityKind = 'ganking' | 'enter-ready';

/** Recognised static-ability fragment. Only these two kinds exist. */
export interface StaticAbilityBinding {
  readonly kind: StaticAbilityKind;
}

/** Trusted catalog card projection (server side). Extra catalog fields are ignored. */
export interface AbilitySourceCard {
  readonly id: string;
  /** Literal string, deliberately not an enum. */
  readonly cardType: string;
  readonly ability: string | null | undefined;
}

export interface AbilitySource {
  /** Non-empty string; carried verbatim, not cryptographically re-verified here. */
  readonly dataVersion: string;
  /** Non-empty string; carried verbatim, not cryptographically re-verified here. */
  readonly sourceCatalogDigest: string;
  readonly cards: readonly AbilitySourceCard[];
}

/**
 * One binding per printing. `staticAbilities` holds only recognised fixed-text
 * fragments; `fullyBound` is the ONLY signal a caller may use to treat the whole
 * card ability as bound. A non-`fullyBound` binding is an UNKNOWN card ability.
 */
export interface PrintingAbilityBinding {
  readonly cardId: string;
  readonly sourceDataVersion: string;
  readonly sourceCatalogDigest: string;
  readonly normalizedAbilityText: string;
  readonly staticAbilities: readonly StaticAbilityBinding[];
  readonly unresolvedText: string | null;
  readonly fullyBound: boolean;
}

/** Cloned-on-read registry facade; never exposes the internal binding objects. */
export interface AbilityRegistry {
  readonly size: number;
  get(cardId: string): PrintingAbilityBinding | undefined;
  has(cardId: string): boolean;
  cardIds(): readonly string[];
}

/**
 * Stable, semantics-preserving normalization: line-ending unification, per-line
 * trimming of leading/trailing horizontal whitespace, and dropping of
 * whitespace-only edge lines. INTERNAL spacing, line breaks and punctuation are
 * NEVER collapsed, merged or stripped, because that could change the meaning of
 * an ability statement.
 */
export function normalizeAbilityText(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string') {
    throw new TypeError('Ability binding: ability text must be a string, null or undefined.');
  }
  const lines = raw.replace(/\r\n?/gu, '\n').split('\n').map((line) => line.replace(/^[ \t]+|[ \t]+$/gu, ''));
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') start += 1;
  while (end > start && lines[end - 1] === '') end -= 1;
  return lines.slice(start, end).join('\n');
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Ability binding: ${label} must be a non-empty string.`);
  }
}

/**
 * Guards the trusted-source envelope. Only a non-empty `dataVersion` and a
 * non-empty `sourceCatalogDigest` plus a `cards` array are accepted. This makes
 * no claim that the digest is authentic — that is the upstream verified-catalog
 * layer's job; here the values are merely required to be present.
 */
function assertSourceEnvelope(source: AbilitySource): void {
  if (source === null || typeof source !== 'object') {
    throw new TypeError('Ability binding: source must be an object.');
  }
  assertNonEmptyString(source.dataVersion, 'source.dataVersion');
  assertNonEmptyString(source.sourceCatalogDigest, 'source.sourceCatalogDigest');
  if (!Array.isArray(source.cards)) {
    throw new TypeError('Ability binding: source.cards must be an array.');
  }
}

/**
 * Indexes a trusted source, rejecting duplicate or empty printing ids. Used once
 * per registry/batch call so the per-card work stays O(1) (no O(n^2) scan).
 */
function indexTrustedCards(source: AbilitySource): Map<string, AbilitySourceCard> {
  const index = new Map<string, AbilitySourceCard>();
  for (const entry of source.cards) {
    if (entry === null || typeof entry !== 'object') {
      throw new TypeError('Ability binding: every source card must be an object.');
    }
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new TypeError('Ability binding: every source card must have a non-empty string id.');
    }
    if (index.has(entry.id)) {
      throw new TypeError(`Ability binding: duplicate printing id "${entry.id}".`);
    }
    index.set(entry.id, entry);
  }
  return index;
}

interface ParsedSegments {
  readonly staticAbilities: StaticAbilityBinding[];
  readonly unresolvedText: string | null;
  readonly fullyBound: boolean;
}

/**
 * Recognises the exact fixed literals only.
 *
 * - Ganking must be an exact PREFIX of the text: either the whole text, or the
 *   literal followed immediately by a newline.
 * - `I enter ready.` must be the exact WHOLE remaining statement (i.e. the whole
 *   text, or the whole text left after the Ganking prefix). `I enter ready if ...`
 *   / `Other units enter ready.` / `Your units enter ready.` never match.
 * - Any other ability body stays in `unresolvedText` and clears `fullyBound`.
 */
function parseStaticSegments(text: string): ParsedSegments {
  const staticAbilities: StaticAbilityBinding[] = [];
  let rest = text;

  if (rest.startsWith(GANKING_REMINDER_TEXT)) {
    const after = rest.slice(GANKING_REMINDER_TEXT.length);
    if (after === '' || after.startsWith('\n')) {
      staticAbilities.push({ kind: 'ganking' });
      rest = after === '' ? '' : after.slice(1);
    }
  }

  if (rest === ENTER_READY_TEXT) {
    staticAbilities.push({ kind: 'enter-ready' });
    rest = '';
  }

  const fullyBound = rest === '' && staticAbilities.length > 0;
  return { staticAbilities, unresolvedText: rest === '' ? null : rest, fullyBound };
}

/**
 * Private binding kernel. It assumes the caller has ALREADY established that
 * `card` is the (unique) trusted source record for its id — the registry path
 * supplies the record straight from the indexed source, and the public entry
 * performs the tuple check first. Never exported, so it cannot become a forgery
 * bypass.
 */
function bindTrustedCard(source: AbilitySource, card: AbilitySourceCard): PrintingAbilityBinding {
  const normalizedAbilityText = normalizeAbilityText(card.ability);
  const parsed: ParsedSegments =
    card.cardType === 'Unit'
      ? parseStaticSegments(normalizedAbilityText)
      : {
          staticAbilities: [],
          unresolvedText: normalizedAbilityText === '' ? null : normalizedAbilityText,
          fullyBound: false,
        };

  return {
    cardId: card.id,
    sourceDataVersion: source.dataVersion,
    sourceCatalogDigest: source.sourceCatalogDigest,
    normalizedAbilityText,
    staticAbilities: parsed.staticAbilities.map((segment) => ({ kind: segment.kind })),
    unresolvedText: parsed.unresolvedText,
    fullyBound: parsed.fullyBound,
  };
}

/**
 * Binds one printing THROUGH the trusted source. The supplied `card` is only a
 * claim: its id must occur exactly once in `source.cards`, its raw `cardType`
 * must equal the source record's `cardType`, and its normalized ability text must
 * equal the source record's normalized ability text. Otherwise a `TypeError` is
 * thrown and nothing is bound — a real id cannot be re-pointed at forged text.
 *
 * Never mutates the input. Returns a fresh object with a fresh `staticAbilities`
 * array on every call. Object identity is irrelevant: a genuine value clone with
 * the same id/type/normalized text binds normally.
 *
 * Only `Unit` printings are eligible. A Spell / Legend / Gear / Battlefield card
 * whose text happens to mention Ganking (a granted keyword or a Battlefield-wide
 * grant) is recorded as UNKNOWN, never bound: CR 810.1.a "It is present on Units."
 */
export function bindPrintingAbility(source: AbilitySource, card: AbilitySourceCard): PrintingAbilityBinding {
  assertSourceEnvelope(source);
  if (card === null || typeof card !== 'object') {
    throw new TypeError('Ability binding: card must be an object.');
  }
  let matched: AbilitySourceCard | undefined;
  let occurrences = 0;
  for (const entry of source.cards) {
    if (entry.id === card.id) {
      occurrences += 1;
      matched = entry;
    }
  }
  if (occurrences === 0) {
    throw new TypeError(`Ability binding: card "${card.id}" is not present in the trusted source.`);
  }
  if (occurrences > 1) {
    throw new TypeError(`Ability binding: duplicate printing id "${card.id}" in the trusted source.`);
  }
  const sourceCard = matched as AbilitySourceCard;
  if (sourceCard.cardType !== card.cardType) {
    throw new TypeError(
      `Ability binding: card "${card.id}" cardType "${card.cardType}" does not match the trusted source "${sourceCard.cardType}".`,
    );
  }
  if (normalizeAbilityText(sourceCard.ability) !== normalizeAbilityText(card.ability)) {
    throw new TypeError(`Ability binding: card "${card.id}" ability text does not match the trusted source.`);
  }
  return bindTrustedCard(source, sourceCard);
}

const cloneBinding = (binding: PrintingAbilityBinding): PrintingAbilityBinding => ({
  cardId: binding.cardId,
  sourceDataVersion: binding.sourceDataVersion,
  sourceCatalogDigest: binding.sourceCatalogDigest,
  normalizedAbilityText: binding.normalizedAbilityText,
  staticAbilities: binding.staticAbilities.map((segment) => ({ kind: segment.kind })),
  unresolvedText: binding.unresolvedText,
  fullyBound: binding.fullyBound,
});

/**
 * Keyed by printing id (`card.id`), in input order. Every printing gets exactly
 * one binding; unbound printings are recorded as `fullyBound: false`, so the
 * caller can keep a complete unknown census. Duplicate or empty printing ids and
 * empty source metadata are rejected (no silent partial registry).
 *
 * The source is indexed once, so this is a single O(n) pass, not an O(n^2) scan.
 */
export function bindAbilityRegistry(source: AbilitySource): AbilityRegistry {
  assertSourceEnvelope(source);
  const index = indexTrustedCards(source);
  const bindings = new Map<string, PrintingAbilityBinding>();
  for (const card of source.cards) {
    const trusted = index.get(card.id) as AbilitySourceCard;
    bindings.set(trusted.id, bindTrustedCard(source, trusted));
  }
  const order = [...bindings.keys()];
  return {
    get size(): number {
      return bindings.size;
    },
    get(cardId: string): PrintingAbilityBinding | undefined {
      const stored = bindings.get(cardId);
      return stored === undefined ? undefined : cloneBinding(stored);
    },
    has(cardId: string): boolean {
      return bindings.has(cardId);
    },
    cardIds(): readonly string[] {
      return [...order];
    },
  };
}

/**
 * Convenience: bind a single printing by its real printing id. Unlike a bare
 * `find`, a duplicated id in the source is NOT silently resolved to the first
 * occurrence — it throws a `TypeError` instead. An id absent from the source
 * returns `undefined`.
 */
export function bindAbilityByCardId(source: AbilitySource, cardId: string): PrintingAbilityBinding | undefined {
  assertSourceEnvelope(source);
  if (typeof cardId !== 'string' || cardId.length === 0) return undefined;
  let matched: AbilitySourceCard | undefined;
  let occurrences = 0;
  for (const entry of source.cards) {
    if (entry.id === cardId) {
      occurrences += 1;
      matched = entry;
    }
  }
  if (occurrences === 0) return undefined;
  if (occurrences > 1) {
    throw new TypeError(`Ability binding: duplicate printing id "${cardId}" in the trusted source.`);
  }
  return bindTrustedCard(source, matched as AbilitySourceCard);
}

/** Build a trusted source from a real server catalog projection (extra fields ignored). */
export function abilitySourceFromCatalog(catalog: {
  readonly dataVersion: string;
  readonly digest: string;
  readonly cards: readonly AbilitySourceCard[];
}): AbilitySource {
  if (catalog === null || typeof catalog !== 'object') {
    throw new TypeError('Ability binding: catalog must be an object.');
  }
  assertNonEmptyString(catalog.dataVersion, 'catalog.dataVersion');
  assertNonEmptyString(catalog.digest, 'catalog.digest');
  if (!Array.isArray(catalog.cards)) {
    throw new TypeError('Ability binding: catalog.cards must be an array.');
  }
  return {
    dataVersion: catalog.dataVersion,
    sourceCatalogDigest: catalog.digest,
    cards: catalog.cards.map((card) => ({ id: card.id, cardType: card.cardType, ability: card.ability })),
  };
}
