import type { ProjectionObject, ProjectionZone } from "@riftbound/protocol";
import type { PlayableMatchView } from "../types";
import "./SharedBattlefields.css";

/**
 * Display contract for the two shared central battlefields and the two bases.
 *
 * These types are the seam the protocol wiring adapter maps onto. Do not change
 * their semantics: the adapter will project server state into this exact shape.
 */
export interface DuelBaseView {
  readonly locationId: string;
  readonly ownerPlayerId: string;
  readonly unitObjectIds: readonly string[];
}

export interface DuelBattlefieldView {
  readonly locationId: string;
  readonly cardObjectId: string;
  readonly cardId: string;
  readonly ownerPlayerId: string;
  readonly controllerPlayerId: string | null;
  readonly contested: boolean;
  readonly unitObjectIds: readonly string[];
}

export interface DuelBoardView {
  readonly bases: readonly DuelBaseView[];
  readonly battlefields: readonly DuelBattlefieldView[];
}

export interface SharedBattlefieldsProps {
  readonly board: DuelBoardView;
  readonly view: PlayableMatchView;
  readonly selectableObjectIds?: readonly string[];
  readonly selectedTargetIds?: readonly string[];
  readonly onSelectTarget?: (objectId: string) => void;
}

export const SHARED_BATTLEFIELDS_INCOMPLETE_NOTICE = "共享战场投影不完整";
export const MISSING_UNIT_NOTICE = "投影缺少单位";
export const CONTROLLED_BY_NOBODY_LABEL = "无人控制";
export const CONTESTED_LABEL = "争夺中";

/**
 * `data-position` markers for the tabletop arrangement.
 *
 * The two bases are laid out as a top band and a bottom band. When the
 * projection identifies the viewer as one of the base owners we can label the
 * bands from that viewer's seat: {@link SELF_BASE_POSITION} at the bottom and
 * {@link OPPONENT_BASE_POSITION} on top. A spectator has no seat, so we only
 * ever use the neutral {@link SPECTATOR_BOTTOM_POSITION} /
 * {@link SPECTATOR_TOP_POSITION} markers and never call a side "ours".
 * {@link CENTRAL_POSITION} marks the two shared fields between the bands.
 */
export const SELF_BASE_POSITION = "self";
export const OPPONENT_BASE_POSITION = "opponent";
export const SPECTATOR_BOTTOM_POSITION = "seat-1";
export const SPECTATOR_TOP_POSITION = "seat-2";
export const CENTRAL_POSITION = "central";

export interface BasePlacement {
  readonly bottom: DuelBaseView;
  readonly top: DuelBaseView;
  readonly bottomPosition: string;
  readonly topPosition: string;
}

/**
 * Decide which base sits on the bottom band and which on the top band.
 *
 * The input `board.bases` array order is never trusted. When the projection
 * identifies `view.viewerPlayerId` as one of the base owners, that owner's base
 * is placed at the bottom ("this viewer's side") and the other base on top. A
 * viewer with no matching base is treated as a spectator: the stable seat order
 * of `view.projection.players` picks seat 1 for the bottom band and seat 2 for
 * the top band, still labelled with real public player names.
 *
 * Returns `null` when the placement cannot be uniquely determined — fewer or
 * more than two bases, two bases owned by the same player, a spectator whose
 * seat order cannot be mapped onto two distinct base owners, or a top/bottom
 * pair that does not resolve to two real bases. Callers must render the
 * existing incomplete notice in that case and must not fabricate a side.
 */
export function resolveBasePlacement(
  board: DuelBoardView,
  view: PlayableMatchView
): BasePlacement | null {
  if (board.bases.length !== 2) return null;
  const first = board.bases[0];
  const second = board.bases[1];
  if (!first || !second) return null;
  // Two bases must belong to two distinct owners, otherwise "our side" versus
  // "the opponent's side" is undefined regardless of the viewer.
  if (first.ownerPlayerId === second.ownerPlayerId) return null;

  const self = board.bases.find(base => base.ownerPlayerId === view.viewerPlayerId);
  if (self) {
    const opponent = board.bases.find(
      base => base.ownerPlayerId !== self.ownerPlayerId
    );
    if (!opponent) return null;
    return {
      bottom: self,
      top: opponent,
      bottomPosition: SELF_BASE_POSITION,
      topPosition: OPPONENT_BASE_POSITION
    };
  }

  // Spectator: no base belongs to the viewer. Fall back to the projection's
  // stable seat order (array order) instead of guessing a private identity.
  const bottomSeat = view.projection.players[0];
  const topSeat = view.projection.players[1];
  if (!bottomSeat || !topSeat || bottomSeat.id === topSeat.id) return null;
  const bottom = board.bases.find(base => base.ownerPlayerId === bottomSeat.id);
  const top = board.bases.find(base => base.ownerPlayerId === topSeat.id);
  if (!bottom || !top) return null;
  return {
    bottom,
    top,
    bottomPosition: SPECTATOR_BOTTOM_POSITION,
    topPosition: SPECTATOR_TOP_POSITION
  };
}

