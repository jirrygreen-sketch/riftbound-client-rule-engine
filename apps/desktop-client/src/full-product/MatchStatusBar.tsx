import type { GameProjection } from "@riftbound/protocol";
import type { PlayableMatchView } from "./types";

export interface MatchStatusBarProps {
  readonly view: PlayableMatchView;
}

export interface MatchStatusModel {
  readonly phase: string;
  readonly turn: number;
  readonly priority: string;
  readonly active: string;
  readonly result: string;
  readonly read_only: boolean;
}

export function buildMatchStatus(view: PlayableMatchView): MatchStatusModel {
  const projection: GameProjection = view.projection;
  const name = (playerId: string | null | undefined) =>
    playerId === null || playerId === undefined
      ? "-"
      : projection.players.find(player => player.id === playerId)?.name ?? playerId;
  return {
    phase: projection.phase,
    turn: projection.turnNumber,
    priority: name(projection.priority?.playerId ?? null),
    active: name(projection.activePlayerId),
    result:
      projection.winnerPlayerId === null
        ? "对局进行中"
        : `${name(projection.winnerPlayerId)} 获胜`,
    read_only:
      view.connectionStatus !== "connected" ||
      view.commandPending ||
      projection.phase === "ended"
  };
}

export function MatchStatusBar({ view }: MatchStatusBarProps) {
  const status = buildMatchStatus(view);
  return (
    <section className="full-product-status" aria-label="对局状态">
      <div>
        <span>阶段</span>
        <strong>{status.phase}</strong>
      </div>
      <div>
        <span>回合</span>
        <strong>{status.turn}</strong>
      </div>
      <div>
        <span>priority</span>
        <strong>{status.priority}</strong>
      </div>
      <div>
        <span>行动玩家</span>
        <strong>{status.active}</strong>
      </div>
      <div>
        <span>结果</span>
        <strong>{status.result}</strong>
      </div>
      <div>
        <span>模式</span>
        <strong>{status.read_only ? "只读" : "可交互"}</strong>
      </div>
    </section>
  );
}
