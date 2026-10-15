/**
 * Server-owned adapter from two validated room decks to the formal duel setup
 * seats expected by `@riftbound/engine-core/duel` `createDuelMatch`.
 *
 * This module is a pure, mechanical data adapter:
 *
 * - it reuses the existing authoritative `validateCatalogDeck` result and never
 *   re-implements domain/copy/policy rules;
 * - it only synthesizes setup seats plus `DuelMatchMetadata`; it does NOT
 *   shuffle decks, select a battlefield, draw, channel, or grant the Main
 *   authority (the formal constructor performs its own shuffles);
 * - it never fabricates catalog fields. Card identity, printing identity, the
 *   rune domain and the card type are always read from the actual
 *   `CardCatalogRuntime`;
 * - every physical copy receives a server-owned UID/instanceId from a single
 *   injectable `uidFactory` (default `node:crypto.randomUUID`); the client never
 *   supplies UIDs and a `cardId` is never treated as a physical UID;
 * - all metadata/deck/rune failures are reported before the UID allocator runs,
 *   so an invalid input never consumes UID allocation (and never any shuffle
 *   RNG, which this adapter does not own).
 *
 * The result is a discriminated `Result` value. It replaces neither the
 * upstream `RoomActorAuth` trusted roster nor the parent-owned room lifecycle;
 * the coordinating task later calls `createDuelMatch(seats, metadata, rng)`. No
 * private zone data is emitted to any wire projection here.
 */
import { randomUUID } from "node:crypto";
import type {
  DuelMatchMetadata,
  DuelSetupDomain,
  DuelSetupSeat,
  SetupCard,
  SetupField,
  SetupRune
} from "@riftbound/engine-core/duel";
import {
  validateCatalogDeck,
  type CardCatalogRuntime,
  type PublicCatalogCard
} from "../card-catalog.js";
import type {
  DeckSubmission,
  DeckValidationIssue
} from "../deck-validation.js";

/** The trusted per-seat input: an authenticated roster identity plus its deck. */
export interface DuelSetupSeatInput {
  readonly playerId: string;
  readonly displayName: string;
  readonly deck: DeckSubmission;
}

export interface DuelSetupSeatsRequest {
  /** Server-owned match id; never a raw client metadata value. */
  readonly matchId: string;
  /** Exactly two seats, in authoritative seat order. */
  readonly seats: readonly [DuelSetupSeatInput, DuelSetupSeatInput];
}

export type DuelSetupSeatsErrorCode =
  | "invalid_request"
  | "invalid_deck"
  | "invalid_rune"
  | "invalid_setup_identity";

export interface DuelSetupSeatsFailure {
  readonly ok: false;
  readonly code: DuelSetupSeatsErrorCode;
  readonly message: string;
  /** 0 or 1 when the failure is attributable to a specific seat. */
  readonly seatIndex?: 0 | 1;
  /** Strict `validateCatalogDeck` issues, present for `invalid_deck`. */
  readonly issues?: readonly DeckValidationIssue[];
}

export interface DuelSetupSeatsApproved {
  readonly ok: true;
  readonly seats: readonly [DuelSetupSeat, DuelSetupSeat];
  readonly metadata: DuelMatchMetadata;
}

export type DuelSetupSeatsResult =
  | DuelSetupSeatsApproved
  | DuelSetupSeatsFailure;

/** Server-owned physical-copy UID source; the client never supplies these. */
export type DuelUidFactory = () => string;

const defaultUidFactory: DuelUidFactory = () => randomUUID();

/**
 * Mirrors engine-core's authoritative `DUEL_SETUP_DOMAINS`. The `satisfies`
 * clause type-checks this tuple's members against the engine union, so a member
 * that is not a valid `DuelSetupDomain` is a compile error here. It does NOT
 * catch the engine union merely GROWING: a narrower tuple stays assignable to a
 * widened union, so an upstream domain-set drift is detected by the runtime
 * consistency test in `tests/duel/setup-seats.test.ts`, not by this clause. This
 * is only a local copy of the fixed contract, never a per-card invented value.
 */
const KNOWN_DUEL_DOMAINS = [
  "Fury",
  "Calm",
  "Mind",
  "Body",
  "Chaos",
  "Order"
] as const satisfies readonly DuelSetupDomain[];

