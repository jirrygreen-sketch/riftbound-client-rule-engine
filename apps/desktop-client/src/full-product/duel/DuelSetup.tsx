import type { DuelProjectionTransport, DuelWireSetupPlayer } from "@riftbound/protocol";
import {
  DUEL_CARD_ROLE_LANDSCAPE,
  DUEL_CHAMPION_ROLE_LABEL,
  DUEL_LEGEND_ROLE_LABEL,
  DUEL_MULLIGAN_OWNER_HINT,
  DUEL_SPECTATOR_HAND_NOTICE,
  nameFor
} from "./duel-board-model";
import { CardArt, IdentityRow } from "./DuelCardComponents";

export function HiddenHand({ playerName, count, spectator = false }: {
  readonly playerName: string;
  readonly count: number;
  readonly spectator?: boolean;
}) {
  return <div className="full-product-duel-hidden-hand" aria-label={`${playerName} 手牌区，共 ${count} 张，牌面隐藏`}>
    <span className="full-product-duel-hand-zone-label">{playerName}<br />手牌 {count}（背面）</span>
    <div className="full-product-duel-hand-backs" aria-hidden="true">
      {Array.from({ length: Math.min(count, 16) }, (_, index) => <span key={index} className="full-product-duel-card-back" />)}
      {count > 16 ? <span>＋{count - 16}</span> : null}
    </div>
    {spectator ? <span className="full-product-duel-empty">{DUEL_SPECTATOR_HAND_NOTICE}</span> : null}
  </div>;
}
export function SetupIdentityBand({
  seatId,
  player,
  hiddenHand,
  position,
  projection,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly seatId: string;
  readonly player: DuelWireSetupPlayer;
  readonly hiddenHand: boolean;
  readonly position: string;
  readonly projection: DuelProjectionTransport;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  const playerName = nameFor(projection, seatId);
  return (
    <section
      className="full-product-duel-base full-product-duel-setup-seat"
      data-position={position}
      data-owner-player-id={seatId}
      aria-label={`${playerName} 准备信息`}
    >
      <header className="full-product-duel-base-head">
        <h4 className="full-product-duel-base-title">{playerName} 基地</h4>
      </header>
      <dl className="full-product-duel-setup-identity">
        <IdentityRow
          role={DUEL_LEGEND_ROLE_LABEL}
          cardId={player.legend.cardId}
          resolveCardTitle={resolveCardTitle}
          resolveCardImage={resolveCardImage}
          onInspect={onInspect}
        />
        <IdentityRow
          role={DUEL_CHAMPION_ROLE_LABEL}
          cardId={player.champion.cardId}
          resolveCardTitle={resolveCardTitle}
          resolveCardImage={resolveCardImage}
          onInspect={onInspect}
        />
        <div>
          <dt>调度</dt>
          <dd>{player.mulliganStatus === "pending" ? "待调度" : "已完成"}</dd>
        </div>
      </dl>
      {/* Setup never fabricates a base-rune board: running a mulligan has not
          placed any rune yet, so only the real stage information is shown. */}
    </section>
  );
}
export function SetupBattlefieldCard({
  cardId,
  instanceId,
  ownerLabel,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly cardId: string;
  readonly instanceId: string;
  readonly ownerLabel: string;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  const title = resolveCardTitle(cardId);
  return (
    <section
      className="full-product-duel-battlefield"
      data-instance-id={instanceId}
      aria-label={`已选战场 ${title}`}
    >
      <header className="full-product-duel-battlefield-head">
        <h4 className="full-product-duel-battlefield-title">{title}</h4>
        <div className="full-product-duel-battlefield-tags">
          <span>选择者：{ownerLabel}</span>
        </div>
      </header>
      <CardArt
        cardId={cardId}
        resolveCardTitle={resolveCardTitle}
        resolveCardImage={resolveCardImage}
        className="full-product-duel-battlefield-thumb"
        cardRole={DUEL_CARD_ROLE_LANDSCAPE}
        onInspect={onInspect}
      />
    </section>
  );
}
