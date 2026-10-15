import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessagesSquare, SendHorizontal } from "lucide-react";
import "./RoomChatPanel.css";

/** Maximum number of characters (after trimming) accepted in one chat message. */
export const CHAT_MESSAGE_MAX_LENGTH = 500;

/** Shown when the server history contains no messages yet. */
export const CHAT_EMPTY_STATE_TEXT = "还没有聊天消息";

/**
 * One authenticated chat line as published by the server room history.
 *
 * The panel renders exactly these entries: it never fabricates an echo for a
 * message the client just submitted. Extra server fields are allowed, but the
 * four below are the only ones the panel requires.
 */
export interface RoomChatDisplayMessage {
  seq: number;
  playerId: string;
  playerName: string;
  text: string;
}

export interface RoomChatPanelProps {
  /** Authenticated server history (any order; the panel sorts and de-dupes). */
  readonly messages: readonly RoomChatDisplayMessage[];
  /** Local player id used only to mark "my" lines; `null` marks nobody. */
  readonly viewerPlayerId: string | null;
  readonly connected: boolean;
  /** A send (or the room's chat queue) is awaiting server acknowledgement. */
  readonly pending: boolean;
  /**
   * Hand a trimmed message to the transport. Returns `true` when the message was
   * queued (the panel clears the input, but never adds a line), `false` when it
   * was rejected (the panel keeps the draft and shows `error`).
   */
  readonly onSend: (text: string) => boolean;
  readonly error: string | null;
  readonly title?: string;
}

/**
 * Trims raw input and returns it only when it is a usable chat message:
 * 1..500 characters, never whitespace-only. Returns `null` otherwise so the
 * caller can keep the draft untouched.
 */
export function normalizeChatText(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > CHAT_MESSAGE_MAX_LENGTH) return null;
  return trimmed;
}

/**
 * Returns a human-readable reason the current draft cannot be sent, or `null`
 * when a send should go through. Pure, so the disabled state and any tests share
 * exactly one gate.
 */
export function chatSendBlockedReason(input: {
  readonly connected: boolean;
  readonly pending: boolean;
  readonly text: string;
}): string | null {
  if (!input.connected) return "连接已断开，暂时无法发送消息。";
  if (input.pending) return "正在等待服务器确认上一条消息。";
  if (input.text.trim().length === 0) return "请输入消息内容。";
  if (input.text.trim().length > CHAT_MESSAGE_MAX_LENGTH) {
    return `消息过长，最多 ${CHAT_MESSAGE_MAX_LENGTH} 个字符。`;
  }
  return null;
}

/** The input value after a send attempt: cleared only when the send was queued. */
export function nextDraftAfterSend(draft: string, queued: boolean): string {
  return queued ? "" : draft;
}

/**
 * Sorts by `seq` ascending and drops later duplicates of the same `seq`, so a
 * reconnect backfill or a repeated broadcast can never render a line twice.
 */
export function sortAndDedupeChatMessages(
  messages: readonly RoomChatDisplayMessage[]
): RoomChatDisplayMessage[] {
  const bySeq = new Map<number, RoomChatDisplayMessage>();
  for (const message of messages) {
    if (!bySeq.has(message.seq)) bySeq.set(message.seq, message);
  }
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}

export interface RoomChatDisplayItem extends RoomChatDisplayMessage {
  readonly isSelf: boolean;
}

/** Pure projection used by the renderer: sorted, de-duped, self-flagged items. */
export function buildChatDisplayItems(
  messages: readonly RoomChatDisplayMessage[],
  viewerPlayerId: string | null
): RoomChatDisplayItem[] {
  return sortAndDedupeChatMessages(messages).map(message => ({
    ...message,
    isSelf: viewerPlayerId !== null && message.playerId === viewerPlayerId
  }));
}

/**
 * Read-only chat log plus send box, shared by the room waiting area and the
 * in-match table. It renders the parent's authenticated server history verbatim
 * (text only, never HTML) and owns no game state; the draft input is the only
 * locally-held value.
 */
export function RoomChatPanel({
  messages,
  viewerPlayerId,
  connected,
  pending,
  onSend,
  error,
  title = "房间聊天"
}: RoomChatPanelProps) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);

  const items = buildChatDisplayItems(messages, viewerPlayerId);
  const blockedReason = chatSendBlockedReason({ connected, pending, text: draft });
  const lastSeq = items.length > 0 ? items[items.length - 1]?.seq ?? null : null;

  useEffect(() => {
    const node = logRef.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [lastSeq]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (chatSendBlockedReason({ connected, pending, text: draft }) !== null) return;
    const trimmed = normalizeChatText(draft);
    if (trimmed === null) return;
    const queued = onSend(trimmed);
    setDraft(nextDraftAfterSend(draft, queued));
  }

  return (
    <section className="room-chat" aria-label={title}>
      <header className="room-chat-head">
        <MessagesSquare size={16} aria-hidden />
        <h2 className="room-chat-title">{title}</h2>
        {pending ? <span className="room-chat-status" role="status">发送中…</span> : null}
        {!connected ? <span className="room-chat-status room-chat-status-off">已断开</span> : null}
      </header>

      <div className="room-chat-log" ref={logRef} role="log" aria-label={`${title}消息`} aria-live="polite">
        {items.length === 0 ? (
          <p className="room-chat-empty">{CHAT_EMPTY_STATE_TEXT}</p>
        ) : (
          <ol className="room-chat-list">
            {items.map(item => (
              <li
                key={item.seq}
                className={item.isSelf ? "room-chat-item room-chat-item-self" : "room-chat-item"}
                data-self={item.isSelf ? "true" : undefined}
              >
                <span className="room-chat-meta">
                  <span className="room-chat-name">{item.playerName}</span>
                  {item.isSelf ? <span className="room-chat-self-tag">我</span> : null}
                  <span className="room-chat-seq">#{item.seq}</span>
                </span>
                <span className="room-chat-text">{item.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {error !== null ? (
        <p className="room-chat-error" role="alert">{error}</p>
      ) : null}

      <form className="room-chat-compose" onSubmit={handleSubmit}>
        <input
          className="room-chat-input"
          type="text"
          value={draft}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          placeholder="输入消息，回车发送"
          aria-label="聊天消息输入"
          spellCheck={false}
          autoComplete="off"
          onChange={event => setDraft(event.target.value)}
        />
        <button
          className="button primary room-chat-send"
          type="submit"
          disabled={blockedReason !== null}
          title={blockedReason ?? undefined}
        >
          <SendHorizontal size={16} aria-hidden />
          发送
        </button>
      </form>
    </section>
  );
}
