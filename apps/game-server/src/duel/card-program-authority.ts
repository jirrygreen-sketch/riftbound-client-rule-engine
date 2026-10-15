/**
 * Server-local trust adapter: `CardCatalogRuntime` -> card-dsl opaque official
 * program registry.
 *
 * The direction is one way. This module projects the already-loaded public
 * catalog into the strict `DuelCatalogEnvelope` the hardened card-dsl registry
 * consumes, builds that opaque registry, and exposes the smallest surface a
 * later Core phase bridge needs:
 *
 * - the catalog stamp (`dataVersion`/`digest`) the authority is bound to,
 * - a printing census,
 * - a stable, detached resolved `cardId -> encoded reference` index, and
 * - a hardened `registry + cardId` source-program phase-scope query.
 *
 * Boundaries this file deliberately keeps:
 * - It never registers a program, injects an arbitrary `DuelAbilitySource`, or
 *   accepts a caller-supplied registry. Only `createCardProgramAuthority`, fed a
 *   real `CardCatalogRuntime`, can mint a queryable authority.
 * - The authority is identity-guarded: a spread/clone copy carries no authority
 *   state and cannot answer any query.
 * - Unknown printings never enter the resolved index and keep resolving to
 *   `unknown`; a resolved entry is identity only, never an executable program.
 * - It creates no `DuelPhaseRegistryV2`, sets no Core coverage flag, and makes
 *   no whole-phase readiness claim. `globalClosureStatus` stays `unverified`.
 * - Every input list (`cards`, `domains`, `tags`) is accepted only as an
 *   ordinary dense data-property array. A hole, an extra string key, a symbol
 *   key, an accessor, a non-canonical index or an exotic prototype fails closed
 *   instead of being spread-normalized into a plausible-looking array.
 */

import {
  createDuelAccelerateOfficialProgramRegistryV1,
  createDuelBeginningPhaseOfficialProgramRegistryV1,
  createDuelEquipBeginningOfficialProgramRegistryV1,
  createDuelEquipOfficialProgramRegistryV1,
  createDuelExtendedUnitOfficialProgramRegistryV1,
  createDuelFuryOptionalRosterOfficialProgramRegistryV1,
  createDuelPointDamageOfficialProgramRegistryV1,
  createDuelOfficialProgramRegistry,
  duelAbilitySourceFromCatalog,
  encodeDuelProgramReferenceRaw,
  type DuelCatalogEnvelope,
  type DuelAbilitySource,
  type DuelOfficialProgramRegistry,
  type DuelSourcePrintingCard,
  type DuelSourceProgramPhaseScopeContext,
  type DuelSourceProgramPhaseScopeResult,
} from "@riftbound/card-dsl/duel";
import type {
  CardCatalogRuntime,
  PublicCardCatalog,
} from "../card-catalog.js";

/** Raised for any catalog shape the adapter refuses to translate, rather than guess. */
export class CardProgramAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardProgramAuthorityError";
  }
}

/** The catalog stamp the authority resolved against; the resolved index is bound to it. */
export interface DuelCatalogStamp {
  readonly dataVersion: string;
  readonly digest: string;
}

export interface CardProgramAuthorityCensus {
  /** Printings projected into the envelope. */
  readonly catalogPrintings: number;
  /** Printings the hardened registry resolves to a source-local verified program. */
  readonly resolvedPrograms: number;
  /** Printings that stay explicitly unknown (never silently treated as no-effect). */
  readonly unresolvedPrintings: number;
}

/**
 * One resolved printing's stable identity. It intentionally carries no program,
 * no semantics and no execution permission; a resolved reference is not
 * executable, and by itself authorizes nothing.
 */
export interface ResolvedProgramReferenceEntry {
  readonly cardId: string;
  readonly programId: string;
  /** Canonical, detached encoding accepted by the card-dsl reference codec. */
  readonly encodedReference: string;
}

