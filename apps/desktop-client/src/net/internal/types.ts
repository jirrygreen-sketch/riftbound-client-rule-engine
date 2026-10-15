import {
  DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  type ClientSession,
  type ClientToServerMessage,
  type DuelProjectionTransport,
  type DuelWireCommandV3Actions1,
  type GameEvent,
  type GameProjection,
  type OwnerDeckConfirmationMessage,
  type PlayerCommand,
  type RoomChatMessage,
  type RoomEvent,
  type RoomView
} from "@riftbound/protocol";

export type GameClientStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export type RoomRequestType = "submit-deck" | "set-ready";

/**
 * A successful room request receipt after the transport has matched it to the
 * request context that was captured at send time. The session token is kept
 * private inside GameClient; these fields are the non-secret identity needed by
 * UI state machines to reject receipts from another room or actor.
 */
export interface RoomRequestReceipt {
  readonly requestId: string;
  readonly requestType: RoomRequestType;
  readonly roomId: string;
  readonly playerId: string;
  readonly socketGeneration: number;
  readonly ready?: boolean;
  readonly roomVersion?: number;
  readonly roomEventSeq?: number;
  readonly duplicate?: boolean;
}

export type RoomRequestFailure = Pick<RoomRequestReceipt,
  "requestId" | "requestType" | "roomId" | "playerId" | "socketGeneration">;

/** A validated echo bound to the actual WS generation and authenticated session. */
export interface OwnerDeckConfirmation extends OwnerDeckConfirmationMessage {
  readonly serverUrl: string;
  readonly socketGeneration: number;
}

export interface StoredSession extends ClientSession {
  serverUrl: string;
}

export interface PendingCommand {
  requestId: string;
  readonly commandId: string;
  readonly namespace: "legacy" | "duel";
  readonly duelCommandProfile?: typeof DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1;
  readonly command: PlayerCommand | DuelWireCommandV3Actions1;
  // Legacy commands may rebase their version/event clock onto the latest
  // confirmed legacy projection on retry; Duel commands keep them frozen.
  expectedVersion: number;
  eventSeq: number;
  readonly matchId: string | null;
  readonly roomId: string;
  readonly playerId: string;
  readonly resumeToken: string;
  readonly serverUrl: string;
  socketGeneration: number;
  readonly sentRequests: Map<string, number>;
  attempt: number;
  retryDue: boolean;
  timeoutTimer: number | null;
}

export interface PendingRoomRequest extends RoomRequestFailure {
  readonly resumeToken: string;
  readonly ready?: boolean;
  timeoutTimer: number | null;
}

export interface PendingChat {
  readonly messageId: string;
  readonly text: string;
  readonly session: StoredSession;
  requestId: string;
  socketGeneration: number;
  attempts: number;
  timer: number | null;
}

export interface DuelProjectionContext {
  roomId: string;
  playerId: string;
  resumeToken: string;
  serverUrl: string;
}

export interface DuelAcknowledgedClock {
  version: number;
  eventSeq: number;
  requireNewer: boolean;
}

export type CommandNamespace = "legacy" | "duel";

export interface GameClientState {
  status: GameClientStatus;
  socket: WebSocket | null;
  serverUrl: string;
  socketGeneration: number;
  session: StoredSession | null;
  latestProjectionVersion: number | null;
  duelProjection: DuelProjectionTransport | null;
  legacyProjectionSeen: boolean;
  duelProjectionContext: DuelProjectionContext | null;
  duelProjectionSocketGeneration: number | null;
  duelSchemaDowngradeLatched: boolean;
  duelMatchTransitionAllowed: boolean;
  readonly retiredDuelMatchIds: Set<string>;
  duelAcknowledgedClock: DuelAcknowledgedClock | null;
  activeNamespace: CommandNamespace | null;
  roomVersion: number | null;
  roomStatus: RoomView["status"] | null;
  roomRulesetId: RoomView["rulesetId"] | null;
  roomRoster: ReadonlySet<string> | null;
  roomSelfDeckSubmitted: boolean | null;
  roomViewSocketGeneration: number | null;
  roomViewEventSeq: number | null;
  roomViewStatus: RoomView["status"] | null;
  ownerDeckConfirmation: OwnerDeckConfirmation | null;
  pendingOwnerDeckEcho: OwnerDeckConfirmationMessage | null;
  latestEventSeq: number | null;
  latestRoomEventSeq: number | null;
  pendingCommand: PendingCommand | null;
  pendingRoomRequest: PendingRoomRequest | null;
  requestSeq: number;
  reconnectTimer: number | null;
  heartbeatTimer: number | null;
  reconnectAttempt: number;
  lastPongAt: number;
  intentionallyClosed: boolean;
  handshakeReady: boolean;
  helloSession: StoredSession | null;
  expectedSessionRequest: { requestId: string; socketGeneration: number } | null;
  chatMessages: readonly RoomChatMessage[];
  pendingChat: PendingChat | null;
}

