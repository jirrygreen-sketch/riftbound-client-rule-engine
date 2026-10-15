import { isRoomChatText } from "@riftbound/protocol";
import { clearTimer, setTimer } from "./timers";
import { createCommandId, sameStoredSession } from "./utils";
import { MAX_COMMAND_ATTEMPTS } from "./commands";
import { ROOM_REQUEST_TIMEOUT_MS } from "./room-requests";
import type { GameClientEmit, GameClientState } from "./types";

export function sendChat(state: GameClientState, emit: GameClientEmit, input: string): boolean {
  const text = input.trim();
  if (!isRoomChatText(text)) {
    emit.handlers.onChatError?.("聊天内容须为 1–500 个字符。");
    return false;
  }
  if (state.pendingChat || !state.session || !state.handshakeReady || state.status !== "connected") {
    emit.handlers.onChatError?.("聊天连接未就绪或上一条消息仍在确认中。");
    return false;
  }
  let messageId: string;
  try { messageId = createCommandId(); } catch {
    emit.handlers.onChatError?.("无法创建消息标识，请重试。");
    return false;
  }
  state.pendingChat = { messageId, text, session: { ...state.session },
    requestId: "", socketGeneration: state.socketGeneration, attempts: 0, timer: null };
  emit.handlers.onChatError?.(null);
  emit.handlers.onChatPending?.(true);
  return sendPendingChat(state, emit);
}

export function syncChat(state: GameClientState, emit: GameClientEmit): void {
  if (state.session && state.handshakeReady && state.status === "connected") emit.send({
    type: "room-chat-sync", requestId: emit.nextRequestId("chat-sync"),
    afterChatSeq: state.chatMessages.length
  });
}

export function sendPendingChat(state: GameClientState, emit: GameClientEmit): boolean {
  const pending = state.pendingChat;
  if (!pending) return false;
  if (!state.session || !sameStoredSession(pending.session, state.session)) {
    clearPendingChat(state, emit);
    return false;
  }
  if (!state.handshakeReady || state.status !== "connected") return false;
  if (pending.attempts >= MAX_COMMAND_ATTEMPTS) {
    clearPendingChat(state, emit);
    emit.handlers.onChatError?.("聊天确认超时，消息可能已送达，请先检查聊天记录。");
    return false;
  }
  if (pending.timer !== null) clearTimer(pending.timer);
  pending.attempts += 1;
  pending.requestId = emit.nextRequestId("chat-send");
  pending.socketGeneration = state.socketGeneration;
  if (!emit.send({ type: "room-chat-send", requestId: pending.requestId,
    messageId: pending.messageId, text: pending.text })) {
    clearPendingChat(state, emit);
    return false;
  }
  pending.timer = setTimer(() => {
    if (state.pendingChat !== pending) return;
    pending.timer = null;
    sendPendingChat(state, emit);
  }, ROOM_REQUEST_TIMEOUT_MS);
  return true;
}

export function clearPendingChat(state: GameClientState, emit: GameClientEmit): void {
  if (state.pendingChat?.timer !== null && state.pendingChat?.timer !== undefined)
    clearTimer(state.pendingChat.timer);
  state.pendingChat = null;
  emit.handlers.onChatPending?.(false);
}
