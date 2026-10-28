import { useEffect } from "react";
import type { DuelPublicChainCardV3Actions1, DuelWireScoring } from "@riftbound/protocol";
import {
  DUEL_CHAIN_LABEL,
  DUEL_PREVIEW_CLOSE_LABEL,
  DUEL_PREVIEW_CLOSE_TEXT,
  DUEL_PREVIEW_LABEL,
  DUEL_PREVIEW_NO_IMAGE_NOTICE,
  DUEL_SCORE_OVERFLOW_LABEL,
  DUEL_SCORE_TRACK_LABEL,
  DUEL_SCORE_VICTORY_ARIA
} from "./duel-board-model";
import { duelScoreMarkerLabel, scoreTrackValues } from "./DuelBoardViewModel";
import { CardArt } from "./DuelCardComponents";
import { CardText, type CardTextData } from "./card-text";

export function PublicChainPanel({
  cards,
  nameOf,
  resolveCardTitle,
  resolveCardImage,
  onInspect
}: {
  readonly cards: readonly DuelPublicChainCardV3Actions1[];
  readonly nameOf: (playerId: string) => string;
  readonly resolveCardTitle: (cardId: string) => string;
  readonly resolveCardImage?: (cardId: string) => string | null;
  readonly onInspect?: (cardId: string) => void;
}) {
  return (
    <section className="full-product-duel-chain" aria-label={DUEL_CHAIN_LABEL}>
      <h3 className="full-product-duel-chain-title">{DUEL_CHAIN_LABEL}</h3>
      <ol className="full-product-duel-chain-list">
        {cards.map((card, index) => (
          <li key={`${card.cardId}:${card.controllerPlayerId}:${card.status}:${index}`} className="full-product-duel-chain-card">
            <CardArt cardId={card.cardId} resolveCardTitle={resolveCardTitle}
              resolveCardImage={resolveCardImage} className="full-product-duel-chain-thumb" onInspect={onInspect} />
            <span className="full-product-duel-chain-name">{resolveCardTitle(card.cardId)}</span>
            <span className="full-product-duel-chain-meta">{nameOf(card.controllerPlayerId)} · {card.status === "pending" ? "待结算" : "已确认"}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
/**
 * The playing-stage wire match the board reads from. V1 and V2 are identical
 * except for `schemaVersion`; V3 adds the public permanent fields (Legend
 * readiness/controller and `board.gears`). Reads accept all three without
 * widening `schemaVersion` away, and the V3-only fields are gated behind an
 * explicit `schemaVersion === 3` check — never a cast or a schema downgrade.
 */
export function DuelScoreRail({
  scoring,
  nameOf
}: {
  readonly scoring: DuelWireScoring;
  readonly nameOf: (playerId: string) => string;
}) {
  const goal = scoring.victoryScore;
  const ticks = [...scoreTrackValues(goal)].reverse();
  const overflow = scoring.players.filter(player => player.points > goal);
  const marker = (playerId: string, points: number) => {
    const name = nameOf(playerId);
    return (
      <span
        key={playerId}
        className="full-product-duel-score-chip"
        data-player-id={playerId}
        data-points={points}
        title={`${name} ${points} 分`}
        aria-label={`${name} 积分 ${points}`}
      >
        <span className="full-product-duel-score-chip-name">{duelScoreMarkerLabel(name)}</span>
        <span className="full-product-duel-score-chip-points">{points}</span>
      </span>
    );
  };
  return (
    <div className="full-product-duel-score" aria-label={DUEL_SCORE_TRACK_LABEL}>
      {overflow.length > 0 ? (
        <div className="full-product-duel-score-overflow" aria-label={DUEL_SCORE_OVERFLOW_LABEL}>
          {overflow.map(player => marker(player.playerId, player.points))}
        </div>
      ) : null}
      <ol className="full-product-duel-score-ticks">
        {ticks.map(value => (
          <li
            key={value}
            className="full-product-duel-score-tick"
            data-tick={value}
            data-goal={value === goal ? "true" : undefined}
            aria-label={value === goal ? DUEL_SCORE_VICTORY_ARIA : undefined}
          >
            <span className="full-product-duel-score-tick-value">{value}</span>
            {scoring.players
              .filter(player => player.points === value)
              .map(player => marker(player.playerId, player.points))}
          </li>
        ))}
      </ol>
    </div>
  );
}
export function CardPreviewOverlay({
  cardId,
  title,
  imageUrl,
  cardText,
  onClose
}: {
  readonly cardId: string;
  readonly title: string;
  readonly imageUrl: string | null;
  readonly cardText?: CardTextData;
  readonly onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div className="full-product-duel-preview" role="dialog" aria-modal="true" aria-label={DUEL_PREVIEW_LABEL}>
      <div className="full-product-duel-preview-body" data-card-id={cardId}>
        <h3 className="full-product-duel-preview-title">{title}</h3>
        {imageUrl !== null ? (
          <img className="full-product-duel-preview-image" src={imageUrl} alt={title} />
        ) : (
          <p className="full-product-duel-preview-missing">{DUEL_PREVIEW_NO_IMAGE_NOTICE}</p>
        )}
        {cardText ? <CardText card={cardText} /> : null}
        <button
          type="button"
          className="full-product-duel-preview-close"
          aria-label={DUEL_PREVIEW_CLOSE_LABEL}
          onClick={onClose}
        >
          {DUEL_PREVIEW_CLOSE_TEXT}
        </button>
      </div>
    </div>
  );
}