export interface CardProgramAuthority {
  readonly catalogStamp: DuelCatalogStamp;
  readonly census: CardProgramAuthorityCensus;
  /** Catalog-ordered, frozen resolved entries; unknown printings are absent. */
  resolvedProgramReferenceEntries(): readonly ResolvedProgramReferenceEntry[];
  /** Stable lookup into the same index, or `undefined` for unknown printings. */
  resolvedProgramReference(
    cardId: string
  ): ResolvedProgramReferenceEntry | undefined;
  /**
   * Hardened source-local phase scope for one indexed printing. Answers `unknown`
   * for anything the registry did not resolve; never a whole-phase proof.
   */
  sourceProgramPhaseScope(
    cardId: string,
    eventOrContext: string | DuelSourceProgramPhaseScopeContext
  ): DuelSourceProgramPhaseScopeResult;
}

interface AuthorityState {
  readonly registry: DuelOfficialProgramRegistry;
  readonly stamp: DuelCatalogStamp;
  readonly census: CardProgramAuthorityCensus;
  readonly entries: readonly ResolvedProgramReferenceEntry[];
  readonly entriesByCardId: ReadonlyMap<string, ResolvedProgramReferenceEntry>;
}

/**
 * Registry factories are fixed module-local capabilities. They are never part
 * of the public authority constructor, so callers cannot inject a registry,
 * profile string or enable flag that changes the reviewed DSL surface.
 */
type TrustedRegistryFactory = (
  source: DuelAbilitySource
) => DuelOfficialProgramRegistry;

const LEGACY_REGISTRY_FACTORY: TrustedRegistryFactory =
  createDuelOfficialProgramRegistry;
const ACCELERATE_REGISTRY_FACTORY: TrustedRegistryFactory =
  createDuelAccelerateOfficialProgramRegistryV1;
const EXTENDED_UNIT_REGISTRY_FACTORY: TrustedRegistryFactory =
  createDuelExtendedUnitOfficialProgramRegistryV1;
const FURY_OPTIONAL_ROSTER_REGISTRY_FACTORY: TrustedRegistryFactory =
  createDuelFuryOptionalRosterOfficialProgramRegistryV1;
const POINT_DAMAGE_REGISTRY_FACTORY: TrustedRegistryFactory =
  createDuelPointDamageOfficialProgramRegistryV1;
const EQUIP_REGISTRY_FACTORY: TrustedRegistryFactory =
  createDuelEquipOfficialProgramRegistryV1;
const BEGINNING_PHASE_REGISTRY_FACTORY: TrustedRegistryFactory =
  createDuelBeginningPhaseOfficialProgramRegistryV1;
const EQUIP_BEGINNING_REGISTRY_FACTORY: TrustedRegistryFactory =
  createDuelEquipBeginningOfficialProgramRegistryV1;

/**
 * Authority capability lives outside the returned object. A spread/clone copy is
 * a different identity and therefore cannot resolve back to its state.
 */
const AUTHORITY_STATE = new WeakMap<object, AuthorityState>();

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CardProgramAuthorityError(
      `Card program authority: ${path} must be a non-empty string.`
    );
  }
  return value;
}

function requireAbilityText(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new CardProgramAuthorityError(
      `Card program authority: ${path} must be a string.`
    );
  }
  return value;
}

function requireNullableStat(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new CardProgramAuthorityError(
      `Card program authority: ${path} must be null or a non-negative safe integer.`
    );
  }
  return value;
}

/** A canonical array index key: digits, no leading zero, no sign, no dot. */
const CANONICAL_INDEX_KEY = /^(0|[1-9][0-9]*)$/;

function failArrayShape(path: string, reason: string): never {
  throw new CardProgramAuthorityError(
    `Card program authority: ${path} must be an ordinary, dense, data-property array (${reason}).`
  );
}

/**
 * Fail-closed array gate. Spreading is a normalization step, not a validator:
 * `[...value]` invents `undefined` entries out of a sparse array's holes, drops
 * extra string keys and symbols, and honours an own `Symbol.iterator`, a
 * subclass prototype or an accessor instead of refusing the shape. This adapter
 * therefore never spreads an input array: it accepts only a plain dense array
 * of own data properties and detaches the values it reads from those very
 * descriptors, mirroring the hardened card-dsl `assertExactDenseArray` contract
 * on the server side rather than pre-sanitizing a malicious shape.
 */
