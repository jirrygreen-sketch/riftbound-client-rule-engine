import { Coins, Heart, Layers, Swords } from "lucide-react";
import {
  TRIGGER_CONQUER_CARD,
  type CardInstance,
  type PlayerProjection
} from "@riftbound/protocol";

interface PlayerBoardProps {
  player: PlayerProjection | null;
  sideName: string;
  selectedCardId: string | null;
  onSelectCard?: (card: CardInstance) => void;
  viewerIsSelf: boolean;
  isActive: boolean;
}

export function PlayerBoard({
  player,
  sideName,
  selectedCardId,
  onSelectCard,
  viewerIsSelf,
  isActive
}: PlayerBoardProps) {
  const hand = viewerIsSelf ? (player?.hand ?? []) : [];

  return (
    <section className={`player-board ${viewerIsSelf ? "self" : "opponent"}`} aria-label={sideName}>
      <header className="player-header">
        <div>
          <h2>{player?.name ?? "等待玩家"}</h2>
          <p>
            {sideName}
            {isActive ? " · 当前回合" : ""}
          </p>
        </div>
        <dl className="resource-strip">
          <div>
            <dt><Heart size={15} aria-hidden />生命</dt>
            <dd>{player?.life ?? 0}</dd>
          </div>
          <div>
            <dt><Coins size={15} aria-hidden />资源</dt>
            <dd>{player?.mana ?? 0}</dd>
          </div>
          <div>
            <dt><Layers size={15} aria-hidden />手牌</dt>
            <dd>{player?.handCount ?? 0}</dd>
          </div>
          <div>
            <dt><Swords size={15} aria-hidden />身份</dt>
            <dd>{player?.id ?? "-"}</dd>
          </div>
        </dl>
      </header>

      <div className="zone-grid">
        <div className="zone">
          <h3>公开区域</h3>
          <div className="card-row">
            <span className="empty-zone">synthetic-demo 暂无基地与战场</span>
          </div>
        </div>
        <div className="zone">
          <h3>状态</h3>
          <div className="card-row">
            <span className="empty-zone">
              {player ? `${player.handCount} 张手牌` : "等待玩家加入"}
            </span>
          </div>
        </div>
      </div>

      <div className="hand-zone">
        <h3>{viewerIsSelf ? "我的手牌" : "对手手牌不可见"}</h3>
        <div className="card-row">
          {hand.length === 0 && viewerIsSelf ? (
            <span className="empty-zone">暂无可选手牌</span>
          ) : null}
          {hand.map(card => (
            <CardTile
              key={card.instanceId}
              card={card}
              selected={card.instanceId === selectedCardId}
              onSelect={viewerIsSelf && onSelectCard ? () => onSelectCard(card) : undefined}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function CardTile({
  card,
  selected,
  onSelect
}: {
  card: CardInstance;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const isTriggerConquer = card.cardId === TRIGGER_CONQUER_CARD.id;
  const name = isTriggerConquer ? TRIGGER_CONQUER_CARD.name : card.cardId;

  return (
    <button
      type="button"
      className={`card-tile ${selected ? "selected" : ""} ${
        isTriggerConquer ? "trigger-conquer" : ""
      }`}
      onClick={onSelect}
      disabled={!onSelect}
      title={`${name} (${card.instanceId})`}
    >
      <span className="card-cost">{isTriggerConquer ? TRIGGER_CONQUER_CARD.cost : "-"}</span>
      <span className="card-name">{name}</span>
      <span className="card-types">{card.cardId}</span>
      <span className="card-state">点击打出</span>
    </button>
  );
}