/**
 * Zones that legally hold a unit on a shared field.
 *
 * This is a whitelist, not a blacklist: only objects deployed to one of these
 * on-board zones may be rendered through this component. Every other zone from
 * the actual `ProjectionZone` union — `hand`, `deck`, `rune-deck`, `discard`
 * (trash), `legend`, `champion`, `rune`, `banish`, `chain` — must degrade to
 * {@link MISSING_UNIT_NOTICE} even when it is marked face-up or indexed by a
 * caller-supplied `unitObjectIds` list.
 */
const ON_BOARD_ZONES: ReadonlySet<ProjectionZone> = new Set<ProjectionZone>([
  "board",
  "base",
  "battlefield"
]);

/**
 * Resolve an object id from `unitObjectIds` into a renderable public unit.
 *
 * `unitObjectIds` is treated purely as an index: we only ever render objects
 * that exist in `view.projection.objects`, are face-up and live in an
 * on-board zone ({@link ON_BOARD_ZONES}). Anything else — unknown ids, hidden
 * objects or off-board-zone objects such as a face-up trash/legend card —
 * resolves to `null` and must be rendered as {@link MISSING_UNIT_NOTICE}
 * without exposing another zone's card.
 */
export function resolvePublicUnit(
  objects: readonly ProjectionObject[],
  objectId: string
): ProjectionObject | null {
  const found = objects.find(object => object.objectId === objectId);
  if (!found) return null;
  if (!found.faceUp) return null;
  if (!ON_BOARD_ZONES.has(found.zone)) return null;
  return found;
}