function requirePlainDenseArray(
  value: unknown,
  path: string
): readonly unknown[] {
  if (!Array.isArray(value)) failArrayShape(path, "not an array");
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    failArrayShape(path, "exotic prototype or array subclass");
  }
  const length = value.length;
  const ownKeys = Reflect.ownKeys(value);
  // A plain dense array owns exactly its indices plus `length`; anything else is
  // an extra string key, a symbol key, a non-canonical index, or a hole.
  if (ownKeys.length !== length + 1) {
    failArrayShape(path, "not exactly its dense indices and length");
  }
  for (const key of ownKeys) {
    if (key === "length") continue;
    if (
      typeof key !== "string" ||
      !CANONICAL_INDEX_KEY.test(key) ||
      Number(key) >= length
    ) {
      failArrayShape(path, "an extra key, a symbol key or a non-canonical index");
    }
  }
  const items: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) {
      failArrayShape(path, `index ${index} is a hole or an accessor`);
    }
    // Read the validated data-property value itself, never the indexed lookup.
    items.push(descriptor.value);
  }
  return items;
}

function requireStringArray(value: unknown, path: string): readonly string[] {
  const items = requirePlainDenseArray(value, path);
  const result: string[] = [];
  for (const item of items) {
    if (typeof item !== "string" || item.length === 0) {
      throw new CardProgramAuthorityError(
        `Card program authority: ${path} must be an array of non-empty strings.`
      );
    }
    result.push(item);
  }
  return result;
}

/**
 * Detached, per-field projection of one public printing into the source tuple.
 * A missing `localizedName`, a non-string ability, a malformed stat or a
 * non-string list fails closed; nothing is defaulted or inferred from text.
 */
function mapSourcePrintingCard(
  card: unknown,
  index: number
): DuelSourcePrintingCard {
  if (card === null || typeof card !== "object" || Array.isArray(card)) {
    throw new CardProgramAuthorityError(
      `Card program authority: catalog.cards[${index}] must be an object.`
    );
  }
  const record = card as Record<string, unknown>;
  const at = (field: string): string => `catalog.cards[${index}].${field}`;
  return {
    id: requireNonEmptyString(record.id, at("id")),
    cardType: requireNonEmptyString(record.cardType, at("cardType")),
    ability: requireAbilityText(record.ability, at("ability")),
    energy: requireNullableStat(record.energy, at("energy")),
    power: requireNullableStat(record.power, at("power")),
    might: requireNullableStat(record.might, at("might")),
    domains: requireStringArray(record.domains, at("domains")),
    tags: requireStringArray(record.tags, at("tags")),
    canonicalCardId: requireNonEmptyString(
      record.canonicalCardId,
      at("canonicalCardId")
    ),
    name: requireNonEmptyString(record.name, at("name")),
    fullName: requireNonEmptyString(record.fullName, at("fullName")),
    // The public catalog makes localizedName optional; this adapter does not
    // invent one, it fails closed instead.
    localizedName: requireNonEmptyString(
      record.localizedName,
      at("localizedName")
    ),
    setCode: requireNonEmptyString(record.setCode, at("setCode")),
    cardNumber: requireNonEmptyString(record.cardNumber, at("cardNumber")),
    variant: requireNonEmptyString(record.variant, at("variant")),
  };
}

/**
 * Translate a public catalog into the strict source envelope. The result is
 * fully detached from the runtime object; later mutation of the runtime cannot
 * alter an authority built from it.
 */
export function toDuelCatalogEnvelope(
  catalog: PublicCardCatalog
): DuelCatalogEnvelope {
  if (catalog === null || typeof catalog !== "object") {
    throw new CardProgramAuthorityError(
      "Card program authority: a public catalog object is required."
    );
  }
  const record = catalog as unknown as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new CardProgramAuthorityError(
      "Card program authority: catalog.schemaVersion must be 1."
    );
  }
  const dataVersion = requireNonEmptyString(
    record.dataVersion,
    "catalog.dataVersion"
  );
  const digest = requireNonEmptyString(record.digest, "catalog.digest");
  // `cards` is gated by the same dense data-property rule and then walked by
  // index: `Array.prototype.map` skips a hole, which would silently drop a
  // printing instead of failing closed.
  const cards = requirePlainDenseArray(record.cards, "catalog.cards");
  const mappedCards: DuelSourcePrintingCard[] = [];
  for (let index = 0; index < cards.length; index += 1) {
    mappedCards.push(mapSourcePrintingCard(cards[index], index));
  }
  return { dataVersion, digest, cards: mappedCards };
}

