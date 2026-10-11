import type {
  CardInstance,
  GameEvent,
  PlayerId,
  Prompt
} from "@riftbound/protocol";

export interface PlayerState {
  id: PlayerId;
  name: string;
  life: number;
  mana: number;
  hand: CardInstance[];
}

export interface OutstandingTask {
  id: string;
  sourceCardId: string;
  reason: string;
  optional: boolean;
}

export interface GameState {
  version: number;
  eventSeq: number;
  turnNumber: number;
  phase: "main" | "ended";
  activePlayerId: PlayerId;
  winnerPlayerId: PlayerId | null;
  players: readonly PlayerState[];
  prompt: Prompt | null;
  outstandingTasks: OutstandingTask[];
  eventLog: GameEvent[];
}
