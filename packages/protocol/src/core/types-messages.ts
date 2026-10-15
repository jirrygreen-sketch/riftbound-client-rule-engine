import type { ConstructedRegionSelection } from "../constructed-region-context.js";
import type { DuelCommandTransport, DuelProjectionMessageTransport } from "../duel-transport-contract.js";
import type { OwnerDeckConfirmationMessage } from "../owner-deck-confirmation.js";
import type { RoomChatClientMessage, RoomChatServerMessage } from "../room-chat.js";
import type { PlayerCommand, PlayerId, RoomId } from "./types-commands.js";
import type { GameEvent } from "./types-events.js";
import type { GameProjection } from "./types-projection.js";
import type {
  ClientSession,
  EngineErrorCode,
  RoomDeckSubmission,
  RoomEvent,
  RoomView
} from "./types-room.js";

export type ClientToServerMessage =
  | DuelCommandTransport
  | RoomChatClientMessage
  | {
      type: "hello";
      protocolVersion: string;
      roomId?: RoomId;
      resumeToken?: string;
      afterEventSeq?: number;
      afterRoomEventSeq?: number;
    }
  | {
      type: "create-room";
      requestId: string;
      playerName: string;
      rulesetId?: string;
      readonly constructedRegion?: ConstructedRegionSelection;
    }
  | { type: "join-room"; requestId: string; roomId: RoomId; playerName: string }
  | {
      type: "command";
      requestId: string;
      commandId: string;
      expectedVersion: number;
      command: PlayerCommand;
    }
  | {
      type: "submit-deck";
      requestId: string;
      expectedRoomVersion: number;
      deck: RoomDeckSubmission;
    }
  | {
      type: "set-ready";
      requestId: string;
      expectedRoomVersion: number;
      ready: boolean;
    }
  | {
      type: "sync-events";
      requestId: string;
      afterEventSeq?: number;
      afterRoomEventSeq?: number;
    }
  | { type: "ping" };

export type ErrorCode =
  | EngineErrorCode
  | "protocol-error"
  | "handshake-required"
  | "already-in-room"
  | "room-not-found"
  | "room-full"
  | "invalid-token"
  | "session-replaced"
  | "command-rejected"
  | "stale-version"
  | "idempotency-conflict"
  | "capacity-exceeded"
  | "invalid-deck";

export interface CommandReceipt {
  type: "request-result";
  requestId: string;
  ok: true;
  commandId?: string;
  appliedVersion?: number;
  eventSeq?: number;
  roomVersion?: number;
  roomEventSeq?: number;
  duplicate?: boolean;
}

export type ServerToClientMessage =
  | DuelProjectionMessageTransport
  | RoomChatServerMessage
  | OwnerDeckConfirmationMessage
  | {
      type: "welcome";
      protocolVersion: string;
      session?: ClientSession;
      resumed?: boolean;
    }
  | CommandReceipt
  | { type: "room"; room: RoomView }
  | { type: "projection"; roomId: RoomId; projection: GameProjection }
  | {
      type: "events";
      roomId: RoomId;
      afterEventSeq: number;
      nextEventSeq: number;
      version: number;
      events: readonly GameEvent[];
    }
  | {
      type: "room-events";
      roomId: RoomId;
      afterRoomEventSeq: number;
      nextRoomEventSeq: number;
      roomVersion: number;
      events: readonly RoomEvent[];
    }
  | { type: "error"; requestId?: string; code: ErrorCode; message: string }
  | { type: "pong" };

export type ServerTransport = (message: ServerToClientMessage) => void;
