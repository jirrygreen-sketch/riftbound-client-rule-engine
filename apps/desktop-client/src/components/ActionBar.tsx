import { Hand, Play, SkipForward } from "lucide-react";
import { TRIGGER_CONQUER_CARD, type CardInstance } from "@riftbound/protocol";

interface ActionBarProps {
  selectedCard: CardInstance | null;
  canAct: boolean;
  canPlay: boolean;
  blockedReason: string | null;
  onPass: () => void;
  onPlayCard: (instanceId: string) => void;
}

export function ActionBar({
  selectedCard,
  canAct,
  canPlay,
  blockedReason,
  onPass,
  onPlayCard
}: ActionBarProps) {
  const playable =
    canPlay &&
    selectedCard?.cardId === TRIGGER_CONQUER_CARD.id;

  return (
    <section className="action-bar" aria-label="行动控制">
      <button type="button" className="button" onClick={onPass} disabled={!canAct}>
        <SkipForward size={16} aria-hidden />
        跳过回合
      </button>
      <button
        type="button"
        className="button primary"
        onClick={() => selectedCard && onPlayCard(selectedCard.instanceId)}
        disabled={!playable}
        title={blockedReason ?? `打出 ${TRIGGER_CONQUER_CARD.name}`}
      >
        <Play size={16} aria-hidden />
        打出卡牌
      </button>
      <div className="selected-card">
        <Hand size={16} aria-hidden />
        <span>
          {selectedCard
            ? selectedCard.cardId === TRIGGER_CONQUER_CARD.id
              ? TRIGGER_CONQUER_CARD.name
              : selectedCard.cardId
            : "未选择手牌"}
        </span>
      </div>
    </section>
  );
}
