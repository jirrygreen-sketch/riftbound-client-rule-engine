import { Hand, Play, SkipForward } from "lucide-react";
import type { CardInstance } from "@riftbound/protocol";

interface ActionBarProps {
  selectedCard: CardInstance | null;
  canAct: boolean;
  canPlay: boolean;
  blockedReason: string | null;
  onPass: () => void;
  onPlayCard: (instanceId: string) => void;
  selectedCardLabel: string;
}

export function ActionBar({
  selectedCard,
  canAct,
  canPlay,
  blockedReason,
  onPass,
  onPlayCard,
  selectedCardLabel
}: ActionBarProps) {
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
        disabled={!canPlay}
        title={blockedReason ?? `打出 ${selectedCardLabel}`}
      >
        <Play size={16} aria-hidden />
        打出卡牌
      </button>
      <div className="selected-card">
        <Hand size={16} aria-hidden />
        <span>
          {selectedCard ? selectedCardLabel : "未选择手牌"}
        </span>
      </div>
    </section>
  );
}
