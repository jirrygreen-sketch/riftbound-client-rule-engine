import type {
  PlayerId,
  RoomDeckSubmission
} from "@riftbound/protocol";

export type FullProductRoomStatus = "waiting" | "playing" | "ended";

export interface FullProductSession {
  readonly roomId: string;
  readonly playerId: PlayerId;
  readonly resumeToken: string;
}

export interface FullProductConnection {
  readonly playerId: PlayerId;
  readonly resumeToken: string;
  readonly connectionId: string;
}

export interface FullProductSeatView {
  readonly id: PlayerId;
  readonly name: string;
  readonly connected: boolean;
  readonly ready: boolean;
  readonly deckSubmitted: boolean;
}

export interface FullProductMatchSummary {
  readonly version: number;
  readonly eventSeq: number;
  readonly phase: "main" | "ended";
  readonly turnNumber: number;
  readonly activePlayerId: PlayerId;
  readonly priorityPlayerId: PlayerId;
  readonly winnerPlayerId: PlayerId | null;
  readonly waitingForPlayerId: PlayerId | null;
}

export interface FullProductRoomView {
  readonly roomId: string;
  readonly status: FullProductRoomStatus;
  readonly version: number;
  readonly roomVersion: number;
  readonly roomEventSeq: number;
  readonly players: readonly FullProductSeatView[];
}

export interface FullProductDeckValidationResult {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

export type FullProductDeckValidator = (
  deck: RoomDeckSubmission
) => FullProductDeckValidationResult;

export interface FullProductTargetSelection {
  readonly targetKind: "object" | "player";
  readonly targetId: string;
}

export type FullProductClientCommand =
  | { readonly type: "pass" }
  | {
      readonly type: "play-card";
      readonly instanceId: string;
      readonly targets: readonly FullProductTargetSelection[];
    }
  | {
      readonly type: "respond-to-prompt";
      readonly promptId: string;
      readonly optionId: string;
      readonly targets: readonly FullProductTargetSelection[];
    }
  | { readonly type: "concede" };

export type FullProductRuntimeCommand =
  | ({ readonly playerId: PlayerId } & FullProductClientCommand);

export interface FullProductLegalAction {
  readonly type:
    | "pass"
    | "play-card"
    | "respond-to-prompt"
    | "concede";
  readonly playerId: PlayerId;
  readonly instanceId?: string;
  readonly promptId?: string;
  readonly optionId?: string;
  readonly targetInstanceId?: string;
}

export interface FullProductMatchResult {
  readonly winnerPlayerId: PlayerId | null;
  readonly reason: string;
  readonly finalVersion: number;
  readonly finalEventSeq: number;
}

export type FullProductRoomEvent =
  | { type: "room-created"; seq: number; roomId: string; playerId: PlayerId }
  | { type: "player-joined"; seq: number; roomId: string; playerId: PlayerId }
  | {
      type: "player-disconnected";
      seq: number;
      roomId: string;
      playerId: PlayerId;
    }
  | {
      type: "player-reconnected";
      seq: number;
      roomId: string;
      playerId: PlayerId;
    }
  | { type: "deck-submitted"; seq: number; roomId: string; playerId: PlayerId }
  | {
      type: "player-ready";
      seq: number;
      roomId: string;
      playerId: PlayerId;
      ready: boolean;
    }
  | { type: "match-started"; seq: number; roomId: string }
  | {
      type: "match-ended";
      seq: number;
      roomId: string;
      winnerPlayerId: PlayerId | null;
      playerId: PlayerId;
    };

export interface FullProductCommandReceipt {
  readonly commandId: string;
  readonly duplicate: boolean;
  readonly appliedVersion: number;
  readonly eventSeq: number;
  readonly roomVersion: number;
  readonly roomEventSeq: number;
}

export interface FullProductRoomReceipt {
  readonly roomVersion: number;
  readonly roomEventSeq: number;
}

export interface FullProductReplayState {
  readonly events: readonly unknown[];
  readonly nextEventSeq: number;
  readonly roomEvents: readonly FullProductRoomEvent[];
  readonly nextRoomEventSeq: number;
}
