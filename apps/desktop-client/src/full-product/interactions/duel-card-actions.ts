import { isDuelProjectionV3Actions1 } from "@riftbound/protocol";
import type { DuelProjectionV3Actions1, DuelWireCard, DuelWireUnit } from "@riftbound/protocol";
import type { DuelActionsSelection } from "../components/DuelActionsPanelV3";
import type { DuelCardDropTarget } from "./duel-card-interaction";

/**
 * Direct-card action projection mapper.
 *
 * A pure, read-only adapter that answers "which real `projection.actions` belong
 * to this card, and where may it be dropped?" so the board can show a popover and
 * a live drop highlight beside/on the card instead of a separate confirm panel.
 * It only ever returns temporary presentation data (an action-id list, drop
 * targets, and a prefilled {@link DuelActionsSelection}). It NEVER emits a
 * command, mutates the projection or a card, reads a hidden zone, or re-derives a
 * rule; final legality is still re-checked by `resolveDuelActionIssue` /
 * `buildDuelCommandPacket` at the submit boundary.
 *
 * Fail-closed boundaries:
 *  - The projection must pass the P4 guard and have an authenticated, non-spectator
 *    viewer; otherwise every export returns empty (`[]` / `null`).
 *  - A card is only recognised when its UID resolves inside the viewer's OWN
 *    visible hand, OWN resource base (base runes / gold tokens), or the public
 *    board as a viewer-controlled unit. An opponent/hidden/unknown UID — even if
 *    some action references it — yields no option.
 *  - Action associations are exactly: `play-card.cardUID`,
 *    `rune-energy`/`rune-power`/`gold-power.uid`, and
 *    `standard-move.selectableUnitUIDs`. Every other kind (including unknown
 *    kinds) contributes no card option.
 *  - Drop targets come only from enabled actions; disabled entries may still be
 *    returned as action ids so the popover can display their server reason.
 */

/** A card the viewer may act on, resolved strictly from their own visible zones. */
type OwnCardZone = "hand" | "rune" | "gold" | "unit";

interface CardProjectionContext {
  readonly handUIDs: ReadonlySet<string>;
  readonly baseRuneUIDs: ReadonlySet<string>;
  readonly goldUIDs: ReadonlySet<string>;
  readonly ownUnitUIDs: ReadonlySet<string>;
  readonly ownBaseLocationId: string | null;
  readonly baseLocationIds: ReadonlySet<string>;
  readonly battlefieldLocationIds: ReadonlySet<string>;
}

/**
 * Resolve the viewer's own visible zones from a guard-passing, playing projection.
 * Returns `null` for an invalid projection, a spectator, or a non-playing match,
 * so no caller can ever turn an unverified scene into an actionable card.
 */
function cardProjectionContext(projection: DuelProjectionV3Actions1): CardProjectionContext | null {
  if (!isDuelProjectionV3Actions1(projection)) return null;
  const viewerPlayerId = projection.viewerPlayerId;
  if (viewerPlayerId === null) return null;
  const match = projection.match;
  if (match.stage !== "playing") return null;
  const ownHand: readonly DuelWireCard[] =
    match.players.find(player => player.playerId === viewerPlayerId)?.hand ?? [];
  const resourceBase = match.resources.bases.find(base => base.playerId === viewerPlayerId);
  const units: readonly DuelWireUnit[] = match.board.units;
  return {
    handUIDs: new Set(ownHand.map(card => card.uid)),
    baseRuneUIDs: new Set((resourceBase?.baseRunes ?? []).map(rune => rune.uid)),
    goldUIDs: new Set((resourceBase?.goldTokens ?? []).map(token => token.uid)),
    ownUnitUIDs: new Set(
      units.filter(unit => unit.controllerPlayerId === viewerPlayerId).map(unit => unit.objectId)
    ),
    ownBaseLocationId:
      match.board.bases.find(base => base.ownerPlayerId === viewerPlayerId)?.locationId ?? null,
    baseLocationIds: new Set(match.board.bases.map(base => base.locationId)),
    battlefieldLocationIds: new Set(match.board.battlefields.map(field => field.locationId))
  };
}

/** The viewer's own zone for a UID, or `null` for a foreign/hidden/unknown card. */
function ownCardZone(context: CardProjectionContext, cardUID: string): OwnCardZone | null {
  if (context.handUIDs.has(cardUID)) return "hand";
  if (context.baseRuneUIDs.has(cardUID)) return "rune";
  if (context.goldUIDs.has(cardUID)) return "gold";
  if (context.ownUnitUIDs.has(cardUID)) return "unit";
  return null;
}

/** A temporary, presentation-only selection; the submit boundary re-validates it. */
function selectionFor(
  actionId: string,
  moveUnitUIDs: readonly string[],
  moveDestinationLocationId: string | null
): DuelActionsSelection {
  return {
    actionId,
    moveUnitUIDs,
    moveDestinationLocationId,
    choiceOptionIds: {},
    allocationAmounts: {}
  };
}

