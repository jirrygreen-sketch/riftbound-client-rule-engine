import { Coins, Heart, Layers, Star, Swords } from "lucide-react";
import {
  buildProjectedZones,
  type BoardCardInfo,
  type ProjectedPlayerView,
  type ProjectedZoneView
} from "../game/projectionContract";
import type { CardInstance } from "@riftbound/protocol";

interface PlayerBoardProps {
  player: ProjectedPlayerView | null;
  viewerPlayerId: string | null;
  sideName: string;
  selectedCardId: string | null;
  onSelectCard?: (card: CardInstance) => void;
  onPlayCard?: (instanceId: string) => void;
  canSelect: boolean;
  isActive: boolean;
  resolveCardInfo: (cardId: string) => BoardCardInfo | null;
}

export function PlayerBoard({
  player,
  viewerPlayerId,
  sideName,
  selectedCardId,
  onSelectCard,
  onPlayCard,
  canSelect,
  isActive,
  resolveCardInfo
}: PlayerBoardProps) {
  const zones = buildProjectedZones(player, viewerPlayerId);
  const handObjects = zones.find(zone => zone.zone === "hand")?.objects ?? [];
  const isSelf = player !== null && viewerPlayerId === player.playerId;
  const showLegacyHand = player?.isLegacy === true && isSelf;
  const playableIds =
    isSelf && (player?.playableInstanceIds !== undefined || !player?.isLegacy)
      ? player?.playableInstanceIds
      : undefined;

  return (
    <section className={`player-board ${isSelf ? "self" : "opponent"}`} aria-label={sideName}>
      <header className="player-header">
        <div>
          <h2>{player?.displayName ?? "等待玩家"}</h2>
          <p>
            {sideName}
            {isActive ? " · 当前回合" : ""}
          </p>
        </div>
        <dl className="resource-strip">
          <div>
            <dt><Star size={15} aria-hidden />分数</dt>
            <dd>{player?.score ?? "-"}</dd>
          </div>
          <div>
            <dt><Layers size={15} aria-hidden />符文</dt>
            <dd>{player?.runes.length ?? 0}</dd>
          </div>
          {!player?.isLegacy ? (
            <>
              <div>
                <dt><Coins size={15} aria-hidden />能量</dt>
                <dd>{player?.energy ?? "-"}</dd>
              </div>
              <div>
                <dt><Swords size={15} aria-hidden />势力</dt>
                <dd>
                  {player?.power
                    ? Object.entries(player.power)
                        .map(([domain, value]) => `${domain}:${value}`)
                        .join(" / ") || "0"
                    : "-"}
                </dd>
              </div>
            </>
          ) : null}
          {player?.isLegacy ? (
            <>
              <div>
                <dt><Heart size={15} aria-hidden />Synthetic 生命</dt>
                <dd>{player.life ?? "-"}</dd>
              </div>
              <div>
                <dt><Coins size={15} aria-hidden />Synthetic 资源</dt>
                <dd>{player.mana ?? "-"}</dd>
              </div>
            </>
          ) : (
            <div>
              <dt><Swords size={15} aria-hidden />玩家</dt>
              <dd>{player?.playerId ?? "-"}</dd>
            </div>
          )}
        </dl>
      </header>

      <div className="board-zone-grid" aria-label={`${sideName} zones`}>
        {zones.map(zone => (
          <BoardZone
            key={zone.zone}
            zone={zone}
            canSelect={canSelect && isSelf}
            selectedCardId={selectedCardId}
            onSelectCard={onSelectCard}
            onPlayCard={onPlayCard}
            playableInstanceIds={playableIds}
            resolveCardInfo={resolveCardInfo}
          />
        ))}
      </div>

      <div className="hand-zone">
        <h3>{isSelf ? "我的手牌" : "对手手牌不可见"}</h3>
        <div className="card-row">
          {!isSelf ? (
            <span className="empty-zone">
              {player ? `${player.handCount ?? handObjects.length} 张手牌` : "等待玩家加入"}
            </span>
          ) : showLegacyHand || handObjects.length > 0 ? (
            handObjects.length === 0
              ? <span className="empty-zone">暂无可选手牌</span>
              : handObjects.map(object => (
                  <CardTile
                    key={object.objectId}
                    card={{ instanceId: object.objectId, cardId: object.cardId }}
                    selected={object.objectId === selectedCardId}
                    canSelect={canSelect}
                    onSelect={() =>
                      onSelectCard?.({ instanceId: object.objectId, cardId: object.cardId })
                    }
                    onPlay={makePlayHandler({
                      instanceId: object.objectId,
                      playableInstanceIds: playableIds,
                      onPlayCard
                    })}
                    resolveCardInfo={resolveCardInfo}
                  />
                ))
          ) : handObjects.length === 0 ? (
            <span className="empty-zone">等待投影</span>
          ) : (
            handObjects.map(object => (
              <CardTile
                key={object.objectId}
                card={{ instanceId: object.objectId, cardId: object.cardId }}
                selected={object.objectId === selectedCardId}
                canSelect={canSelect}
                onSelect={() =>
                  onSelectCard?.({ instanceId: object.objectId, cardId: object.cardId })
                }
                onPlay={makePlayHandler({
                  instanceId: object.objectId,
                  playableInstanceIds: playableIds,
                  onPlayCard
                })}
                resolveCardInfo={resolveCardInfo}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function BoardZone({
  zone,
  canSelect,
  selectedCardId,
  onSelectCard,
  onPlayCard,
  playableInstanceIds,
  resolveCardInfo
}: {
  zone: ProjectedZoneView;
  canSelect: boolean;
  selectedCardId: string | null;
  onSelectCard?: (card: CardInstance) => void;
  onPlayCard?: (instanceId: string) => void;
  playableInstanceIds?: readonly string[] | null;
  resolveCardInfo: (cardId: string) => BoardCardInfo | null;
}) {
  return (
    <section className={`board-zone ${zone.state}`} aria-label={`${zone.label}区域`}>
      <header>
        <h3>{zone.label}</h3>
        <span>{zone.count === null ? "等待投影" : zone.count}</span>
      </header>
      <div className="zone-card-row">
        {zone.state === "awaiting-projection" ? (
          <span className="empty-zone">等待共享投影</span>
        ) : zone.objects.length === 0 ? (
          <span className="empty-zone">空区域</span>
        ) : (
          zone.objects.map(object => (
            <CardTile
              key={object.objectId}
              card={{ instanceId: object.objectId, cardId: object.cardId }}
              selected={object.objectId === selectedCardId}
              canSelect={canSelect}
              onSelect={() =>
                onSelectCard?.({ instanceId: object.objectId, cardId: object.cardId })
              }
              onPlay={makePlayHandler({
                instanceId: object.objectId,
                playableInstanceIds,
                onPlayCard
              })}
              resolveCardInfo={resolveCardInfo}
            />
          ))
        )}
      </div>
    </section>
  );
}

function makePlayHandler({
  instanceId,
  playableInstanceIds,
  onPlayCard
}: {
  instanceId: string;
  playableInstanceIds?: readonly string[] | null;
  onPlayCard?: (instanceId: string) => void;
}): (() => void) | undefined {
  if (!onPlayCard) return undefined;
  if (playableInstanceIds === null) return undefined;
  if (playableInstanceIds !== undefined && !playableInstanceIds.includes(instanceId)) {
    return undefined;
  }
  return () => onPlayCard(instanceId);
}

function CardTile({
  card,
  selected,
  canSelect,
  onSelect,
  onPlay,
  resolveCardInfo
}: {
  card: CardInstance;
  selected?: boolean;
  canSelect: boolean;
  onSelect?: () => void;
  onPlay?: () => void;
  resolveCardInfo: (cardId: string) => BoardCardInfo | null;
}) {
  const info = resolveCardInfo(card.cardId);
  const name = info?.title ?? "未实现";
  const typeLabel = info?.typeLabel ?? "未实现";

  return (
    <button
      type="button"
      className={`card-tile ${selected ? "selected" : ""} ${info?.implemented ? "card-playable" : "state-unknown"}`}
      onClick={onSelect}
      onDoubleClick={onPlay}
      disabled={!canSelect}
      title={`${name} (${card.instanceId})`}
    >
      {info?.imageUrl ? (
        <img className="card-image" src={info.imageUrl} alt="" loading="lazy" />
      ) : null}
      <span className="card-cost">-</span>
      <span className="card-name">{name}</span>
      <span className="card-types">{typeLabel}</span>
      <span className="card-state">
        {info?.implemented
          ? canSelect
            ? "点击选中 · 双击打出"
            : "不可操作"
          : "能力未实现 · 需裁判"}
      </span>
    </button>
  );
}
