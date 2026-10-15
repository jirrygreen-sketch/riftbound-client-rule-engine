import {
  DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1,
  isDuelCommand,
  isDuelCommandV3Actions1,
  type DuelCommandMessageV3Actions1,
  type DuelWireCommandV3Actions1,
  type PlayerCommand,
  type ServerToClientMessage
} from "@riftbound/protocol";
import { setTimer, clearTimer } from "./timers";
import { createCommandId } from "./utils";
import type { GameClientEmit, GameClientState, PendingCommand } from "./types";

export const COMMAND_TIMEOUT_MS = 10_000;
export const MAX_COMMAND_ATTEMPTS = 3;

export function sendTrackedCommand(
  state: GameClientState,
  emit: GameClientEmit,
  command: PlayerCommand | DuelWireCommandV3Actions1,
  namespace: PendingCommand["namespace"],
  expectedVersion: number,
  eventSeq: number,
  matchId: string | null,
  packet?: DuelCommandMessageV3Actions1
): boolean {
  if (state.pendingCommand) {
    emit.handlers.onError("上一条操作仍在确认中，请稍候。");
    return false;
  }
  const session = state.session;
  if (!session) {
    emit.handlers.onError("尚未进入房间，操作未发送。");
    return false;
  }
  if (!state.handshakeReady || state.status !== "connected") {
    emit.handlers.onError("连接未就绪，操作未发送。");
    return false;
  }
  let commandId: string;
  let capturedCommand: PlayerCommand | DuelWireCommandV3Actions1;
  try {
    // A command ID names one immutable operation. A caller may retain and
    // mutate an array/plan after submit, so retries must own a detached copy.
    capturedCommand = structuredClone(command);
    if (namespace === "duel" && !(state.duelProjection?.projectionSchema === DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1
      ? isDuelCommandV3Actions1(capturedCommand) : isDuelCommand(capturedCommand))) {
      emit.handlers.onError("Duel 操作数据无效，操作未发送。");
      return false;
    }
    commandId = packet?.commandId ?? createCommandId();
  } catch {
    emit.handlers.onError("当前环境无法复制操作或创建安全标识，请刷新后重试。");
    return false;
  }

  const requestId = packet?.requestId ?? emit.nextRequestId("command");
  const pending: PendingCommand = {
    requestId,
    commandId,
    namespace,
    ...(namespace === "duel" && state.duelProjection?.projectionSchema === DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1
      ? { duelCommandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1 } : {}),
    command: capturedCommand,
    expectedVersion,
    eventSeq,
    matchId,
    roomId: session.roomId,
    playerId: session.playerId,
    resumeToken: session.resumeToken,
    serverUrl: session.serverUrl,
    socketGeneration: state.socketGeneration,
    sentRequests: new Map([[requestId, state.socketGeneration]]),
    attempt: 1,
    retryDue: false,
    timeoutTimer: null
  };
  state.pendingCommand = pending;
  emit.handlers.onPendingCommand?.(true);
  if (!sendPendingCommand(state, emit, pending)) {
    emit.clearPendingCommand();
    return false;
  }
  armCommandTimeout(state, emit, pending);
  return true;
}

export function sendPendingCommand(state: GameClientState, emit: GameClientEmit, pending: PendingCommand): boolean {
  const common = {
    requestId: pending.requestId,
    commandId: pending.commandId,
    expectedVersion: pending.expectedVersion
  };
  return pending.namespace === "duel"
    ? pending.duelCommandProfile
      ? emit.send({ type: "duel-command", commandProfile: pending.duelCommandProfile, ...common, command: pending.command as DuelWireCommandV3Actions1 })
      : emit.send({ type: "duel-command", ...common, command: pending.command as import("@riftbound/protocol").DuelWireCommand })
    : emit.send({ type: "command", ...common, command: pending.command as PlayerCommand });
}

export function armCommandTimeout(state: GameClientState, emit: GameClientEmit, pending: PendingCommand): void {
  if (pending.timeoutTimer !== null) clearTimer(pending.timeoutTimer);
  pending.timeoutTimer = setTimer(() => {
    if (state.pendingCommand !== pending) return;
    retryPendingCommand(state, emit, true);
  }, COMMAND_TIMEOUT_MS);
}

