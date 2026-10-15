import {
  DUEL_RULESET_ID,
  PROTOCOL_VERSION,
  isServerMessage,
  type ServerToClientMessage
} from "@riftbound/protocol";
import { sameSession, sameStoredSession } from "./utils";
import { clearPendingChat } from "./chat";
import {
  clearPendingCommand,
  matchesPendingReceipt,
  matchesPendingSession
} from "./commands";
import { acceptDuelProjection } from "./projections";
import {
  clearOwnerDeckConfirmation,
  clearPendingRequest,
  matchesActiveSocketSession
} from "./room-requests";
import type { GameClientEmit, GameClientState } from "./types";

export function handleMessage(state: GameClientState, emit: GameClientEmit, raw: unknown, socketGeneration = state.socketGeneration): void {
  if (socketGeneration !== state.socketGeneration ||
      state.socket?.readyState !== WebSocket.OPEN) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    emit.handlers.onError("服务端返回了无法识别的数据。");
    return;
  }

  if (!isServerMessage(parsed)) {
    emit.handlers.onError("服务端返回了无法识别的消息。");
    return;
  }

  switch (parsed.type) {
    case "welcome": {
      if (parsed.protocolVersion !== PROTOCOL_VERSION) {
        emit.stopForProtocolMismatch();
        return;
      }
      if (state.status !== "connected" && state.status !== "connecting" &&
          state.status !== "reconnecting") return;
      // An unsolicited welcome cannot substitute a new room/actor for the
      // authenticated hello. The only other welcome is the response to an
      // explicit create/join request made after the initial handshake.
      const established = state.handshakeReady;
      if (established) {
        if (state.session !== null &&
            (!parsed.session || !sameSession(state.session, parsed.session))) {
          emit.stopAfterSessionReplaced();
          return;
        }
        if (state.session === null && (!parsed.session ||
            state.expectedSessionRequest?.socketGeneration !== socketGeneration)) return;
      } else if (state.helloSession !== null &&
          (!parsed.session || !sameSession(state.helloSession, parsed.session))) {
        emit.stopAfterSessionReplaced();
        return;
      }

      state.reconnectAttempt = 0;
      state.lastPongAt = Date.now();
      if (parsed.session) {
        emit.applySession({ ...parsed.session, serverUrl: state.serverUrl });
        state.expectedSessionRequest = null;
      } else if (state.session?.serverUrl === state.serverUrl) {
        emit.applySession(null);
      }
      if (state.pendingCommand && !matchesPendingSession(state, state.pendingCommand)) {
        clearPendingCommand(state, emit);
      }
      emit.setHandshakeReady(true);
      emit.startHeartbeat();
      emit.setStatus("connected");
      emit.retryPendingCommand();
      emit.syncChat();
      emit.sendPendingChat();
      return;
    }
    case "room-chat": {
      if (!matchesActiveSocketSession(state, socketGeneration, parsed.roomId)) return;
      if (parsed.afterChatSeq > state.chatMessages.length) {
        emit.syncChat();
        return;
      }
      for (const message of parsed.messages) {
        const existing = state.chatMessages[message.seq - 1];
        if (existing && (existing.messageId !== message.messageId ||
            existing.playerId !== message.playerId || existing.playerName !== message.playerName ||
            existing.text !== message.text)) {
          emit.handlers.onChatError?.("聊天记录校验失败，请重新连接。");
          return;
        }
      }
      if (parsed.nextChatSeq > state.chatMessages.length) {
        state.chatMessages = [...state.chatMessages,
          ...parsed.messages.filter(message => message.seq > state.chatMessages.length)];
        emit.handlers.onChatMessages?.(state.chatMessages);
      }
      return;
    }
    case "room-chat-accepted": {
      const pending = state.pendingChat;
      if (!pending || !matchesActiveSocketSession(state, socketGeneration, parsed.roomId) ||
          pending.socketGeneration !== socketGeneration || parsed.requestId !== pending.requestId ||
          parsed.messageId !== pending.messageId || !state.session ||
          !sameStoredSession(pending.session, state.session)) return;
      clearPendingChat(state, emit);
      emit.handlers.onChatError?.(null);
      if (parsed.seq > state.chatMessages.length) emit.syncChat();
      return;
    }
    case "request-result": {
      const pendingRoomRequest = state.pendingRoomRequest;
      if (
        pendingRoomRequest &&
        pendingRoomRequest.requestId === parsed.requestId &&
        pendingRoomRequest.socketGeneration === socketGeneration &&
        emit.matchesCurrentRoomRequestContext(pendingRoomRequest)
      ) {
        clearPendingRequest(state, emit, false);
        emit.handlers.onRoomRequestResult?.({
          requestId: pendingRoomRequest.requestId,
          requestType: pendingRoomRequest.requestType,
          roomId: pendingRoomRequest.roomId,
          playerId: pendingRoomRequest.playerId,
          socketGeneration: pendingRoomRequest.socketGeneration,
          ...(pendingRoomRequest.ready === undefined
            ? {} : { ready: pendingRoomRequest.ready }),
          ...(parsed.roomVersion === undefined ? {} : { roomVersion: parsed.roomVersion }),
          ...(parsed.roomEventSeq === undefined ? {} : { roomEventSeq: parsed.roomEventSeq }),
          ...(parsed.duplicate === undefined ? {} : { duplicate: parsed.duplicate })
        });
      }
      const pending = state.pendingCommand;
      if (pending && matchesPendingReceipt(state, pending, parsed, socketGeneration)) {
        clearPendingCommand(state, emit);
        // A receipt is not a projection. Do not allow another command against
        // the pre-acknowledgement version until an authoritative update arrives.
        if (pending.namespace === "duel") {
          if (state.duelProjection?.match.matchId === pending.matchId &&
              (state.duelProjection.match.stateVersion < parsed.appliedVersion! ||
               state.duelProjection.match.eventSeq < parsed.eventSeq! ||
               state.duelProjection.match.stateVersion <= pending.expectedVersion ||
               state.duelProjection.match.eventSeq <= pending.eventSeq)) {
            state.duelAcknowledgedClock = {
              version: Math.max(parsed.appliedVersion!, pending.expectedVersion),
              eventSeq: Math.max(parsed.eventSeq!, pending.eventSeq),
              requireNewer: parsed.appliedVersion! <= pending.expectedVersion || parsed.eventSeq! <= pending.eventSeq,
            };
          }
        } else if (parsed.appliedVersion !== undefined) {
          state.latestProjectionVersion = null;
        }
      }
      return;
    }
    case "room":
      if (!matchesActiveSocketSession(state, socketGeneration, parsed.room.roomId) ||
          !parsed.room.players.some(player => player.id === state.session?.playerId)) return;
      // A room transition is a witness only when a previously observed
      // playing/ended room advances its version to waiting in this session.
      // A lone waiting packet or match ID cannot authorize a reset to v0.
      if ((state.roomVersion !== null && parsed.room.roomVersion < state.roomVersion) ||
          (state.latestRoomEventSeq !== null &&
            parsed.room.roomEventSeq < state.latestRoomEventSeq)) return;
      if (state.activeNamespace === "duel" && state.duelProjection &&
          (parsed.room.rulesetId !== DUEL_RULESET_ID ||
            parsed.room.players.length !== state.duelProjection.match.roster.length ||
            !parsed.room.players.every(player => state.duelProjection!.match.roster.some(
              seat => seat.playerId === player.id)))) {
        // Contradictory authenticated room evidence makes the cached hand and
        // its pending command unsafe, even if the Duel DTO arrived first.
        emit.stopAfterSessionReplaced();
        return;
      }
      if (state.roomRulesetId !== null && parsed.room.rulesetId !== state.roomRulesetId) return;
      if (state.duelProjection && state.roomStatus !== null &&
          state.roomStatus !== "waiting" && parsed.room.status === "waiting" &&
          state.roomVersion !== null && parsed.room.roomVersion > state.roomVersion) {
        state.duelMatchTransitionAllowed = true;
        state.duelProjectionSocketGeneration = null;
        state.duelAcknowledgedClock = null;
        clearPendingCommand(state, emit);
      }
      state.roomVersion = parsed.room.roomVersion;
      state.roomStatus = parsed.room.status;
      state.roomRulesetId = parsed.room.rulesetId;
      state.roomRoster = new Set(parsed.room.players.map(player => player.id));
      state.roomSelfDeckSubmitted = parsed.room.players.find(player => player.id === state.session?.playerId)!.deckSubmitted;
      state.roomViewSocketGeneration = socketGeneration;
      state.roomViewEventSeq = parsed.room.roomEventSeq;
      state.roomViewStatus = parsed.room.status;
      state.latestRoomEventSeq = Math.max(
        state.latestRoomEventSeq ?? parsed.room.roomEventSeq, parsed.room.roomEventSeq
      );
      // A new authoritative room clock or cleared public flag invalidates a
      // prior echo; only a fresh private message for this exact clock can
      // restore the owner witness. RoomView alone never proves deck identity.
      if (state.ownerDeckConfirmation && (
        state.ownerDeckConfirmation.roomVersion !== parsed.room.roomVersion ||
        state.ownerDeckConfirmation.roomEventSeq !== parsed.room.roomEventSeq ||
        (state.ownerDeckConfirmation.deck !== null) !== state.roomSelfDeckSubmitted
      )) clearOwnerDeckConfirmation(state, emit);
      emit.handlers.onRoom(parsed.room.roomId);
      emit.handlers.onRoomView?.(parsed.room);
      {
        const staged = state.pendingOwnerDeckEcho;
        state.pendingOwnerDeckEcho = null;
        if (staged !== null) emit.acceptOwnerDeckConfirmation(staged, socketGeneration);
      }
      return;
    case "owner-deck-confirmation": {
      // A playing/ended broadcast can send its private echo immediately
      // before the new room snapshot. Queue only for this authenticated seat;
      // never expose staged content to UI or any ACK handler.
      const aheadOfRoom = matchesActiveSocketSession(state, socketGeneration, parsed.roomId) &&
        state.session?.playerId === parsed.playerId &&
        state.roomViewSocketGeneration === socketGeneration &&
        state.roomRulesetId === parsed.rulesetId &&
        state.roomVersion !== null && parsed.roomVersion > state.roomVersion &&
        parsed.roomEventSeq >= (state.roomViewEventSeq ?? 0);
      if (aheadOfRoom) {
        state.pendingOwnerDeckEcho = parsed;
        return;
      }
      emit.acceptOwnerDeckConfirmation(parsed, socketGeneration);
      return;
    }
    case "projection":
      if (!matchesActiveSocketSession(state, socketGeneration, parsed.roomId) ||
          !parsed.projection.players.some(player => player.id === state.session?.playerId) ||
          (parsed.projection.actionOptions !== undefined &&
            parsed.projection.actionOptions.viewerPlayerId !== state.session?.playerId)) return;
      // The namespaces have unrelated version/event clocks. Do not allow a
      // stray legacy packet to replace an authenticated Duel in this room.
      if (state.activeNamespace === "duel" || state.roomRulesetId === DUEL_RULESET_ID) return;
      if (state.latestProjectionVersion !== null &&
          (parsed.projection.version < state.latestProjectionVersion ||
           parsed.projection.eventSeq < (state.latestEventSeq ?? 0))) return;
      state.activeNamespace = "legacy";
      state.legacyProjectionSeen = true;
      state.latestProjectionVersion = parsed.projection.version;
      state.latestEventSeq = Math.max(state.latestEventSeq ?? 0, parsed.projection.eventSeq);
      emit.handlers.onProjection(parsed.projection);
      emit.handlers.onRoom(parsed.roomId);
      emit.retryPendingCommand();
      return;
    case "duel-projection":
      acceptDuelProjection(state, emit, parsed.roomId, parsed.projection, socketGeneration);
      return;
    case "events": {
      if (!matchesActiveSocketSession(state, socketGeneration, parsed.roomId) ||
          state.activeNamespace === "duel" ||
          (state.latestEventSeq !== null && parsed.nextEventSeq < state.latestEventSeq)) return;
      state.latestEventSeq = Math.max(
        state.latestEventSeq ?? parsed.afterEventSeq,
        parsed.nextEventSeq
      );
      emit.handlers.onEvents?.(parsed.events);
      return;
    }
    case "room-events": {
      if (!matchesActiveSocketSession(state, socketGeneration, parsed.roomId) ||
          (state.latestRoomEventSeq !== null &&
            parsed.nextRoomEventSeq < state.latestRoomEventSeq)) return;
      state.latestRoomEventSeq = Math.max(
        state.latestRoomEventSeq ?? parsed.afterRoomEventSeq,
        parsed.nextRoomEventSeq
      );
      emit.handlers.onRoomEvents?.(parsed.events);
      return;
    }
    case "error":
      handleServerError(state, emit, parsed, socketGeneration);
      return;
    case "pong":
      state.lastPongAt = Date.now();
      return;
  }
}


