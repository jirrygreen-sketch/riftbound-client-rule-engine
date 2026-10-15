import type { PlayerId } from "./types-commands.js";

export interface BaseEvent {
  seq: number;
  turnNumber: number;
  activePlayerId: PlayerId;
}

export interface GameStartedEvent extends BaseEvent {
  type: "game-started";
  playerIds: readonly PlayerId[];
}

export interface TurnStartedEvent extends BaseEvent {
  type: "turn-started";
  playerId: PlayerId;
  mana?: number;
  energy?: number;
}

export interface CardPlayedEvent extends BaseEvent {
  type: "card-played";
  playerId: PlayerId;
  instanceId: string;
  cardId: string;
}

export interface PromptCreatedEvent extends BaseEvent {
  type: "prompt-created";
  promptId: string;
  playerId: PlayerId;
  reason: string;
  optional: boolean;
}

export interface PromptAnsweredEvent extends BaseEvent {
  type: "prompt-answered";
  promptId: string;
  playerId: PlayerId;
  optionId: string;
}

export interface DamageDealtEvent extends BaseEvent {
  type: "damage-dealt";
  sourceCardId: string;
  sourcePlayerId: PlayerId;
  targetPlayerId: PlayerId;
  amount: number;
  targetObjectId?: string;
}

export interface PointsGainedEvent extends BaseEvent {
  type: "points-gained";
  sourceCardId: string;
  sourcePlayerId: PlayerId;
  targetPlayerId: PlayerId;
  amount: number;
}

export interface TaskResolvedEvent extends BaseEvent {
  type: "task-resolved";
  taskId: string;
  sourceCardId: string;
  reason: string;
  autoResolved: true;
}

export interface TriggerSkippedEvent extends BaseEvent {
  type: "trigger-skipped";
  taskId: string;
  sourceCardId: string;
}

export interface TurnPassedEvent extends BaseEvent {
  type: "turn-passed";
  playerId: PlayerId;
}

export interface GameEndedEvent extends BaseEvent {
  type: "game-ended";
  winnerPlayerId: PlayerId;
}

export type GameEvent =
  | GameStartedEvent
  | TurnStartedEvent
  | CardPlayedEvent
  | PromptCreatedEvent
  | PromptAnsweredEvent
  | DamageDealtEvent
  | PointsGainedEvent
  | TaskResolvedEvent
  | TriggerSkippedEvent
  | TurnPassedEvent
  | GameEndedEvent;

export interface PromptOption {
  id: string;
  label: string;
}

export interface Prompt {
  id: string;
  /**
   * The owner/responder of this prompt. `playerId` is retained as the wire
   * name; `ownerPlayerId` makes the authorization rule explicit.
   */
  ownerPlayerId: PlayerId;
  playerId: PlayerId;
  stateVersion: number;
  status: "pending";
  taskId: string;
  reason: string;
  optional: boolean;
  options: readonly PromptOption[];
}
