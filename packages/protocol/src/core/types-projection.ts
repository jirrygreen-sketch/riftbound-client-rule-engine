import type {
  CardInstance,
  CommandTarget,
  GamePhase,
  PlayerCommand,
  PlayerId
} from "./types-commands.js";
import type { GameEvent, Prompt } from "./types-events.js";

export const PROJECTION_SCHEMA_V1 = "riftbound.projection.v1";

export const PROJECTION_ZONES = [
  "base", "board", "battlefield", "champion", "legend", "rune",
  "hand", "deck", "rune-deck", "discard", "banish", "chain"
] as const;

export type ProjectionZone = (typeof PROJECTION_ZONES)[number];

export interface ProjectionObject {
  objectId: string;
  cardId: string;
  zone: ProjectionZone;
  controllerId: PlayerId;
  ownerPlayerId: PlayerId;
  faceUp: boolean;
  counters?: Readonly<Record<string, number>>;
  damage?: number;
}

export interface PlayerProjection {
  id: PlayerId;
  name: string;
  /** Legacy synthetic-demo values only. Foundation uses score and energy. */
  life?: number;
  mana?: number;
  score?: number;
  energy?: number;
  power?: Readonly<Record<string, number>>;
  zoneCounts?: Readonly<Partial<Record<ProjectionZone, number>>>;
  playableInstanceIds?: readonly string[];
  handCount: number;
  hand: readonly CardInstance[];
}

export interface GameProjection {
  projectionSchema?: typeof PROJECTION_SCHEMA_V1;
  rulesetId?: string;
  priority?: { playerId: PlayerId };
  objects?: readonly ProjectionObject[];
  actionOptions?: ProjectionActionOptions;
  version: number;
  eventSeq: number;
  phase: GamePhase;
  turnNumber: number;
  activePlayerId: PlayerId;
  winnerPlayerId: PlayerId | null;
  prompt: Prompt | null;
  waitingForPlayerId: PlayerId | null;
  players: readonly PlayerProjection[];
  events: readonly GameEvent[];
}

export const ACTION_OPTIONS_CONTRACT = "riftbound.action-options.v1";

export interface ProjectionActionTargetPolicy {
  readonly minTargets: number;
  readonly maxTargets: number;
  readonly options: readonly CommandTarget[];
}

/** Commands and selectable targets come from the authoritative viewer projection. */
export interface ProjectionAction {
  readonly id: string;
  readonly command: PlayerCommand;
  readonly targetPolicy: ProjectionActionTargetPolicy;
  readonly enabled: boolean;
  readonly blockedReason?: string;
}

export interface ProjectionActionOptions {
  readonly contract: typeof ACTION_OPTIONS_CONTRACT;
  readonly stateVersion: number;
  readonly viewerPlayerId: PlayerId | null;
  readonly actions: readonly ProjectionAction[];
}
