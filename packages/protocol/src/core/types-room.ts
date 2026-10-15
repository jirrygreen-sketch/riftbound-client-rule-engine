import type { ConstructedRegionContext } from "../constructed-region-context.js";
import { DUEL_RULESET_ID } from "../duel-contract.js";
import type {
  CardDefinition,
  PlayerId,
  PlayerIdentity,
  RoomId
} from "./types-commands.js";
import type { GameProjection } from "./types-projection.js";

export interface RoomPlayer extends PlayerIdentity {
  connected: boolean;
  ready: boolean;
  deckSubmitted: boolean;
}

export interface RoomSnapshot {
  roomId: RoomId;
  status: "playing" | "ended";
  players: readonly RoomPlayer[];
  version: number;
  roomVersion: number;
  roomEventSeq: number;
  eventSeq: number;
  projection: GameProjection;
  roomEvents: readonly RoomEvent[];
}

export type EngineErrorCode =
  | "invalid_command"
  | "not_your_turn"
  | "prompt_required"
  | "prompt_not_found"
  | "prompt_expired"
  | "invalid_prompt_answer"
  | "card_not_found"
  | "not_enough_mana"
  | "judge_required"
  | "game_ended";

export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

export const TRIGGER_CONQUER_CARD: CardDefinition = {
  id: "card.trigger-conquer",
  name: "Trigger Conquer",
  cost: 1
};

export const ENGINE_ERRORS = {
  invalidCommand: "invalid_command",
  notYourTurn: "not_your_turn",
  promptRequired: "prompt_required",
  promptNotFound: "prompt_not_found",
  promptExpired: "prompt_expired",
  invalidPromptAnswer: "invalid_prompt_answer",
  cardNotFound: "card_not_found",
  notEnoughMana: "not_enough_mana",
  judgeRequired: "judge_required",
  gameEnded: "game_ended"
} as const satisfies Record<string, EngineErrorCode>;

export const PROTOCOL_VERSION = "0.2.1";
export const RULESET_ID = "synthetic-demo";
export const FOUNDATION_RULESET_ID = "riftbound-foundation";
/** Kept as an import alias; this slice does not claim full official support. */
export const OFFICIAL_RULESET_ID = FOUNDATION_RULESET_ID;
export const RULESET_IDS = [
  RULESET_ID,
  OFFICIAL_RULESET_ID,
  DUEL_RULESET_ID
] as const satisfies readonly string[];

export interface ClientSession {
  roomId: RoomId;
  playerId: PlayerId;
  resumeToken: string;
}

export interface RoomView {
  readonly constructedRegion?: ConstructedRegionContext;
  roomId: RoomId;
  status: "waiting" | "playing" | "ended";
  rulesetId: string;
  version: number;
  roomVersion: number;
  roomEventSeq: number;
  players: readonly RoomPlayer[];
}

export type RoomEvent =
  | { type: "room-created"; seq: number; roomId: RoomId; playerId: PlayerId }
  | { type: "player-joined"; seq: number; roomId: RoomId; playerId: PlayerId }
  | { type: "player-disconnected"; seq: number; roomId: RoomId; playerId: PlayerId }
  | { type: "player-reconnected"; seq: number; roomId: RoomId; playerId: PlayerId }
  | { type: "deck-submitted"; seq: number; roomId: RoomId; playerId: PlayerId }
  | { type: "player-ready"; seq: number; roomId: RoomId; playerId: PlayerId; ready: boolean }
  | { type: "game-started"; seq: number; roomId: RoomId };

export type DeckZoneName =
  | "mainDeck"
  | "runes"
  | "legend"
  | "champion"
  | "battlefields"
  | "sideboard";

export interface DeckWireEntry {
  cardId: string;
  quantity: number;
}

export type RoomDeckSubmission = Readonly<
  Partial<Record<DeckZoneName, readonly DeckWireEntry[]>>
>;
