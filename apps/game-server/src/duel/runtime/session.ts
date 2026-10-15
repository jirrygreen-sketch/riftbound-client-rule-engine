import {
  createDuelCommandSessionV2,
  type DuelCommandSessionV2,
  type DuelTrustedCardTypeResolverV2,
} from "@riftbound/engine-core/duel";
import type { CardCatalogRuntime } from "../../card-catalog.js";
import type { DeckSubmission } from "../../deck-validation.js";
import { buildDuelSetupSeats } from "../setup-seats.js";

/** Seat order and identity are supplied by the trusted room, never by a wire command. */
export type DuelRuntimeSeatV2 = {
  readonly playerId: string;
  readonly displayName: string;
  readonly deck: DeckSubmission;
};

/**
 * Trusted construction inputs. `trustedCardType` is required and MUST resolve a
 * card id against the trusted catalog (it is never inferred from a client slot).
 */
export interface DuelRuntimeSessionOptionsV2 {
  readonly randomIndex: (upperBound: number) => number;
  readonly uidFactory?: () => string;
  readonly trustedCardType: DuelTrustedCardTypeResolverV2;
}

/**
 * Validate both submitted decks through the actual setup adapter before allocating
 * UIDs or consuming setup shuffle RNG, then hand the seats to the V2 factory. The
 * V2 match stays an in-memory capability; no private zone data is emitted here.
 */
export function createDuelRuntimeSessionV2(
  catalog: CardCatalogRuntime,
  trustedRoster: readonly [DuelRuntimeSeatV2, DuelRuntimeSeatV2],
  matchId: string,
  options: DuelRuntimeSessionOptionsV2,
): DuelCommandSessionV2 {
  const setup = buildDuelSetupSeats(catalog, { matchId, seats: trustedRoster }, options.uidFactory);
  if (!setup.ok) throw new TypeError(`Duel V2 setup rejected: ${setup.code}`);
  return createDuelCommandSessionV2(
    setup.seats,
    setup.metadata,
    options.randomIndex,
    options.trustedCardType,
  );
}

/** Seat order and identity are supplied by the trusted room, never by a wire command. */
export type DuelRuntimeSeatV3 = DuelRuntimeSeatV2;

/** Trusted construction inputs; identical to V2 (trusted catalog card-type resolver required). */
export type DuelRuntimeSessionOptionsV3 = DuelRuntimeSessionOptionsV2;

/** The V3 session is the same admitted in-memory V2 capability; V3 only changes the wire match. */
export type DuelRuntimeSessionV3 = DuelCommandSessionV2;

/**
 * Reuse the V2 session factory verbatim: both trusted decks are validated through the
 * real setup adapter before any UID/RNG use, then the real V2 factory is called. No V3
 * lifecycle, cloning or schema downgrade is introduced here.
 */
export function createDuelRuntimeSessionV3(
  catalog: CardCatalogRuntime,
  trustedRoster: readonly [DuelRuntimeSeatV3, DuelRuntimeSeatV3],
  matchId: string,
  options: DuelRuntimeSessionOptionsV3,
): DuelRuntimeSessionV3 {
  return createDuelRuntimeSessionV2(catalog, trustedRoster, matchId, options);
}
