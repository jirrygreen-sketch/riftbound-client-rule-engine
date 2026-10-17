import type {
  V2EngineEvent,
  V2Projection,
  V2ServerMessage
} from "../../../../../packages/protocol/src/v2/index.js";
import type { V2ChoiceUiState } from "./choice.js";

export type V2ClientConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface V2ClientState {
  readonly viewerPlayerId: string | null;
  readonly projection: V2Projection | null;
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly events: readonly V2EngineEvent[];
  readonly bufferedEvents: readonly V2EngineEvent[];
  readonly choice: V2ChoiceUiState;
  readonly connectionStatus: V2ClientConnectionStatus;
  readonly lastError: string | null;
  readonly rejectedMessages: number;
}

export interface V2StateOptions {
  readonly viewerPlayerId?: string | null;
  readonly choiceTimeoutMs?: number;
  readonly now?: number;
}

export interface V2ApplyResult {
  readonly accepted: boolean;
  readonly duplicate: boolean;
  readonly buffered: boolean;
  readonly reason?: string;
  readonly state: V2ClientState;
}

export type V2StateMessage = V2ServerMessage;

