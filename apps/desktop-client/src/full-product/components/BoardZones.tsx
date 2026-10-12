import type { ProjectionObject, ProjectionZone } from "@riftbound/protocol";
import { deriveLegalActions } from "../commands";
import type {
  PlayableCard,
  PlayableMatchView,
  TargetOption,
  ZoneSummary
} from "../types";

export interface BoardZonesProps {
  readonly view: PlayableMatchView;
  readonly selectedActionId: string | null;
  readonly selectedCardId: string | null;
  readonly selectedTargetIds: readonly string[];
  readonly onSelectCard: (card: PlayableCard) => void;
  readonly onSelectTarget: (objectId: string) => void;
}

export function BoardZones({
  view,
  selectedActionId,
  selectedCardId,
  selectedTargetIds,
  onSelectCard,
  onSelectTarget
}: BoardZonesProps) {
  const zones = zonesFor(view);
  const readOnly =
    view.connectionStatus !== "connected" ||
    view.commandPending ||
    view.projection.phase === "ended";
  const legalPlayIds = new Set<string>(
    deriveLegalActions(view)
      .filter(action => action.type === "play-card")
      .map(action => action.selectedCardId ?? "")
  );
  const selectedAction =
    deriveLegalActions(view).find(action => action.id === selectedActionId) ?? null;
  const targetOptions =
    selectedAction?.requiresTargets === true && selectedCardId !== null
      ? availableTargetOptions(view, selectedCardId)
      : [];
  const targetIds = new Set(
    targetOptions
      .filter(option => option.disabled !== true)
      .map(option => option.id)
  );
  return (
    <div className="full-product-zones" aria-label="双方区域">
      {view.projection.players.map(player => (
        <section
          key={player.id}
          className="full-product-player-zones"
          aria-label={`${player.name} 区域`}
        >
          <h3>{player.name}</h3>
          <div className="full-product-zone-grid">
            {ZONE_ORDER.map(zone => (
              <BoardZone
                key={zone}
                zone={zone}
                label={LABELS[zone] ?? zone}
                objects={visibleObjects(view, player.id, zone)}
                count={declaredCount(view, player.id, zone)}
                hidden={isHidden(view, player.id, zone)}
                selectedCardId={selectedCardId}
                selectedTargetIds={selectedTargetIds}
                onSelectCard={onSelectCard}
                onSelectTarget={objectId => {
                  const option = targetOptions.find(
                    candidate =>
                      candidate.objectId === objectId && candidate.disabled !== true
                  );
                  if (option) onSelectTarget(option.id);
                }}
                readOnly={readOnly}
                legalPlayIds={legalPlayIds}
                targetIds={targetIds}
                resolveCardTitle={view.resolveCardTitle}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function availableTargetOptions(
  view: PlayableMatchView,
  instanceId: string
): readonly TargetOption[] {
  const card = view.projection.players
    .find(player => player.id === view.viewerPlayerId)
    ?.hand.find(card => card.instanceId === instanceId);
  return card ? view.targets?.[card.cardId] ?? [] : [];
}

export const ZONE_ORDER: readonly ProjectionZone[] = [
  "hand",
  "deck",
  "rune-deck",
  "rune",
  "board",
  "battlefield",
  "discard",
  "banish",
  "chain"
];

const LABELS: Readonly<Record<ProjectionZone, string | undefined>> = {
  base: "基地",
  board: "战场",
  battlefield: "战场区域",
  champion: "英雄",
  legend: "传说",
  rune: "符文",
  hand: "手牌",
  deck: "牌库",
  "rune-deck": "符文库",
  discard: "弃牌",
  banish: "放逐",
  chain: "结算链"
};

export function zonesFor(view: PlayableMatchView): readonly ZoneSummary[] {
  return ZONE_ORDER.map(zone => ({
    zone,
    label: LABELS[zone] ?? zone,
    count: view.projection.players.reduce(
      (total, player) => total + declaredCount(view, player.id, zone),
      0
    ),
    objects: view.projection.players.flatMap(player =>
      visibleObjects(view, player.id, zone)
    ),
    hidden: isHidden(view, view.viewerPlayerId, zone),
    selecting: zone === "hand" || zone === "board"
  }));
}

export function visibleObjects(
  view: PlayableMatchView,
  ownerId: string,
  zone: ProjectionZone
): readonly ProjectionObject[] {
  if (isHidden(view, ownerId, zone)) return [];
  const objects = view.projection.objects ?? [];
  return objects.filter(
    object =>
      object.ownerPlayerId === ownerId &&
      object.zone === zone &&
      (object.faceUp || ownerId === view.viewerPlayerId)
  );
}

export function isHidden(
  view: PlayableMatchView,
  ownerId: string,
  zone: ProjectionZone
): boolean {
  return (
    ownerId !== view.viewerPlayerId &&
    (zone === "hand" || zone === "deck" || zone === "rune-deck")
  );
}

function declaredCount(
  view: PlayableMatchView,
  ownerId: string,
  zone: ProjectionZone
): number {
  const player = view.projection.players.find(candidate => candidate.id === ownerId);
  return player?.zoneCounts?.[zone] ?? 0;
}

function BoardZone({
  zone,
  label,
  objects,
  count,
  hidden,
  selectedCardId,
  selectedTargetIds,
  onSelectCard,
  onSelectTarget,
  readOnly,
  legalPlayIds,
  targetIds,
  resolveCardTitle
}: {
  zone: ProjectionZone;
  label: string;
  objects: readonly ProjectionObject[];
  count: number;
  hidden: boolean;
  selectedCardId: string | null;
  selectedTargetIds: readonly string[];
  onSelectCard: (card: PlayableCard) => void;
  onSelectTarget: (objectId: string) => void;
  readOnly: boolean;
  legalPlayIds: ReadonlySet<string>;
  targetIds: ReadonlySet<string>;
  resolveCardTitle: (cardId: string) => string;
}) {
  const isHand = zone === "hand";
  const isSelectableTarget = targetIds.size > 0 && zone !== "hand";
  return (
    <section className="full-product-zone" aria-label={label}>
      <header>
        <h4>{label}</h4>
        <span>{count}</span>
      </header>
      <div className="full-product-zone-items">
        {hidden ? (
          <span className="full-product-hidden">隐藏信息</span>
        ) : objects.length === 0 ? (
          <span className="full-product-empty">空</span>
        ) : (
          objects.map(object => (
            <button
              key={object.objectId}
              type="button"
              disabled={readOnly || (isHand ? !legalPlayIds.has(object.objectId) : !isSelectableTarget)}
              className="full-product-card"
              aria-pressed={
                selectedCardId === object.objectId ||
                selectedTargetIds.includes(object.objectId)
              }
              onClick={() => {
                if (readOnly) return;
                if (isHand && legalPlayIds.has(object.objectId)) {
                  onSelectCard({
                    instanceId: object.objectId,
                    cardId: object.cardId,
                    zone: "hand",
                    title: resolveCardTitle(object.cardId)
                  });
                } else if (isSelectableTarget) {
                  onSelectTarget(object.objectId);
                }
              }}
            >
              {resolveCardTitle(object.cardId)}
            </button>
          ))
        )}
      </div>
    </section>
  );
}
