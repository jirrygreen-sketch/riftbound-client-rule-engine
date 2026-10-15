import {
  PROTOCOL_VERSION,
  type ClientToServerMessage
} from "@riftbound/protocol";
import { setTimer, clearTimer, setInterval, clearIntervalTimer } from "./timers";
import { writeSession } from "./session";
import type { GameClientEmit, GameClientState, GameClientStatus, StoredSession } from "./types";

export const MAX_RECONNECT_DELAY_MS = 15_000;
export const HEARTBEAT_INTERVAL_MS = 20_000;
export const HEARTBEAT_TIMEOUT_MS = 50_000;

export function openSocket(state: GameClientState, emit: GameClientEmit, status: GameClientStatus): void {
  if (!state.serverUrl) return;

  clearReconnectTimer(state);
  stopHeartbeat(state);
  emit.setHandshakeReady(false);
  state.helloSession = null;
  state.expectedSessionRequest = null;
  emit.clearOwnerRoomWitness();
  emit.preparePendingCommandForRetry();
  state.latestProjectionVersion = null;
  state.duelProjectionSocketGeneration = null;
  // A new socket starts a fresh episode: the next refused downgrade frame
  // gets its own single error/resync rather than inheriting a prior latch.
  state.duelSchemaDowngradeLatched = false;
  if (status === "connecting") {
    emit.handlers.onProjection(null);
  }

  const previous = state.socket;
  state.socket = null;
  previous?.close();
  emit.setStatus(status);

  let socket: WebSocket;
  const socketGeneration = ++state.socketGeneration;
  try {
    socket = new WebSocket(state.serverUrl);
  } catch {
    emit.handlers.onError("无法连接游戏服务端，请检查地址后重试。");
    scheduleReconnect(state, emit);
    return;
  }
  state.socket = socket;

  socket.addEventListener("open", () => {
    if (state.socket !== socket || state.socketGeneration !== socketGeneration) return;
    sendHello(state, emit);
  });

  socket.addEventListener("message", event => {
    if (state.socket !== socket || state.socketGeneration !== socketGeneration) return;
    emit.handleMessage(event.data, socketGeneration);
  });

  socket.addEventListener("close", () => {
    if (state.socket !== socket || state.socketGeneration !== socketGeneration) return;
    state.socket = null;
    stopHeartbeat(state);
    emit.setHandshakeReady(false);
    emit.clearOwnerRoomWitness();
    emit.preparePendingCommandForRetry();
    state.latestProjectionVersion = null;
    state.duelProjectionSocketGeneration = null;
    state.duelSchemaDowngradeLatched = false;
    if (state.intentionallyClosed) {
      emit.setStatus("disconnected");
      return;
    }
    scheduleReconnect(state, emit);
  });

  socket.addEventListener("error", () => {
    if (state.socket !== socket || state.socketGeneration !== socketGeneration) return;
    emit.setHandshakeReady(false);
    emit.clearOwnerRoomWitness();
    emit.preparePendingCommandForRetry();
    state.duelProjectionSocketGeneration = null;
    state.duelSchemaDowngradeLatched = false;
    emit.handlers.onError("无法连接游戏服务端，请检查地址或稍后重试。");
  });
}

export function sendHello(state: GameClientState, emit: GameClientEmit): void {
  state.helloSession = state.session?.serverUrl === state.serverUrl ? state.session : null;
  const resume =
    state.session?.serverUrl === state.serverUrl
      ? {
          roomId: state.session.roomId,
          resumeToken: state.session.resumeToken
        }
      : {};

  sendRaw(state, emit, {
    type: "hello",
    protocolVersion: PROTOCOL_VERSION,
    ...resume,
    ...(resume.roomId === undefined
      ? {}
      : {
          ...(state.activeNamespace === "duel" || state.latestEventSeq === null
            ? {}
            : { afterEventSeq: state.latestEventSeq }),
          ...(state.latestRoomEventSeq === null
            ? {}
            : { afterRoomEventSeq: state.latestRoomEventSeq })
        })
  });
}

export function scheduleReconnect(state: GameClientState, emit: GameClientEmit): void {
  if (state.intentionallyClosed || !state.serverUrl) return;

  state.reconnectAttempt += 1;
  const capped = Math.min(
    500 * 2 ** Math.max(0, state.reconnectAttempt - 1),
    MAX_RECONNECT_DELAY_MS
  );
  const jitter = Math.floor(Math.random() * 250);
  const delay = capped + jitter;

  clearReconnectTimer(state);
  emit.setStatus("reconnecting");
  state.reconnectTimer = setTimer(() => {
    emit.openSocket("reconnecting");
  }, delay);
}