export function preparePendingCommandForRetry(state: GameClientState, emit: GameClientEmit): void {
  if (state.pendingChat?.timer !== null && state.pendingChat?.timer !== undefined) {
    clearTimer(state.pendingChat.timer);
    state.pendingChat.timer = null;
  }
  // Room requests are deliberately not retried on a replacement socket: a
  // late receipt must never be associated with a new socket/session context.
  emit.clearPendingRequest();
  const pending = state.pendingCommand;
  if (!pending) return;

  if (pending.timeoutTimer !== null) clearTimer(pending.timeoutTimer);
  pending.timeoutTimer = null;
  pending.retryDue = true;
}

export function retryPendingCommand(state: GameClientState, emit: GameClientEmit, force = false): void {
  const pending = state.pendingCommand;
  if (!pending || (!force && !pending.retryDue)) return;
  if (!matchesPendingSession(state, pending)) {
    emit.clearPendingCommand();
    return;
  }
  if (state.status !== "connected" || !state.handshakeReady ||
      state.socket?.readyState !== WebSocket.OPEN ||
      state.activeNamespace !== pending.namespace) return;
  if (pending.namespace === "duel") {
    if (!matchesDuelContext(state) ||
        state.duelProjectionSocketGeneration !== state.socketGeneration ||
        state.duelProjection?.match.matchId !== pending.matchId) return;
  } else {
    // A legacy retry must wait for a fresh legacy projection and then rebase
    // onto the server's latest confirmed version/event cursor. Duel commands
    // never do this: their version/clock stays frozen at the original send.
    if (state.latestProjectionVersion === null) return;
    pending.expectedVersion = state.latestProjectionVersion;
    pending.eventSeq = state.latestEventSeq ?? pending.eventSeq;
  }

  if (pending.attempt >= MAX_COMMAND_ATTEMPTS) {
    emit.clearPendingCommand();
    emit.handlers.onError("操作确认超时，请重试。");
    return;
  }
  pending.attempt += 1;
  pending.retryDue = false;
  pending.requestId = emit.nextRequestId("command");
  pending.socketGeneration = state.socketGeneration;
  pending.sentRequests.set(pending.requestId, state.socketGeneration);
  if (!sendPendingCommand(state, emit, pending)) {
    preparePendingCommandForRetry(state, emit);
    return;
  }
  armCommandTimeout(state, emit, pending);
}

export function clearPendingCommand(state: GameClientState, emit: GameClientEmit): void {
  const pending = state.pendingCommand;
  if (!pending) return;

  state.pendingCommand = null;
  if (pending.timeoutTimer !== null) clearTimer(pending.timeoutTimer);
  emit.handlers.onPendingCommand?.(false);
}

export function matchesPendingSession(state: GameClientState, pending: PendingCommand): boolean {
  return state.session?.roomId === pending.roomId &&
    state.session.playerId === pending.playerId &&
    state.session.resumeToken === pending.resumeToken &&
    state.session.serverUrl === pending.serverUrl &&
    state.serverUrl === pending.serverUrl;
}

export function matchesPendingReceipt(
  state: GameClientState,
  pending: PendingCommand,
  receipt: Extract<ServerToClientMessage, { type: "request-result" }>,
  socketGeneration: number
): boolean {
  if (!matchesPendingSession(state, pending) ||
      state.status !== "connected" || !state.handshakeReady ||
      state.socket?.readyState !== WebSocket.OPEN ||
      socketGeneration !== state.socketGeneration ||
      pending.sentRequests.get(receipt.requestId) !== socketGeneration ||
      receipt.commandId !== pending.commandId ||
      receipt.appliedVersion === undefined || receipt.eventSeq === undefined ||
      receipt.appliedVersion < pending.expectedVersion ||
      receipt.eventSeq < pending.eventSeq ||
      state.activeNamespace !== pending.namespace) return false;
  if (pending.namespace === "duel") {
    return state.duelProjection?.match.matchId === pending.matchId && matchesDuelContext(state);
  }
  return true;
}

export function matchesDuelContext(state: GameClientState): boolean {
  const context = state.duelProjectionContext;
  return context !== null && state.session !== null &&
    state.session.roomId === context.roomId &&
    state.session.playerId === context.playerId &&
    state.session.resumeToken === context.resumeToken &&
    state.session.serverUrl === context.serverUrl &&
    (state.roomRoster === null || state.roomRoster.has(context.playerId));
}
