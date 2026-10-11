import { Activity, Clock3, Crown } from "lucide-react";
import type { GameEvent, GameProjection } from "@riftbound/protocol";

interface ChainPanelProps {
  projection: GameProjection | null;
}

export function ChainPanel({ projection }: ChainPanelProps) {
  const nameFor = (playerId: string | null | undefined) => {
    if (!playerId) return "无";
    return projection?.players.find(player => player.id === playerId)?.name ?? playerId;
  };

  const recentEvents = projection?.events.slice(-5).reverse() ?? [];

  return (
    <section className="chain-panel" aria-label="规则状态与结算链">
      <header className="status-band">
        <div>
          <span>回合</span>
          <strong>{projection?.turnNumber ?? "-"}</strong>
        </div>
        <div>
          <span>阶段</span>
          <strong>{projection?.phase === "ended" ? "已结束" : "进行中"}</strong>
        </div>
        <div>
          <span>行动玩家</span>
          <strong>{nameFor(projection?.activePlayerId)}</strong>
        </div>
        <div>
          <span>等待玩家</span>
          <strong>{nameFor(projection?.waitingForPlayerId)}</strong>
        </div>
        <div>
          <span>版本</span>
          <strong>{projection?.version ?? "-"}</strong>
        </div>
        <div>
          <span>胜者</span>
          <strong>{nameFor(projection?.winnerPlayerId)}</strong>
        </div>
      </header>

      <div className="chain-list">
        <div className="panel-title">
          <Activity size={16} aria-hidden />
          <h2>最近结算</h2>
        </div>
        {recentEvents.length === 0 ? (
          <p className="empty-zone">等待服务端事件</p>
        ) : null}
        {recentEvents.map(event => (
          <article key={event.seq} className={`chain-item ${eventClass(event)}`}>
            <div>
              <h3>
                {event.type === "game-ended" ? (
                  <>
                    <Crown size={14} aria-hidden /> {nameFor(event.winnerPlayerId)}
                  </>
                ) : (
                  eventTitle(event)
                )}
              </h3>
              <p>{eventDetail(event, nameFor)}</p>
            </div>
            <span className="chain-badge">
              {event.type === "task-resolved" ? (
                <Clock3 size={14} aria-hidden />
              ) : (
                <Activity size={14} aria-hidden />
              )}
              #{event.seq}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

function eventClass(event: GameEvent): string {
  if (event.type === "game-ended") return "chain-resolved";
  if (event.type === "prompt-created") return "chain-pending";
  if (event.type === "task-resolved") return "chain-finalized";
  return "chain-resolving";
}

function eventTitle(event: GameEvent): string {
  switch (event.type) {
    case "game-started":
      return "对局开始";
    case "turn-started":
      return "回合开始";
    case "card-played":
      return "打出卡牌";
    case "prompt-created":
      return "等待 Prompt";
    case "prompt-answered":
      return "已响应 Prompt";
    case "damage-dealt":
      return "造成伤害";
    case "task-resolved":
      return "自动结算";
    case "trigger-skipped":
      return "跳过触发";
    case "turn-passed":
      return "跳过回合";
    case "game-ended":
      return "对局结束";
  }
}

function eventDetail(
  event: GameEvent,
  playerName: (playerId: string) => string
): string {
  switch (event.type) {
    case "game-started":
      return event.playerIds.map(playerName).join(" vs ");
    case "turn-started":
      return `${playerName(event.playerId)} · ${event.mana} 资源`;
    case "card-played":
      return `${playerName(event.playerId)} · ${event.cardId}`;
    case "prompt-created":
      return `${playerName(event.playerId)} · ${event.reason}`;
    case "prompt-answered":
      return `${playerName(event.playerId)} · ${event.optionId}`;
    case "damage-dealt":
      return `${playerName(event.sourcePlayerId)} → ${playerName(event.targetPlayerId)} · ${event.amount}`;
    case "task-resolved":
      return `${event.reason} · 自动`;
    case "trigger-skipped":
      return event.sourceCardId;
    case "turn-passed":
      return playerName(event.playerId);
    case "game-ended":
      return `${playerName(event.winnerPlayerId)} 获胜`;
  }
}