/** Deduplicate drop targets by location while preserving first-seen order and kind. */
function dedupeTargets(targets: readonly DuelCardDropTarget[]): readonly DuelCardDropTarget[] {
  const seen = new Set<string>();
  const uniqueTargets: DuelCardDropTarget[] = [];
  for (const target of targets) {
    if (seen.has(target.locationId)) continue;
    seen.add(target.locationId);
    uniqueTargets.push(target);
  }
  return uniqueTargets;
}

/**
 * Real {@link DuelProjectionV3Actions1.actions} ids a card-authored option may use.
 * Disabled entries are included so the popover can show their server reason; an
 * unknown card, foreign unit, spectator or invalid projection yields `[]`.
 */
export function duelCardActionIds(
  projection: DuelProjectionV3Actions1,
  cardUID: string
): readonly string[] {
  const context = cardProjectionContext(projection);
  if (context === null) return [];
  const zone = ownCardZone(context, cardUID);
  if (zone === null) return [];
  const actionIds: string[] = [];
  for (const action of projection.actions) {
    switch (action.kind) {
      case "play-card":
        if (zone === "hand" && action.cardUID === cardUID) actionIds.push(action.id);
        break;
      case "rune-energy":
      case "rune-power":
        if (zone === "rune" && action.uid === cardUID) actionIds.push(action.id);
        break;
      case "gold-power":
        if (zone === "gold" && action.uid === cardUID) actionIds.push(action.id);
        break;
      case "standard-move":
        if (zone === "unit" && action.selectableUnitUIDs.includes(cardUID)) actionIds.push(action.id);
        break;
      default:
        break;
    }
  }
  return actionIds;
}

/**
 * Drop targets for a card, derived only from ENABLED actions whose destination
 * fields precisely list this card:
 *  - a hand `play-card` is targetless on the wire, so its only legal drop gesture
 *    is the viewer's own Base (never a battlefield or a foreign zone);
 *  - owns nothing for resource runes/gold tokens (they are not dragged to a
 *    battlefield);
 *  - a viewer-controlled unit uses the matching `standard-move` destinations where
 *    `eligibleUnitUIDs` includes the unit and `locationId` is a real board location.
 * Every other kind, a disabled action, or a stale/illegal destination yields no target.
 */
export function duelCardDropTargets(
  projection: DuelProjectionV3Actions1,
  cardUID: string
): readonly DuelCardDropTarget[] {
  const context = cardProjectionContext(projection);
  if (context === null) return [];
  const zone = ownCardZone(context, cardUID);
  if (zone === null) return [];
  const targets: DuelCardDropTarget[] = [];
  for (const action of projection.actions) {
    if (!action.enabled) continue;
    if (action.kind === "play-card") {
      if (zone === "hand" && action.cardUID === cardUID && context.ownBaseLocationId !== null) {
        targets.push({ kind: "base", locationId: context.ownBaseLocationId });
      }
      continue;
    }
    if (action.kind !== "standard-move") continue;
    if (zone !== "unit" || !action.selectableUnitUIDs.includes(cardUID)) continue;
    for (const destination of action.destinations) {
      if (!destination.eligibleUnitUIDs.includes(cardUID)) continue;
      const kind = context.battlefieldLocationIds.has(destination.locationId)
        ? "battlefield"
        : context.baseLocationIds.has(destination.locationId)
          ? "base"
          : null;
      if (kind === null) continue;
      targets.push({ kind, locationId: destination.locationId });
    }
  }
  return dedupeTargets(targets);
}

/**
 * The temporary selection prefilled when a card is dropped on `locationId`, or
 * `null` when that drop is not a real, currently-enabled option (a stale target,
 * an illegal destination, a disabled action, or a foreign/hidden card). A hand
 * `play-card` prefills only its own-Base action with no move fields; a unit move
 * prefills exactly this unit and its exact destination. The panel still runs
 * `resolveDuelActionIssue` / `buildDuelCommandPacket` before anything is sent.
 */
export function duelCardDropSelection(
  projection: DuelProjectionV3Actions1,
  cardUID: string,
  locationId: string
): DuelActionsSelection | null {
  const context = cardProjectionContext(projection);
  if (context === null) return null;
  const zone = ownCardZone(context, cardUID);
  if (zone === null) return null;
  for (const action of projection.actions) {
    if (!action.enabled) continue;
    if (
      zone === "hand" &&
      action.kind === "play-card" &&
      action.cardUID === cardUID &&
      context.ownBaseLocationId !== null &&
      locationId === context.ownBaseLocationId
    ) {
      return selectionFor(action.id, [], null);
    }
    if (
      zone === "unit" &&
      action.kind === "standard-move" &&
      action.selectableUnitUIDs.includes(cardUID) &&
      action.destinations.some(
        destination =>
          destination.locationId === locationId && destination.eligibleUnitUIDs.includes(cardUID)
      )
    ) {
      return selectionFor(action.id, [cardUID], locationId);
    }
  }
  return null;
}
