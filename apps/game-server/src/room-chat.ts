import {
  isRoomChatMessage,
  isRoomChatText,
  ROOM_CHAT_MAX_MESSAGES,
  type RoomChatMessage,
} from "@riftbound/protocol";

export type RoomChatMutation = {
  readonly message: RoomChatMessage;
  readonly duplicate: boolean;
};

export class RoomChatError extends Error {
  constructor(
    message: string,
    readonly reason: "invalid-text" | "capacity-exceeded" | "idempotency-conflict" | "invalid-archive"
  ) {
    super(message);
    this.name = "RoomChatError";
  }
}

/**
 * Private room chat state. It deliberately has no connection or transport
 * references so that archive snapshots remain plain data and easy to roll
 * back with the rest of a room transaction.
 */
export class RoomChatLedger {
  private readonly entries: RoomChatMessage[] = [];
  private readonly byActorMessageId = new Map<string, RoomChatMessage>();

  get currentSeq(): number {
    return this.entries.length;
  }

  get messages(): readonly RoomChatMessage[] {
    return Object.freeze([...this.entries]);
  }

  append(
    playerId: string,
    playerName: string,
    messageId: string,
    text: string
  ): RoomChatMutation {
    const normalized = typeof text === "string" ? text.trim() : "";
    if (!isRoomChatText(normalized) || !isRoomChatMessage({
      seq: 1,
      messageId,
      playerId,
      playerName,
      text: normalized
    })) {
      throw new RoomChatError(
        "Chat text must be 1 to 500 characters with no surrounding whitespace",
        "invalid-text"
      );
    }

    const key = actorMessageKey(playerId, messageId);
    const previous = this.byActorMessageId.get(key);
    if (previous) {
      if (previous.text !== normalized) {
        throw new RoomChatError(
          "Message id was already used with different text",
          "idempotency-conflict"
        );
      }
      return { message: previous, duplicate: true };
    }

    if (this.entries.length >= ROOM_CHAT_MAX_MESSAGES) {
      throw new RoomChatError("Room chat history is full", "capacity-exceeded");
    }

    const message: RoomChatMessage = Object.freeze({
      seq: this.entries.length + 1,
      messageId,
      playerId,
      playerName,
      text: normalized
    });
    this.entries.push(message);
    this.byActorMessageId.set(key, message);
    return { message, duplicate: false };
  }

  after(afterChatSeq: number): readonly RoomChatMessage[] {
    if (!Number.isSafeInteger(afterChatSeq) || afterChatSeq < 0 || afterChatSeq > this.currentSeq) {
      throw new RoomChatError("Chat cursor is ahead of the authoritative history", "invalid-archive");
    }
    return this.entries.slice(afterChatSeq);
  }

  /** Replace the ledger during archive restore after strict validation. */
  restore(messages: readonly RoomChatMessage[]): void {
    validateRoomChatMessages(messages);
    this.entries.splice(0, this.entries.length, ...messages.map(message => Object.freeze({ ...message })));
    this.byActorMessageId.clear();
    for (const message of this.entries) {
      this.byActorMessageId.set(actorMessageKey(message.playerId, message.messageId), message);
    }
  }
}

export function actorMessageKey(playerId: string, messageId: string): string {
  return `${playerId}\u0000${messageId}`;
}

export function validateRoomChatMessages(value: unknown): asserts value is readonly RoomChatMessage[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > ROOM_CHAT_MAX_MESSAGES) {
    throw new RoomChatError("Invalid room chat archive", "invalid-archive");
  }
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(value);
    const expectedKeys = new Set<string | symbol>([
      "length",
      ...Array.from({ length: value.length }, (_, index) => String(index))
    ]);
    if (keys.length !== expectedKeys.size || keys.some(key => !expectedKeys.has(key))) {
      throw new RoomChatError("Room chat archive contains extra array keys", "invalid-archive");
    }
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor?.get !== undefined || descriptor?.set !== undefined) {
        throw new RoomChatError("Room chat archive contains a getter", "invalid-archive");
      }
    }
  } catch (error) {
    if (error instanceof RoomChatError) throw error;
    throw new RoomChatError("Invalid room chat archive", "invalid-archive");
  }
  const messageIds = new Set<string>();
  for (const [index, message] of value.entries()) {
    if (!isRoomChatMessage(message) || message.seq !== index + 1) {
      throw new RoomChatError("Room chat archive has a sequence gap or invalid message", "invalid-archive");
    }
    const key = actorMessageKey(message.playerId, message.messageId);
    if (messageIds.has(key)) {
      throw new RoomChatError("Room chat archive contains a duplicate message id", "invalid-archive");
    }
    messageIds.add(key);
  }
}
