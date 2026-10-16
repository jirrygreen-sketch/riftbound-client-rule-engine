import type {
  V2Command,
  V2CommandBase,
  V2EngineEvent,
  V2Projection,
  V2ServerMessage,
  V2CommandReceipt
} from "../../../../../packages/protocol/src/v2/index.js";

/** The small WebSocket surface used by the transport and its tests. */
export interface V2Socket {
  readonly readyState?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type V2SocketFactory = (url: string) => V2Socket;

export type V2CommandRequest = {
  [Type in V2Command["type"]]: Omit<Extract<V2Command, { readonly type: Type }>, keyof V2CommandBase> &
    Partial<V2CommandBase>
}[V2Command["type"]];

export type V2TransportStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

export interface V2ResumeCursor {
  readonly stateVersion: number;
  readonly eventSeq: number;
}

export interface V2TransportError {
  readonly code: "invalid-message" | "invalid-command" | "socket" | "closed";
  readonly message: string;
  readonly raw?: unknown;
}

export type V2TransportEvent =
  | { readonly type: "status"; readonly status: V2TransportStatus }
  | { readonly type: "projection"; readonly projection: V2Projection }
  | { readonly type: "event"; readonly event: V2EngineEvent }
  | { readonly type: "receipt"; readonly receipt: V2CommandReceipt }
  | { readonly type: "error"; readonly error: V2TransportError };

