/** Chat has its own sequence and never changes the game or ready-state clock. */
export const ROOM_CHAT_MAX_TEXT_LENGTH = 500;
export const ROOM_CHAT_MAX_MESSAGES = 2000;

export interface RoomChatMessage {
  readonly seq: number;
  readonly messageId: string;
  readonly playerId: string;
  readonly playerName: string;
  readonly text: string;
}

export type RoomChatClientMessage =
  | { readonly type: "room-chat-send"; readonly requestId: string;
      readonly messageId: string; readonly text: string }
  | { readonly type: "room-chat-sync"; readonly requestId: string;
      readonly afterChatSeq: number };

export type RoomChatServerMessage =
  | { readonly type: "room-chat"; readonly roomId: string;
      readonly afterChatSeq: number; readonly nextChatSeq: number;
      readonly messages: readonly RoomChatMessage[] }
  | { readonly type: "room-chat-accepted"; readonly roomId: string;
      readonly requestId: string; readonly messageId: string;
      readonly seq: number; readonly duplicate: boolean };

function data(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const proto = Object.getPrototypeOf(value);
    return (proto === Object.prototype || proto === null) &&
      Reflect.ownKeys(value).every(key => typeof key === "string" &&
        Object.getOwnPropertyDescriptor(value, key)?.get === undefined &&
        Object.getOwnPropertyDescriptor(value, key)?.set === undefined);
  } catch { return false; }
}

function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length &&
    expected.every(key => Object.hasOwn(value, key));
}

function id(value: unknown, max = 128): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function seq(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isRoomChatText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= ROOM_CHAT_MAX_TEXT_LENGTH && value.trim() === value &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

export function isRoomChatMessage(value: unknown): value is RoomChatMessage {
  return data(value) && keys(value, ["seq", "messageId", "playerId", "playerName", "text"]) &&
    seq(value.seq) && value.seq > 0 && id(value.messageId) && id(value.playerId) &&
    id(value.playerName, 32) && isRoomChatText(value.text);
}

export function isRoomChatClientMessage(value: unknown): value is RoomChatClientMessage {
  if (!data(value)) return false;
  if (value.type === "room-chat-send") return keys(value, ["type", "requestId", "messageId", "text"]) &&
    id(value.requestId) && id(value.messageId) && isRoomChatText(value.text);
  if (value.type === "room-chat-sync") return keys(value, ["type", "requestId", "afterChatSeq"]) &&
    id(value.requestId) && seq(value.afterChatSeq);
  return false;
}

export function isRoomChatServerMessage(value: unknown): value is RoomChatServerMessage {
  if (!data(value)) return false;
  if (value.type === "room-chat-accepted") return keys(value,
    ["type", "roomId", "requestId", "messageId", "seq", "duplicate"]) &&
    id(value.roomId, 64) && id(value.requestId) && id(value.messageId) &&
    seq(value.seq) && value.seq > 0 && typeof value.duplicate === "boolean";
  if (value.type !== "room-chat" || !keys(value,
    ["type", "roomId", "afterChatSeq", "nextChatSeq", "messages"]) ||
    !id(value.roomId, 64) || !seq(value.afterChatSeq) || !seq(value.nextChatSeq) ||
    value.nextChatSeq < value.afterChatSeq || !Array.isArray(value.messages) ||
    value.messages.length > ROOM_CHAT_MAX_MESSAGES ||
    value.messages.length !== value.nextChatSeq - value.afterChatSeq) return false;
  return value.messages.every((message, index) => isRoomChatMessage(message) &&
    message.seq === (value.afterChatSeq as number) + index + 1);
}