function buildAuthorityState(
  catalog: PublicCardCatalog,
  registryFactory: TrustedRegistryFactory
): AuthorityState {
  const envelope = toDuelCatalogEnvelope(catalog);
  // `duelAbilitySourceFromCatalog` re-checks the whole tuple and clones it; the
  // remaining throws are the hardened card-dsl contract, not this adapter's.
  const source = duelAbilitySourceFromCatalog(envelope);
  const registry = registryFactory(source);

  const entries: ResolvedProgramReferenceEntry[] = [];
  const entriesByCardId = new Map<string, ResolvedProgramReferenceEntry>();
  for (const card of source.cards) {
    const reference = registry.reference(card.id);
    // Unknown printings have no reference and never enter the resolved index.
    if (reference === undefined) continue;
    const entry: ResolvedProgramReferenceEntry = Object.freeze({
      cardId: reference.cardId,
      programId: reference.programId,
      encodedReference: encodeDuelProgramReferenceRaw(reference),
    });
    entries.push(entry);
    entriesByCardId.set(entry.cardId, entry);
  }

  return {
    registry,
    stamp: Object.freeze({
      dataVersion: envelope.dataVersion,
      digest: envelope.digest,
    }),
    census: Object.freeze({
      catalogPrintings: source.cards.length,
      resolvedPrograms: registry.knownProgramCount,
      unresolvedPrintings: source.cards.length - registry.knownProgramCount,
    }),
    entries: Object.freeze(entries),
    entriesByCardId,
  };
}

function authorityState(receiver: unknown): AuthorityState {
  if (typeof receiver !== "object" || receiver === null) {
    throw new CardProgramAuthorityError(
      "Card program authority: a genuine authority is required to answer queries."
    );
  }
  const state = AUTHORITY_STATE.get(receiver);
  if (state === undefined) {
    throw new CardProgramAuthorityError(
      "Card program authority: this value is not a live authority minted by createCardProgramAuthority."
    );
  }
  return state;
}

/** Server-runtime capability access; this handle must never be serialized to clients. */
export function getCardProgramRegistryForRuntime(authority: CardProgramAuthority): DuelOfficialProgramRegistry {
  return authorityState(authority).registry;
}

/**
 * Build the only queryable authority for a loaded server catalog. The public
 * catalog is projected detached, the opaque registry is created and kept
 * private, and the returned facade resolves every query through the module-level
 * identity map above.
 */
function createAuthority(
  runtime: CardCatalogRuntime,
  registryFactory: TrustedRegistryFactory
): CardProgramAuthority {
  if (
    runtime === null ||
    typeof runtime !== "object" ||
    (runtime as { publicCatalog?: unknown }).publicCatalog === undefined
  ) {
    throw new CardProgramAuthorityError(
      "Card program authority: a loaded CardCatalogRuntime is required."
    );
  }
  const state = buildAuthorityState(runtime.publicCatalog, registryFactory);

  const authority: CardProgramAuthority = {
    catalogStamp: state.stamp,
    census: state.census,
    resolvedProgramReferenceEntries(): readonly ResolvedProgramReferenceEntry[] {
      return authorityState(this).entries;
    },
    resolvedProgramReference(
      cardId: string
    ): ResolvedProgramReferenceEntry | undefined {
      if (typeof cardId !== "string" || cardId.length === 0) return undefined;
      return authorityState(this).entriesByCardId.get(cardId);
    },
    sourceProgramPhaseScope(
      cardId: string,
      eventOrContext: string | DuelSourceProgramPhaseScopeContext
    ): DuelSourceProgramPhaseScopeResult {
      return authorityState(this).registry.sourceProgramPhaseScope(
        cardId,
        eventOrContext
      );
    },
  };

  AUTHORITY_STATE.set(authority, state);
  return Object.freeze(authority);
}