const KNOWN_DOMAINS: ReadonlySet<string> = new Set(KNOWN_DUEL_DOMAINS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizedCardType(cardType: string): string {
  return cardType.trim().toLowerCase();
}

function failure(
  code: DuelSetupSeatsErrorCode,
  message: string,
  extra: { readonly seatIndex?: 0 | 1; readonly issues?: readonly DeckValidationIssue[] } = {}
): DuelSetupSeatsFailure {
  return {
    ok: false,
    code,
    message,
    ...(extra.seatIndex === undefined ? {} : { seatIndex: extra.seatIndex }),
    ...(extra.issues === undefined ? {} : { issues: extra.issues })
  };
}

function expandEntries(
  entries: DeckSubmission["mainDeck"]
): readonly string[] {
  const cardIds: string[] = [];
  for (const entry of entries ?? []) {
    for (let copy = 0; copy < entry.quantity; copy += 1) {
      cardIds.push(entry.cardId);
    }
  }
  return cardIds;
}

/**
 * Read the rune domain of a rune printing from the actual catalog. Returns
 * `null` (never a guessed domain) when the printing is unknown, is not a Rune,
 * or does not declare exactly one of the six known duel domains.
 */
function readRuneDomain(
  card: PublicCatalogCard | undefined
): DuelSetupDomain | null {
  if (card === undefined) return null;
  if (normalizedCardType(card.cardType) !== "rune") return null;
  if (card.domains.length !== 1) return null;
  const domain = card.domains[0];
  if (domain === undefined || !KNOWN_DOMAINS.has(domain)) return null;
  return domain as DuelSetupDomain;
}

interface SeatPlan {
  readonly playerId: string;
  readonly displayName: string;
  readonly championCardId: string;
  readonly legendCardId: string;
  readonly mainCardIds: readonly string[];
  readonly runePlans: readonly { readonly cardId: string; readonly domain: DuelSetupDomain }[];
  readonly battlefieldCardIds: readonly string[];
}

/**
 * Pure identity/metadata plan for one seat. Reads only the validated deck and
 * the actual catalog; allocates no UIDs and touches no RNG.
 */
function planSeat(
  runtime: CardCatalogRuntime,
  catalog: ReadonlyMap<string, PublicCatalogCard>,
  input: DuelSetupSeatInput,
  seatIndex: 0 | 1
): SeatPlan | DuelSetupSeatsFailure {
  const playerId = nonEmptyText(input.playerId);
  const displayName = nonEmptyText(input.displayName);
  if (playerId === null || displayName === null) {
    return failure(
      "invalid_request",
      `seat ${seatIndex} requires a non-empty playerId and displayName.`,
      { seatIndex }
    );
  }

  const validation = validateCatalogDeck(runtime, input.deck);
  if (!validation.valid) {
    return failure(
      "invalid_deck",
      `seat ${seatIndex} deck failed catalog validation.`,
      { seatIndex, issues: validation.issues }
    );
  }

  const championEntry = input.deck.champion?.[0];
  const legendEntry = input.deck.legend?.[0];
  if (championEntry === undefined || legendEntry === undefined) {
    return failure(
      "invalid_deck",
      `seat ${seatIndex} requires exactly one Champion and one Legend.`,
      { seatIndex }
    );
  }

  const runePlans: { cardId: string; domain: DuelSetupDomain }[] = [];
  for (const cardId of expandEntries(input.deck.runes)) {
    const domain = readRuneDomain(catalog.get(cardId));
    if (domain === null) {
      return failure(
        "invalid_rune",
        `seat ${seatIndex} rune ${cardId} is not a Rune printing with exactly one known duel domain.`,
        { seatIndex }
      );
    }
    runePlans.push({ cardId, domain });
  }

  return {
    playerId,
    displayName,
    championCardId: championEntry.cardId,
    legendCardId: legendEntry.cardId,
    mainCardIds: expandEntries(input.deck.mainDeck),
    runePlans,
    battlefieldCardIds: expandEntries(input.deck.battlefields)
  };
}

/** Allocate one server-owned, non-empty, globally unique object id. */
function allocateUid(
  uidFactory: DuelUidFactory,
  seen: Set<string>
): string | null {
  let raw: unknown;
  try {
    raw = uidFactory();
  } catch {
    return null;
  }
  const uid = nonEmptyText(raw);
  if (uid === null || seen.has(uid)) return null;
  seen.add(uid);
  return uid;
}

function derivedLocations(seats: readonly SeatPlan[]): ReadonlySet<string> {
  const locations = new Set<string>();
  for (const seat of seats) {
    locations.add(JSON.stringify(["duel-base", seat.playerId]));
  }
  return locations;
}

function buildSeat(
  plan: SeatPlan,
  uidFactory: DuelUidFactory,
  seen: Set<string>
): DuelSetupSeat | null {
  const championUid = allocateUid(uidFactory, seen);
  if (championUid === null) return null;
  const legendUid = allocateUid(uidFactory, seen);
  if (legendUid === null) return null;

  const mainDeck: SetupCard[] = [];
  for (const cardId of plan.mainCardIds) {
    const uid = allocateUid(uidFactory, seen);
    if (uid === null) return null;
    mainDeck.push({ uid, cardId });
  }

  const runeDeck: SetupRune[] = [];
  for (const rune of plan.runePlans) {
    const uid = allocateUid(uidFactory, seen);
    if (uid === null) return null;
    runeDeck.push({ uid, cardId: rune.cardId, domain: rune.domain });
  }

  const battlefields: SetupField[] = [];
  for (const cardId of plan.battlefieldCardIds) {
    const instanceId = allocateUid(uidFactory, seen);
    if (instanceId === null) return null;
    battlefields.push({ instanceId, cardId });
  }

  return {
    playerId: plan.playerId,
    mainDeck,
    champion: { uid: championUid, cardId: plan.championCardId },
    legend: { uid: legendUid, cardId: plan.legendCardId },
    runeDeck,
    battlefields
  };
}

/**
 * Convert two validated room decks into formal duel setup seats and match
 * metadata, or a typed failure. Pure and side-effect free: no shuffling, no
 * battlefield selection, no draw/channel, no Main authority grant.
 */
export function buildDuelSetupSeats(
  runtime: CardCatalogRuntime,
  request: DuelSetupSeatsRequest,
  uidFactory: DuelUidFactory = defaultUidFactory
): DuelSetupSeatsResult {
  const matchId = nonEmptyText(request?.matchId);
  if (matchId === null) {
    return failure("invalid_request", "a non-empty server-owned matchId is required.");
  }
  if (typeof uidFactory !== "function") {
    return failure("invalid_request", "uidFactory must be a function.");
  }

  const rawSeats = request?.seats;
  if (!Array.isArray(rawSeats) || rawSeats.length !== 2) {
    return failure("invalid_request", "exactly two seats are required.");
  }
  const [first, second] = rawSeats as readonly [DuelSetupSeatInput, DuelSetupSeatInput];
  const inputs: readonly [DuelSetupSeatInput, DuelSetupSeatInput] = [first, second];

  const catalog = new Map(runtime.publicCatalog.cards.map(card => [card.id, card]));

  const plans: SeatPlan[] = [];
  for (const seatIndex of [0, 1] as const) {
    const input = inputs[seatIndex];
    if (!isRecord(input) || !isRecord(input.deck)) {
      return failure(
        "invalid_request",
        `seat ${seatIndex} requires a playerId, displayName and deck.`,
        { seatIndex }
      );
    }
    const plan = planSeat(runtime, catalog, input, seatIndex);
    if ("ok" in plan) return plan;
    plans.push(plan);
  }

  const planA = plans[0];
  const planB = plans[1];
  if (planA === undefined || planB === undefined) {
    return failure("invalid_request", "exactly two seats are required.");
  }
  if (planA.playerId === planB.playerId) {
    return failure("invalid_request", "the two seats require distinct playerIds.");
  }

  const seen = new Set<string>();
  const seatA = buildSeat(planA, uidFactory, seen);
  if (seatA === null) {
    return failure(
      "invalid_setup_identity",
      "the uidFactory produced an empty or duplicate game object id."
    );
  }
  const seatB = buildSeat(planB, uidFactory, seen);
  if (seatB === null) {
    return failure(
      "invalid_setup_identity",
      "the uidFactory produced an empty or duplicate game object id."
    );
  }

  // Identity, Game Object UID and derived-location strings must stay in disjoint
  // partitions (mirrored from the formal constructor's own ID validation, which
  // runs before any shuffle RNG is consumed).
  const locations = new Set<string>([
    ...derivedLocations([planA, planB]),
    ...seatA.battlefields.map(field => JSON.stringify(["duel-battlefield", field.instanceId])),
    ...seatB.battlefields.map(field => JSON.stringify(["duel-battlefield", field.instanceId]))
  ]);
  const playerIds = new Set([planA.playerId, planB.playerId]);
  for (const objectId of seen) {
    if (locations.has(objectId) || playerIds.has(objectId)) {
      return failure(
        "invalid_setup_identity",
        "a game object id collides with a player id or a derived location."
      );
    }
  }
  for (const playerId of playerIds) {
    if (locations.has(playerId)) {
      return failure(
        "invalid_setup_identity",
        "a player id collides with another seat's derived location."
      );
    }
  }

  const metadata: DuelMatchMetadata = {
    matchId,
    dataVersion: runtime.publicCatalog.dataVersion,
    catalogDigest: runtime.publicCatalog.digest,
    roster: [
      { playerId: planA.playerId, displayName: planA.displayName },
      { playerId: planB.playerId, displayName: planB.displayName }
    ]
  };

  return {
    ok: true,
    seats: [seatA, seatB] as readonly [DuelSetupSeat, DuelSetupSeat],
    metadata
  };
}
