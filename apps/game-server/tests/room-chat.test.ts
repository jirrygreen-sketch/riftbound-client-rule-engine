import { describe, expect, it } from "vitest";
import {
  type ClientSession,
  type ServerToClientMessage,
  type ServerTransport
} from "@riftbound/protocol";
import { GameRoom, RoomError, type RoomArchive } from "../src/room.js";
import { RoomChatLedger, validateRoomChatMessages } from "../src/room-chat.js";

function capture(): { messages: ServerToClientMessage[]; send: ServerTransport } {
  const messages: ServerToClientMessage[] = [];
  return { messages, send: message => messages.push(message) };
}

describe("immutable chat history boundary", () => {
  it("does not let a retained transport message mutate the stored history", () => {
    const ledger = new RoomChatLedger();
    const appended = ledger.append("player-1", "Alice", "message-1", "original");
    expect(() => Object.assign(appended.message, { text: "changed" })).toThrow();
    expect(() => (ledger.messages as unknown[]).push({})).toThrow();
    expect(ledger.after(0)[0]?.text).toBe("original");
    expect(ledger.append("player-1", "Alice", "message-1", "original").duplicate).toBe(true);
  });
  it("rejects array subclasses and indexed getters without invoking them", () => {
    let reads = 0;
    class OtherArray extends Array { entries() { reads++; return super.entries(); } }
    expect(() => validateRoomChatMessages(new OtherArray())).toThrow();
    const array: unknown[] = [];
    Object.defineProperty(array, "0", { get() { reads++; return {}; }, enumerable: true });
    expect(() => validateRoomChatMessages(array)).toThrow();
    expect(reads).toBe(0);
  });
});

function join(room: GameRoom, name: string, connectionId: string) {
  const transport = capture();
  const connection = room.join(name, transport.send, connectionId);
  const session: ClientSession = {
    roomId: room.roomId,
    playerId: connection.playerId,
    resumeToken: connection.resumeToken
  };
  return { ...transport, connection, session };
}

function send(
  room: GameRoom,
  seat: ReturnType<typeof join>,
  requestId: string,
  messageId: string,
  text: string
): void {
  room.sendChat(
    seat.session,
    seat.connection.connectionId,
    messageId,
    text,
    requestId,
    seat.send
  );
}

describe("authenticated room chat", () => {
  it("uses an actor scoped idempotency key and keeps game clocks unchanged", () => {
    const room = new GameRoom("chat-room");
    const alice = join(room, "Alice", "alice-1");
    const bob = join(room, "Bob", "bob-1");
    const before = {
      roomVersion: room.currentRoomVersion,
      roomEventSeq: room.currentRoomEventSeq,
      archive: room.exportArchive()
    };

    send(room, alice, "r1", "same-id", "hello");
    send(room, bob, "r2", "same-id", "hello");
    expect(room.chatMessages().map(message => [message.seq, message.playerId])).toEqual([
      [1, "player-1"], [2, "player-2"]
    ]);
    expect(alice.messages.filter(message => message.type === "room-chat")).toHaveLength(2);
    expect(bob.messages.filter(message => message.type === "room-chat")).toHaveLength(2);

    send(room, alice, "retry", "same-id", "hello");
    const accepted = alice.messages.at(-1);
    expect(accepted).toMatchObject({ type: "room-chat-accepted", duplicate: true, seq: 1 });
    expect(room.currentChatSeq).toBe(2);
    expect(room.currentRoomVersion).toBe(before.roomVersion);
    expect(room.currentRoomEventSeq).toBe(before.roomEventSeq);
    expect(room.exportArchive()).toMatchObject({ roomVersion: before.roomVersion, roomEventSeq: before.roomEventSeq });

    expect(() => send(room, alice, "conflict", "same-id", "different")).toThrowError(
      expect.objectContaining({ code: "idempotency-conflict" })
    );
    expect(room.currentChatSeq).toBe(2);
  });

  it("normalizes text, accepts plaintext newlines, and enforces the 500 character bound", () => {
    const room = new GameRoom("chat-text");
    const alice = join(room, "Alice", "alice-1");
    send(room, alice, "r1", "trimmed", "  <b>Hello</b>\nworld  ");
    expect(room.chatMessages()[0]?.text).toBe("<b>Hello</b>\nworld");
    send(room, alice, "r2", "five-hundred", "x".repeat(500));
    expect(room.currentChatSeq).toBe(2);
    expect(() => send(room, alice, "r3", "too-long", "x".repeat(501))).toThrowError(RoomError);
    expect(room.currentChatSeq).toBe(2);
  });

  it("rejects stale and unjoined sessions without mutating the ledger", () => {
    const room = new GameRoom("chat-auth");
    const alice = join(room, "Alice", "alice-1");
    const bob = join(room, "Bob", "bob-1");
    const replacementTransport = capture();
    const replacementConnection = room.reconnect(
      alice.connection.resumeToken,
      replacementTransport.send,
      "alice-2"
    );
    expect(replacementConnection).not.toBeNull();
    expect(() => send(room, alice, "stale", "stale-id", "nope")).toThrowError(
      expect.objectContaining({ code: "session-replaced" })
    );
    expect(() => room.sendChat(
      { roomId: room.roomId, playerId: "player-9", resumeToken: "unknown" },
      "no-connection", "unknown", "nope", "unjoined", bob.send
    )).toThrowError(RoomError);
    expect(room.currentChatSeq).toBe(0);
  });

  it("omits empty chat archives and strictly restores valid history", () => {
    const empty = new GameRoom("chat-empty");
    expect(Object.hasOwn(empty.exportArchive(), "roomChat")).toBe(false);

    const room = new GameRoom("chat-archive");
    const alice = join(room, "Alice", "alice-1");
    const bob = join(room, "Bob", "bob-1");
    send(room, alice, "r1", "cross-actor", "hello");
    send(room, bob, "r2", "cross-actor", "world");
    const archive = room.exportArchive();
    const restored = GameRoom.restore(archive);
    expect(restored.chatMessages()).toEqual(room.chatMessages());

    const tampered = {
      ...archive,
      roomChat: { messages: archive.roomChat!.messages.map((message, index) =>
        index === 1 ? { ...message, seq: 9 } : message) }
    } as RoomArchive;
    expect(() => GameRoom.restore(tampered)).toThrow();
    const forged = {
      ...archive,
      roomChat: { messages: archive.roomChat!.messages.map((message, index) =>
        index === 0 ? { ...message, playerName: "Forged" } : message) }
    } as RoomArchive;
    expect(() => GameRoom.restore(forged)).toThrow();
  });
});