export interface GameClientHandlers {
  onStatus: (status: GameClientStatus) => void;
  onSession: (session: ClientSession | null) => void;
  onProjection: (projection: GameProjection | null) => void;
  onDuelProjection?: (projection: DuelProjectionTransport | null) => void;
  onError: (message: string) => void;
  onRoom: (roomId: string | null) => void;
  onRoomView?: (room: RoomView | null) => void;
  onOwnerDeckConfirmation?: (confirmation: OwnerDeckConfirmation | null) => void;
  onEvents?: (events: readonly GameEvent[]) => void;
  onRoomEvents?: (events: readonly RoomEvent[]) => void;
  onRoomRequestResult?: (receipt: RoomRequestReceipt) => void;
  onRoomRequestFailure?: (request: RoomRequestFailure) => void;
  onHandshake: (ready: boolean) => void;
  onPendingCommand?: (pending: boolean) => void;
  onPendingRequest?: (pending: boolean) => void;
  onChatMessages?: (messages: readonly RoomChatMessage[]) => void;
  onChatPending?: (pending: boolean) => void;
  onChatError?: (message: string | null) => void;
}

/**
 * Cross-domain callbacks the GameClient facade supplies to the extracted
 * modules so they can coordinate with sibling domains without owning their
 * state. Each method is a verbatim move of the original GameClient private
 * method of the same name.
 */
export interface GameClientEmit {
  readonly handlers: GameClientHandlers;
  setStatus(status: GameClientStatus): void;
  setHandshakeReady(ready: boolean): void;
  applySession(session: StoredSession | null): void;
  clearOwnerRoomWitness(): void;
  clearPendingCommand(): void;
  clearPendingRequest(failed?: boolean): void;
  clearPendingChat(): void;
  clearDuelProjection(): void;
  preparePendingCommandForRetry(): void;
  retryPendingCommand(force?: boolean): void;
  syncChat(): void;
  sendPendingChat(): boolean;
  syncEvents(): boolean;
  acceptOwnerDeckConfirmation(
    parsed: OwnerDeckConfirmationMessage,
    socketGeneration: number
  ): void;
  refuseDuelSchemaDowngrade(): void;
  reconnectWithoutSession(): void;
  stopAfterSessionReplaced(): void;
  stopForProtocolMismatch(): void;
  startHeartbeat(): void;
  stopHeartbeat(): void;
  scheduleReconnect(): void;
  openSocket(status: GameClientStatus): void;
  sendHello(): void;
  handleMessage(raw: unknown, socketGeneration?: number): void;
  send(message: ClientToServerMessage): boolean;
  sendRaw(message: ClientToServerMessage): boolean;
  matchesActiveSocketSession(socketGeneration: number, roomId: string): boolean;
  matchesCurrentRoomRequestContext(pending: PendingRoomRequest): boolean;
  nextRequestId(prefix: string): string;
}


export function createInitialState(session: StoredSession | null): GameClientState {
  return {
    status: "idle",
    socket: null,
    serverUrl: "",
    socketGeneration: 0,
    session,
    latestProjectionVersion: null,
    duelProjection: null,
    legacyProjectionSeen: false,
    duelProjectionContext: null,
    duelProjectionSocketGeneration: null,
    duelSchemaDowngradeLatched: false,
    duelMatchTransitionAllowed: false,
    retiredDuelMatchIds: new Set<string>(),
    duelAcknowledgedClock: null,
    activeNamespace: null,
    roomVersion: null,
    roomStatus: null,
    roomRulesetId: null,
    roomRoster: null,
    roomSelfDeckSubmitted: null,
    roomViewSocketGeneration: null,
    roomViewEventSeq: null,
    roomViewStatus: null,
    ownerDeckConfirmation: null,
    pendingOwnerDeckEcho: null,
    latestEventSeq: null,
    latestRoomEventSeq: null,
    pendingCommand: null,
    pendingRoomRequest: null,
    requestSeq: 0,
    reconnectTimer: null,
    heartbeatTimer: null,
    reconnectAttempt: 0,
    lastPongAt: 0,
    intentionallyClosed: false,
    handshakeReady: false,
    helloSession: null,
    expectedSessionRequest: null,
    chatMessages: [],
    pendingChat: null
  };
}

