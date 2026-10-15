import type {
  DuelProjectionTransport,
  DuelPublicChainCardV3Actions1,
  DuelWireGearPermanent,
  DuelWireLegendPermanent,
  DuelWireMatchPlaying,
  DuelWireMatchPlayingV2,
  DuelWireMatchPlayingV3,
  DuelWireResourceBase,
  DuelWireUnit
} from "@riftbound/protocol";
import { DUEL_SCORE_TRACK_MAX_TICKS } from "./duel-board-model";

export type DuelWirePlayingMatch = DuelWireMatchPlaying | DuelWireMatchPlayingV2 | DuelWireMatchPlayingV3;

/**
 * The public Gears a V3 playing board projects, or `[]` for V1/V2 (which carry
 * no permanent zone at all). This is a read of the wire, not a derived rule
 * model.
 */
export function duelBoardGears(playing: DuelWirePlayingMatch): readonly DuelWireGearPermanent[] {
  return playing.schemaVersion === 3 ? playing.board.gears : [];
}
/**
 * The public Legend permanent for one seat, or `null` for V1/V2 (whose legend is
 * only `{ cardId }`). V3 carries the server-projected controller and readiness;
 * the client never recomputes them from attachments or actions.
 */
export function duelLegendPermanent(
  playing: DuelWirePlayingMatch,
  playerId: string
): DuelWireLegendPermanent | null {
  if (playing.schemaVersion !== 3) return null;
  return playing.players.find(candidate => candidate.playerId === playerId)?.legend ?? null;
}

/**
 * A display label for a Gear's wire attachment host, resolved against the
 * current board only. The protocol guard already guarantees the host exists at
 * the same location and that the graph is acyclic, so this never "repairs" an
 * illegal graph: an unresolvable host returns `null` and the caller shows a
 * neutral, uid-free fallback instead of inventing a target.
 */
export function duelGearHostLabel(
  gears: readonly DuelWireGearPermanent[],
  units: readonly DuelWireUnit[],
  attachedToUID: string,
  resolveCardTitle: (cardId: string) => string
): string | null {
  const gear = gears.find(candidate => candidate.uid === attachedToUID);
  if (gear) return resolveCardTitle(gear.cardId);
  const unit = units.find(candidate => candidate.objectId === attachedToUID);
  if (!unit) return null;
  return unit.trait.kind === "card" ? resolveCardTitle(unit.trait.cardId) : unit.trait.name;
}

export interface DuelDeckCounts {
  readonly mainDeck: number;
  readonly runeDeck: number;
  readonly trash: number;
}

/**
 * The public deck/trash counts for one seat: the main-deck and trash counts are
 * the player's own wire fields, the rune-deck count is the matching resources
 * entry. Returns `null` when the seat is absent rather than inventing a `0`.
 */
export function duelDeckCounts(
  playing: DuelWirePlayingMatch,
  playerId: string
): DuelDeckCounts | null {
  const player = playing.players.find(candidate => candidate.playerId === playerId);
  const resources = playing.resources.players.find(candidate => candidate.playerId === playerId);
  if (!player || !resources) return null;
  return { mainDeck: player.mainDeckCount, runeDeck: resources.runeDeckCount, trash: player.trash.length };
}

/**
 * The public resource base for a board base. Both the resource base's
 * `playerId` *and* its `locationId` must match the board base before any rune or
 * gold token is shown; the component never copies authority from the board base
 * onto a mismatched resources entry.
 */
export function duelResourceBase(
  playing: DuelWirePlayingMatch,
  ownerPlayerId: string,
  locationId: string
): DuelWireResourceBase | null {
  return (
    playing.resources.bases.find(
      base => base.playerId === ownerPlayerId && base.locationId === locationId
    ) ?? null
  );
}

/**
 * Every card identity a viewer may currently look at, straight from the
 * projection. Public printings (legend, champion, battlefields, board units,
 * base runes, public trash) are always included; a player's hidden hand is only
 * included for the authenticated viewer, so a spectator or the other seat can
 * never resolve it.
 */
export function duelVisibleCardIds(projection: DuelProjectionTransport): readonly string[] {
  const ids = new Set<string>();
  const { match } = projection;
  const viewer = projection.viewerPlayerId;
  if (match.stage === "setup") {
    for (const player of match.setup.players) {
      ids.add(player.legend.cardId);
      ids.add(player.champion.cardId);
      if (viewer === player.playerId) {
        for (const card of player.hand ?? []) ids.add(card.cardId);
      }
    }
    for (const field of match.setup.selectedBattlefields) ids.add(field.cardId);
    return [...ids];
  }
  for (const player of match.players) {
    ids.add(player.legend.cardId);
    if (player.champion !== null) ids.add(player.champion.cardId);
    if (viewer === player.playerId) {
      for (const card of player.hand ?? []) ids.add(card.cardId);
    }
    for (const card of player.trash) ids.add(card.cardId);
  }
  for (const field of match.board.battlefields) ids.add(field.cardId);
  for (const unit of match.board.units) {
    if (unit.trait.kind === "card") ids.add(unit.trait.cardId);
  }
  // V3 board Gears are public printings too; V1/V2 project none, so this adds
  // nothing for them.
  for (const gear of duelBoardGears(match)) ids.add(gear.cardId);
  for (const base of match.resources.bases) {
    for (const rune of base.baseRunes) ids.add(rune.cardId);
  }
  for (const card of duelPublicChainCards(projection)) ids.add(card.cardId);
  return [...ids];
}

/** Read only the server supplied public Chain facts; no client side card or UID inference. */
export function duelPublicChainCards(projection: DuelProjectionTransport): readonly DuelPublicChainCardV3Actions1[] {
  if (projection.match.stage !== "playing" || !("chain" in projection.match.frame) ||
      projection.match.frame.chain.active !== true) return [];
  return projection.match.frame.chain.cards ?? [];
}

/**
 * Resolve a requested preview id against the *current* projection, or `null`
 * when the identity is not visible to this viewer. This is the synchronous
 * privacy guard the render path uses: a stale hand pick cannot survive a viewer
 * switch, because the card is no longer in the visible set.
 */
export function duelPreviewTarget(projection: DuelProjectionTransport, cardId: string | null): string | null {
  if (cardId === null) return null;
  return duelVisibleCardIds(projection).includes(cardId) ? cardId : null;
}

/** Ascending tick values `0..victoryScore` (9 ticks for the real target 8). */
export function scoreTrackValues(victoryScore: number): readonly number[] {
  if (!Number.isSafeInteger(victoryScore) || victoryScore < 1) return [0];
  const top = Math.min(victoryScore, DUEL_SCORE_TRACK_MAX_TICKS - 1);
  const values: number[] = [];
  for (let value = 0; value <= top; value += 1) values.push(value);
  return values;
}

/** A short rail marker for a display name; the full name stays in a title. */
export function duelScoreMarkerLabel(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) return "?";
  const chars = Array.from(trimmed);
  return chars.length <= 3 ? trimmed : chars.slice(0, 3).join("");
}