/** Build the archived default authority (the 65-program registry surface). */
export function createCardProgramAuthority(
  runtime: CardCatalogRuntime
): CardProgramAuthority {
  return createAuthority(runtime, LEGACY_REGISTRY_FACTORY);
}

/** Explicitly opt in to the reviewed pure Unit Accelerate registry surface. */
export function createDuelAccelerateCardProgramAuthorityV1(
  runtime: CardCatalogRuntime
): CardProgramAuthority {
  return createAuthority(runtime, ACCELERATE_REGISTRY_FACTORY);
}

/** Explicitly opt in to the reviewed pure Unit Accelerate + Assault surface. */
export function createDuelExtendedUnitCardProgramAuthorityV1(
  runtime: CardCatalogRuntime
): CardProgramAuthority {
  return createAuthority(runtime, EXTENDED_UNIT_REGISTRY_FACTORY);
}

/** Explicit source binding for the reviewed Fury roster; no execution permission. */
export function createDuelFuryOptionalRosterCardProgramAuthorityV1(
  runtime: CardCatalogRuntime
): CardProgramAuthority {
  return createAuthority(runtime, FURY_OPTIONAL_ROSTER_REGISTRY_FACTORY);
}

/**
 * Explicitly opt in to the reviewed point-damage Spell source family. This
 * binds the real card-dsl point-damage registry (the 81-program surface: the
 * reviewed Fury77 roster plus the four exact point-damage printings) and adds
 * only source identity — no cost, settle, room, protocol or replay change, and
 * no execution permission. Every older factory's references stay identical.
 */
export function createDuelPointDamageCardProgramAuthorityV1(
  runtime: CardCatalogRuntime
): CardProgramAuthority {
  return createAuthority(runtime, POINT_DAMAGE_REGISTRY_FACTORY);
}

/**
 * Explicit source binding for the reviewed 24 source-closed pure resource-only
 * Equip Gear printings. This binds the real card-dsl equip registry (the
 * 107-program surface: the reviewed point-damage 81-program surface plus the two
 * exact pure Shield passive Unit printings, plus the 24 exact pure Equip
 * printings). It adds only source identity — no cost settlement, no
 * Gear/CardPlay/Equip-activation execution and no public execution permission.
 * Every older factory's references stay byte-for-byte identical.
 */
export function createDuelEquipCardProgramAuthorityV1(
  runtime: CardCatalogRuntime
): CardProgramAuthority {
  return createAuthority(runtime, EQUIP_REGISTRY_FACTORY);
}

/**
 * Explicit source binding for the reviewed three Loose Cannon
 * Beginning-Phase conditional-draw Legend source programs. This binds the real
 * card-dsl beginning-phase registry (the 86-program surface: the reviewed
 * point-damage 81-program surface plus the two exact pure Shield passive Unit
 * printings, plus the three exact Legend printings). It records
 * whole-IR source facts only — it does not execute the draw, read a hand or
 * claim a native Beginning-phase executor. Every older factory's references
 * stay byte-for-byte identical.
 */
export function createDuelBeginningPhaseCardProgramAuthorityV1(
  runtime: CardCatalogRuntime
): CardProgramAuthority {
  return createAuthority(runtime, BEGINNING_PHASE_REGISTRY_FACTORY);
}

/**
 * Explicit source binding for both reviewed source families at once: the pure
 * resource-only Equip Gear printings and the Beginning-Phase conditional-draw
 * Legends. This binds the real card-dsl equip+beginning registry (the
 * 110-program surface: the reviewed point-damage 81-program surface plus the two
 * pure Shield passive Unit printings, the 24 Equip printings and the three
 * Beginning printings). It is
 * source identity only — no Gear/CardPlay/Equip-activation execution, no
 * Beginning-draw execution, no cost settlement and no public execution
 * permission. Every older factory's references stay byte-for-byte identical.
 */
export function createDuelEquipBeginningCardProgramAuthorityV1(
  runtime: CardCatalogRuntime
): CardProgramAuthority {
  return createAuthority(runtime, EQUIP_BEGINNING_REGISTRY_FACTORY);
}
