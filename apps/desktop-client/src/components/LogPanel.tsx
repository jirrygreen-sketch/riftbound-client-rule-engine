import { ScrollText, Zap } from "lucide-react";
import type { GameEvent } from "@riftbound/protocol";

export function LogPanel({ log }: { log: readonly GameEvent[] }) {
  return (
    <section className="log-panel" aria-label="事件日志">
      <div className="panel-title">
        <ScrollText size={16} aria-hidden />
        <h2>事件日志</h2>
      </div>
      <ol className="log-list">
        {log.length === 0 ? <li className="empty-zone">等待服务端事件</li> : null}
        {log.map(entry => (
          <li key={entry.seq} className={entry.type === "task-resolved" ? "auto-trigger" : undefined}>
            <span className="log-seq">#{entry.seq}</span>
            <span>{eventText(entry)}</span>
            {entry.type === "task-resolved" ? (
              <span className="auto-reason">
                <Zap size={14} aria-hidden />
                自动结算
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function eventText(event: GameEvent): string {
  switch (event.type) {
    case "game-started":
      return `对局开始：${event.playerIds.join(" / ")}`;
    case "turn-started":
      return `${event.playerId} 回合开始，能量 ${event.energy ?? event.mana ?? "-"}`;
    case "card-played":
      return `${event.playerId} 打出 ${event.cardId}`;
    case "prompt-created":
      return `${event.playerId} 收到 Prompt：${event.reason}`;
    case "prompt-answered":
      return `${event.playerId} 选择 ${event.optionId}`;
    case "damage-dealt":
      return `${event.sourcePlayerId} 对 ${event.targetPlayerId} 造成 ${event.amount} 点伤害`;
    case "points-gained":
      return `${event.sourcePlayerId} 使 ${event.targetPlayerId} 获得 ${event.amount} 分`;
    case "task-resolved":
      return `任务自动结算：${event.reason}`;
    case "trigger-skipped":
      return `跳过触发：${event.sourceCardId}`;
    case "turn-passed":
      return `${event.playerId} 跳过回合`;
    case "game-ended":
      return `${event.winnerPlayerId} 获胜`;
  }
}