function handleServerError(
  state: GameClientState,
  emit: GameClientEmit,
  message: Extract<ServerToClientMessage, { type: "error" }>,
  socketGeneration: number
): void {
  if (state.pendingChat && message.requestId === state.pendingChat.requestId &&
      socketGeneration === state.pendingChat.socketGeneration &&
      !["session-replaced", "invalid-token", "room-not-found"].includes(message.code)) {
    clearPendingChat(state, emit);
    emit.handlers.onChatError?.(message.code === "capacity-exceeded"
      ? "房间聊天记录已满。" : "聊天消息未被接受，请检查内容后重试。");
    return;
  }
  const pending = state.pendingCommand;
  if (
    state.pendingRoomRequest !== null &&
    message.requestId === state.pendingRoomRequest.requestId &&
    emit.matchesCurrentRoomRequestContext(state.pendingRoomRequest)
  ) {
    clearPendingRequest(state, emit, true);
  }
  const pendingAffected =
    pending !== null && matchesPendingSession(state, pending) &&
    (message.requestId !== undefined &&
      pending.sentRequests.get(message.requestId) === socketGeneration ||
      message.code === "session-replaced" ||
      message.code === "invalid-token" ||
      message.code === "room-not-found");

  if (pendingAffected) clearPendingCommand(state, emit);

  switch (message.code) {
    case "invalid-token":
    case "room-not-found":
      emit.handlers.onError("原房间已不可用，正在准备新的房间连接。");
      emit.reconnectWithoutSession();
      return;
    case "session-replaced":
      emit.handlers.onError("当前连接已被新的会话替换，已停止自动重连。");
      emit.stopAfterSessionReplaced();
      return;
    case "stale-version":
      if (pendingAffected) {
        if (pending?.namespace === "duel") {
          state.duelAcknowledgedClock = {
            version: Math.max(state.duelAcknowledgedClock?.version ?? 0, state.duelProjection?.match.stateVersion ?? 0),
            eventSeq: Math.max(state.duelAcknowledgedClock?.eventSeq ?? 0, state.duelProjection?.match.eventSeq ?? 0),
            requireNewer: true,
          };
        } else state.latestProjectionVersion = null;
      }
      emit.handlers.onError("牌桌状态已更新，请重试刚才的操作。");
      return;
    case "idempotency-conflict":
      emit.handlers.onError("该操作与已发送的操作冲突，请重试。");
      return;
    case "handshake-required":
      emit.handlers.onError("连接尚未就绪，请重试。");
      return;
    case "protocol-error":
      emit.handlers.onError("客户端与服务端通信不兼容，请检查版本。");
      return;
    case "room-full":
      emit.handlers.onError("房间人数已满，无法加入。");
      return;
    case "invalid-deck":
      emit.handlers.onError("卡组未通过服务端校验，请调整后再提交。");
      return;
    case "already-in-room":
      emit.handlers.onError("当前连接已经进入房间。");
      return;
    case "invalid_command":
      emit.handlers.onError("当前操作不符合规则，请重试。");
      return;
    case "not_your_turn":
      emit.handlers.onError("尚未轮到你的回合。");
      return;
    case "prompt_required":
      emit.handlers.onError("请先响应当前选择。");
      return;
    case "prompt_not_found":
    case "prompt_expired":
      emit.handlers.onError("该选择已失效，请等待牌桌更新。");
      return;
    case "invalid_prompt_answer":
      emit.handlers.onError("当前选择无效，请重新选择。");
      return;
    case "card_not_found":
      emit.handlers.onError("该卡牌已不在手牌中。");
      return;
    case "not_enough_mana":
      emit.handlers.onError("资源不足，无法执行该操作。");
      return;
    case "game_ended":
      emit.handlers.onError("对局已经结束。");
      return;
    case "command-rejected":
      emit.handlers.onError(pendingAffected && pending?.namespace === "duel" &&
        pending.command.type === "play-card" && message.message === "法术付款仍在等待资源"
        ? "请获取资源并支付当前施放费用，完成后进入响应时点。"
        : "服务端未接受该操作，请重试。");
      return;
    case "capacity-exceeded":
      emit.handlers.onError("服务端当前繁忙，请稍后重试。");
      return;
    default:
      emit.handlers.onError("操作失败，请稍后重试。");
  }
}