export function reconnectWithoutSession(state: GameClientState, emit: GameClientEmit): void {
  state.latestProjectionVersion = null;
  state.roomVersion = null;
  state.latestEventSeq = null;
  state.latestRoomEventSeq = null;
  emit.setHandshakeReady(false);
  emit.clearOwnerRoomWitness();
  emit.clearPendingCommand();
  emit.clearPendingRequest();
  emit.applySession(null);
  emit.clearDuelProjection();
  state.activeNamespace = null;
  emit.handlers.onProjection(null);
  stopHeartbeat(state);
  state.intentionallyClosed = false;
  state.reconnectAttempt = 0;
  emit.openSocket("reconnecting");
}

export function stopAfterSessionReplaced(state: GameClientState, emit: GameClientEmit): void {
  state.intentionallyClosed = true;
  clearReconnectTimer(state);
  stopHeartbeat(state);
  emit.setHandshakeReady(false);
  emit.clearOwnerRoomWitness();
  emit.clearPendingCommand();
  emit.clearPendingRequest();
  state.latestProjectionVersion = null;
  state.roomVersion = null;
  state.latestEventSeq = null;
  state.latestRoomEventSeq = null;
  emit.applySession(null);
  emit.handlers.onProjection(null);

  const socket = state.socket;
  state.socket = null;
  socket?.close();
  emit.setStatus("disconnected");
}

export function stopForProtocolMismatch(state: GameClientState, emit: GameClientEmit): void {
  state.intentionallyClosed = true;
  clearReconnectTimer(state);
  stopHeartbeat(state);
  emit.setHandshakeReady(false);
  emit.clearOwnerRoomWitness();
  emit.clearPendingCommand();
  emit.clearPendingRequest();
  state.latestProjectionVersion = null;
  state.roomVersion = null;
  state.latestEventSeq = null;
  state.latestRoomEventSeq = null;
  emit.handlers.onError("客户端与服务端版本不兼容，请更新后重试。");
  emit.clearDuelProjection();
  state.activeNamespace = null;
  emit.handlers.onProjection(null);

  const socket = state.socket;
  state.socket = null;
  socket?.close();
  emit.setStatus("disconnected");
}

export function startHeartbeat(state: GameClientState, emit: GameClientEmit): void {
  stopHeartbeat(state);
  state.lastPongAt = Date.now();
  state.heartbeatTimer = setInterval(() => {
    if (state.socket?.readyState !== WebSocket.OPEN) return;
    if (Date.now() - state.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
      state.socket.close();
      return;
    }
    sendRaw(state, emit, { type: "ping" });
  }, HEARTBEAT_INTERVAL_MS);
}

export function stopHeartbeat(state: GameClientState): void {
  if (state.heartbeatTimer !== null) {
    clearIntervalTimer(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
}

export function clearReconnectTimer(state: GameClientState): void {
  if (state.reconnectTimer !== null) {
    clearTimer(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

export function send(state: GameClientState, emit: GameClientEmit, message: ClientToServerMessage): boolean {
  if (
    state.status !== "connected" ||
    !state.handshakeReady ||
    state.socket?.readyState !== WebSocket.OPEN
  ) {
    emit.handlers.onError("连接未就绪，操作未发送。");
    return false;
  }
  return sendRaw(state, emit, message);
}

export function sendRaw(state: GameClientState, emit: GameClientEmit, message: ClientToServerMessage): boolean {
  if (state.socket?.readyState !== WebSocket.OPEN) {
    emit.handlers.onError("连接未就绪，操作未发送。");
    return false;
  }
  state.socket.send(JSON.stringify(message));
  return true;
}

export function applySession(state: GameClientState, emit: GameClientEmit, session: StoredSession | null): void {
  const previous = state.session;
  if (previous?.roomId !== session?.roomId ||
      previous?.playerId !== session?.playerId ||
      previous?.resumeToken !== session?.resumeToken ||
      previous?.serverUrl !== session?.serverUrl) {
    emit.clearPendingCommand();
    emit.clearDuelProjection();
    state.activeNamespace = null;
    state.legacyProjectionSeen = false;
    state.roomVersion = null;
    state.roomStatus = null;
    emit.clearOwnerRoomWitness();
    state.roomRulesetId = null;
    state.roomRoster = null;
    state.latestProjectionVersion = null;
    state.latestEventSeq = null;
    state.latestRoomEventSeq = null;
    emit.clearPendingRequest();
    emit.clearPendingChat();
    state.chatMessages = [];
    emit.handlers.onChatMessages?.([]);
    emit.handlers.onChatError?.(null);
    emit.handlers.onProjection(null);
    if (previous !== null) {
      emit.handlers.onEvents?.([]);
      emit.handlers.onRoomEvents?.([]);
    }
  }
  state.session = session;
  writeSession(session);
  emit.handlers.onSession(session);
  emit.handlers.onRoom(session?.roomId ?? null);
  emit.handlers.onRoomView?.(null);
}
