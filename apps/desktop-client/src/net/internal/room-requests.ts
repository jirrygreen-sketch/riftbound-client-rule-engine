import type { ClientToServerMessage, OwnerDeckConfirmationMessage } from "@riftbound/protocol";
import { setTimer, clearTimer } from "./timers";
import { requestIdOf } from "./utils";
import type {
  GameClientEmit,
  GameClientState,
  OwnerDeckConfirmation,
  PendingRoomRequest
} from "./types";

export const ROOM_REQUEST_TIMEOUT_MS = 10_000;

export function sendTrackedRequest(
  state: GameClientState,
  emit: GameClientEmit,
  message: ClientToServerMessage
): string | null {
  if (state.pendingRoomRequest !== null) {
    emit.handlers.onError("上一项房间请求仍在处理中，请稍候。");
    return null;
  }
  if (message.type !== "submit-deck" && message.type !== "set-ready") {
    return emit.send(message) ? requestIdOf(message) : null;
  }

  const session = state.session;
  if (!session) {
    emit.handlers.onError("尚未进入房间，操作未发送。");
    return null;
  }
  const pending: PendingRoomRequest = {
    requestId: message.requestId,
    requestType: message.type,
    ...(message.type === "set-ready" ? { ready: message.ready } : {}),
    roomId: session.roomId,
    playerId: session.playerId,
    socketGeneration: state.socketGeneration,
    resumeToken: session.resumeToken,
    timeoutTimer: null
  };
  state.pendingRoomRequest = pending;
  emit.handlers.onPendingRequest?.(true);
  if (!emit.send(message)) {
    clearPendingRequest(state, emit, false);
    return null;
  }
  pending.timeoutTimer = setTimer(() => {
    if (state.pendingRoomRequest !== pending) return;
    clearPendingRequest(state, emit, true);
    emit.handlers.onError("房间请求确认超时，请重试。");
  }, ROOM_REQUEST_TIMEOUT_MS);
  return message.requestId;
}

export function clearPendingRequest(state: GameClientState, emit: GameClientEmit, failed = true): void {
  const pending = state.pendingRoomRequest;
  if (!pending) return;
  state.pendingRoomRequest = null;
  if (pending.timeoutTimer !== null) clearTimer(pending.timeoutTimer);
  emit.handlers.onPendingRequest?.(false);
  if (failed) {
    emit.handlers.onRoomRequestFailure?.({
      requestId: pending.requestId,
      requestType: pending.requestType,
      roomId: pending.roomId,
      playerId: pending.playerId,
      socketGeneration: pending.socketGeneration
    });
  }
}

export function matchesCurrentRoomRequestContext(state: GameClientState, pending: PendingRoomRequest): boolean {
  return pending.socketGeneration === state.socketGeneration &&
    state.status === "connected" && state.handshakeReady &&
    state.socket?.readyState === WebSocket.OPEN &&
    state.session?.roomId === pending.roomId &&
    state.session.playerId === pending.playerId &&
    state.session.resumeToken === pending.resumeToken &&
    state.session.serverUrl === state.serverUrl;
}

export function acceptOwnerDeckConfirmation(
  state: GameClientState,
  emit: GameClientEmit,
  parsed: OwnerDeckConfirmationMessage,
  socketGeneration: number
): void {
  // Echo is state proof, never an ACK: do not mutate either pending request,
  // command namespace, retry or the recorded request-result here.
  if (!emit.matchesActiveSocketSession(socketGeneration, parsed.roomId) ||
      state.roomViewSocketGeneration !== socketGeneration ||
      state.session?.playerId !== parsed.playerId ||
      state.roomRulesetId !== parsed.rulesetId ||
      state.roomStatus !== state.roomViewStatus ||
      state.roomVersion !== parsed.roomVersion ||
      state.roomViewEventSeq !== parsed.roomEventSeq ||
      state.roomSelfDeckSubmitted !== (parsed.deck !== null)) return;
  const confirmation: OwnerDeckConfirmation = {
    ...parsed,
    deck: parsed.deck === null ? null : structuredClone(parsed.deck),
    catalog: { ...parsed.catalog },
    serverUrl: state.serverUrl,
    socketGeneration
  };
  state.ownerDeckConfirmation = confirmation;
  emit.handlers.onOwnerDeckConfirmation?.(confirmation);
}

export function clearOwnerDeckConfirmation(state: GameClientState, emit: GameClientEmit): void {
  if (state.ownerDeckConfirmation === null) return;
  state.ownerDeckConfirmation = null;
  emit.handlers.onOwnerDeckConfirmation?.(null);
}

export function clearOwnerRoomWitness(state: GameClientState, emit: GameClientEmit): void {
  clearOwnerDeckConfirmation(state, emit);
  state.pendingOwnerDeckEcho = null;
  state.roomSelfDeckSubmitted = null;
  state.roomViewSocketGeneration = null;
  state.roomViewEventSeq = null;
  state.roomViewStatus = null;
}

export function matchesActiveSocketSession(state: GameClientState, socketGeneration: number, roomId: string): boolean {
  return socketGeneration === state.socketGeneration &&
    state.status === "connected" && state.handshakeReady &&
    state.socket?.readyState === WebSocket.OPEN &&
    state.session !== null && state.session.roomId === roomId &&
    state.session.playerId.length > 0 && state.session.resumeToken.length > 0 &&
    state.session.serverUrl === state.serverUrl &&
    (state.roomRoster === null || state.roomRoster.has(state.session.playerId));
}