export function SharedBattlefields({
  board,
  view,
  selectableObjectIds,
  selectedTargetIds,
  onSelectTarget
}: SharedBattlefieldsProps) {
  const objects = view.projection.objects ?? [];
  const playerNames = new Map(
    view.projection.players.map(player => [player.id, player.name])
  );
  const nameFor = (playerId: string | null): string =>
    playerId === null ? CONTROLLED_BY_NOBODY_LABEL : playerNames.get(playerId) ?? playerId;

  // A complete shared board has exactly two battlefields and two bases that we
  // can place on the top and bottom bands. Anything else is an incomplete
  // projection: never fabricate fields or sides and never index out of bounds.
  const placement =
    board.battlefields.length === 2 ? resolveBasePlacement(board, view) : null;
  if (!placement) {
    return (
      <div
        className="full-product-shared-battlefields full-product-shared-battlefields-incomplete"
        role="note"
        aria-label="共享战场投影不完整"
      >
        {SHARED_BATTLEFIELDS_INCOMPLETE_NOTICE}
      </div>
    );
  }

  const readOnly =
    view.connectionStatus !== "connected" ||
    view.commandPending ||
    view.projection.phase === "ended";
  const selectable = new Set<string>(selectableObjectIds ?? []);
  const selected = new Set<string>(selectedTargetIds ?? []);

  const renderUnit = (object: ProjectionObject) => {
    const title = view.resolveCardTitle(object.cardId);
    const isSelected =
      selected.has(object.objectId) || selected.has(`object:${object.objectId}`);
    // Owner stays available as data (the card's origin) even though the visual
    // grouping now follows the current controller.
    const ownerAttrs = {
      "data-owner-player-id": object.ownerPlayerId,
      "data-controller-player-id": object.controllerId
    };
    if (!onSelectTarget) {
      return (
        <li key={object.objectId} className="full-product-shared-unit" {...ownerAttrs}>
          {title}
        </li>
      );
    }
    const canSelect = !readOnly && selectable.has(object.objectId);
    return (
      <li key={object.objectId} className="full-product-shared-unit" {...ownerAttrs}>
        <button
          type="button"
          className="full-product-shared-unit-button"
          disabled={!canSelect}
          aria-pressed={isSelected}
          onClick={() => {
            if (canSelect) onSelectTarget(object.objectId);
          }}
        >
          {title}
        </button>
      </li>
    );
  };

  const renderUnits = (unitObjectIds: readonly string[]) => {
    // Group resolvable public units by their *current controller* so both
    // players' units are visible together on the same field and a stolen unit
    // is shown under the player who actually controls it. Unresolved ids are
    // collected separately and stay an explicit notice instead of leaking card
    // data.
    const groups = new Map<string, ProjectionObject[]>();
    let missing = 0;
    for (const objectId of unitObjectIds) {
      const object = resolvePublicUnit(objects, objectId);
      if (!object) {
        missing += 1;
        continue;
      }
      const existing = groups.get(object.controllerId);
      if (existing) existing.push(object);
      else groups.set(object.controllerId, [object]);
    }
    return (
      <div className="full-product-shared-unit-groups">
        {groups.size === 0 && missing === 0 ? (
          <span className="full-product-shared-empty">暂无公共单位</span>
        ) : null}
        {[...groups.entries()].map(([controllerId, units]) => (
          <div
            key={controllerId}
            className="full-product-shared-unit-group"
            data-controller-player-id={controllerId}
            aria-label={`${playerNames.get(controllerId) ?? controllerId} 公共单位`}
          >
            <h5 className="full-product-shared-unit-group-owner">
              {playerNames.get(controllerId) ?? controllerId}
            </h5>
            <ul className="full-product-shared-unit-list">{units.map(renderUnit)}</ul>
          </div>
        ))}
        {missing > 0 ? (
          <div
            className="full-product-shared-unit-missing"
            aria-label={MISSING_UNIT_NOTICE}
          >
            {MISSING_UNIT_NOTICE}（{missing}）
          </div>
        ) : null}
      </div>
    );
  };

  const renderCardThumbnail = (cardId: string) => {
    const imageUrl = view.resolveCardImage?.(cardId) ?? null;
    if (imageUrl) {
      return (
        <img
          className="full-product-shared-card-thumbnail"
          src={imageUrl}
          alt={view.resolveCardTitle(cardId)}
        />
      );
    }
    return (
      <div className="full-product-shared-card-thumbnail is-missing" aria-hidden="true" />
    );
  };

  // One base band. `data-position` marks the band's place (self / opponent for
  // a seated viewer, seat-1 / seat-2 for a spectator) while the visible title
  // and aria-label keep the base owner's real public name untouched.
  const renderBase = (base: DuelBaseView, position: string) => (
    <section
      key={base.locationId}
      className="full-product-shared-base"
      data-position={position}
      aria-label={`${playerNames.get(base.ownerPlayerId) ?? base.ownerPlayerId} 基地`}
    >
      <h4 className="full-product-shared-base-title">
        {playerNames.get(base.ownerPlayerId) ?? base.ownerPlayerId} 基地
      </h4>
      {renderUnits(base.unitObjectIds)}
    </section>
  );

  // Tabletop arrangement: the opponent's base band on top, the two shared
  // central fields side by side in the middle, and the viewer's base band on
  // the bottom. Placement order comes from owner ids, never the input array.
  return (
    <div className="full-product-shared-battlefields" aria-label="共享战场">
      <div
        className="full-product-shared-base-row full-product-shared-base-row-top"
        data-position={placement.topPosition}
      >
        {renderBase(placement.top, placement.topPosition)}
      </div>
      <div className="full-product-shared-battlefield-row">
        {board.battlefields.map(battlefield => {
          const title = view.resolveCardTitle(battlefield.cardId);
          return (
            <section
              key={battlefield.locationId}
              className="full-product-shared-battlefield"
              data-position={CENTRAL_POSITION}
              aria-label={`共享战场 ${title}`}
            >
              <header className="full-product-shared-battlefield-header">
                <h4 className="full-product-shared-battlefield-title">{title}</h4>
                <div className="full-product-shared-battlefield-tags">
                  <span className="full-product-shared-contributor">
                    贡献者：{nameFor(battlefield.ownerPlayerId)}
                  </span>
                  <span className="full-product-shared-controller">
                    控制者：{nameFor(battlefield.controllerPlayerId)}
                  </span>
                  {battlefield.contested ? (
                    <span className="full-product-shared-contested">
                      {CONTESTED_LABEL}
                    </span>
                  ) : null}
                </div>
              </header>
              {renderCardThumbnail(battlefield.cardId)}
              {renderUnits(battlefield.unitObjectIds)}
            </section>
          );
        })}
      </div>
      <div
        className="full-product-shared-base-row full-product-shared-base-row-bottom"
        data-position={placement.bottomPosition}
      >
        {renderBase(placement.bottom, placement.bottomPosition)}
      </div>
    </div>
  );
}
