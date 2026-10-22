import { describe, expect, it } from "vitest";
import type { RoomView } from "@riftbound/protocol";
import type { V2Socket } from "../src/transport/v2";
import {
  buildV2Hello,
  buildV2RoomUrl,
  V2MatchSessionController
} from "../src/full-product/v2/V2MatchSession";

class FakeSocket implements V2Socket {
  readonly sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send(data: string): void { this.sent.push(data); }
  close(): void { this.onclose?.({}); }
  open(): void { this.onopen?.({}); }
  receive(packet: unknown): void { this.onmessage?.({ data: JSON.stringify(packet) }); }
}

function room(roomVersion = 1): RoomView {
  return {
    roomId: "room-1",
    status: "waiting",
    rulesetId: "riftbound-duel",
    version: 0,
    roomVersion,
    roomEventSeq: 0,
    players: [{ id: "player-1", name: "Alice", connected: true, ready: false, deckSubmitted: false }]
  };
}

function sent(socket: FakeSocket, index = -1): any {
  return JSON.parse(socket.sent.at(index) ?? "null");
}

describe("desktop protocol v2 independent session", () => {
  it("normalizes a plain server address without putting identity in the URL", () => {
    expect(buildV2RoomUrl("ws://127.0.0.1:39500")).toBe("ws://127.0.0.1:39500/ws");
    expect(buildV2Hello()).toEqual({ type: "hello", protocolVersion: "2.0.0" });
  });

  it("sends v2 hello before create-room and submits the server room version", async () => {
    const socket = new FakeSocket();
    const controller = new V2MatchSessionController({
      serverUrl: "ws://example.test",
      socketFactory: () => socket,
      requestTimeoutMs: 1000
    });
    controller.start();
    socket.open();
    expect(sent(socket)).toEqual({ type: "hello", protocolVersion: "2.0.0" });
    socket.receive({ type: "welcome", protocolVersion: "2.0.0" });
    const create = controller.createRoom("Alice");
    const created = sent(socket);
    expect(created).toMatchObject({ type: "create-room", playerName: "Alice", rulesetId: "riftbound-duel" });
    socket.receive({ type: "welcome", protocolVersion: "2.0.0", session: {
      roomId: "room-1", playerId: "player-1", resumeToken: "resume-1"
    } });
    socket.receive({ type: "room", room: room(4) });
    socket.receive({ type: "request-result", requestId: created.requestId, ok: true });
    await expect(create).resolves.toMatchObject({ roomId: "room-1", roomVersion: 4 });
    const submit = controller.submitDeck({ runes: [{ cardId: "rune", quantity: 1 }] });
    expect(sent(socket)).toMatchObject({ type: "submit-deck", expectedRoomVersion: 4 });
    socket.receive({ type: "request-result", requestId: sent(socket).requestId, ok: true });
    await expect(submit).resolves.toMatchObject({ roomVersion: 4 });
    controller.stop();
  });

  it("uses the resume cursor after reconnect and keeps a pending command id stable", async () => {
    const sockets: FakeSocket[] = [];
    const controller = new V2MatchSessionController({
      serverUrl: "ws://example.test",
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      reconnectDelayMs: 0,
      commandTimeoutMs: 1000
    }, { roomId: "room-1", playerId: "player-1", resumeToken: "resume-1" });
    controller.start();
    sockets[0]!.open();
    expect(sent(sockets[0]!)).toMatchObject({ type: "hello", protocolVersion: "2.0.0",
      roomId: "room-1", resumeToken: "resume-1", afterEventSeq: 0 });
    sockets[0]!.receive({ type: "welcome", protocolVersion: "2.0.0", resumed: true, session: {
      roomId: "room-1", playerId: "player-1", resumeToken: "resume-1"
    } });
    const pending = controller.sendCommand({ type: "pass" });
    const before = sent(sockets[0]!);
    expect(before).toMatchObject({ type: "command", protocolVersion: "2.0.0",
      command: { type: "pass", stateVersion: 0 } });
    sockets[0]!.close();
    await new Promise(resolve => setTimeout(resolve, 5));
    sockets[1]!.open();
    sockets[1]!.receive({ type: "welcome", protocolVersion: "2.0.0", resumed: true, session: {
      roomId: "room-1", playerId: "player-1", resumeToken: "resume-1"
    } });
    const resent = sockets[1]!.sent.map(value => JSON.parse(value)).find(packet => packet.type === "command");
    expect(resent.command.commandId).toBe(before.command.commandId);
    sockets[1]!.receive({ type: "command-receipt", protocolVersion: "2.0.0",
      commandId: before.command.commandId, stateVersion: 1, eventSeq: 1,
      accepted: true, duplicate: true, rejection: null });
    await expect(pending).resolves.toMatchObject({ accepted: true, duplicate: true });
    controller.stop();
  });

  it("surfaces the server rejection reason", async () => {
    const socket = new FakeSocket();
    const controller = new V2MatchSessionController({ serverUrl: "ws://example.test", socketFactory: () => socket,
      requestTimeoutMs: 1000 });
    controller.start();
    socket.open();
    socket.receive({ type: "welcome", protocolVersion: "2.0.0" });
    const pending = controller.sendCommand({ type: "concede" });
    const packet = sent(socket);
    socket.receive({ type: "command-receipt", protocolVersion: "2.0.0",
      commandId: packet.command.commandId, stateVersion: 0, eventSeq: 0,
      accepted: false, duplicate: false, rejection: "Duel resources: insufficient Energy" });
    await expect(pending).rejects.toThrow("insufficient Energy");
    expect(controller.snapshot.error).toBe("Duel resources: insufficient Energy");
    controller.stop();
  });

  it("falls back to a fresh session when a saved resume token is rejected", () => {
    const sockets: FakeSocket[] = [];
    const controller = new V2MatchSessionController({
      serverUrl: "ws://example.test",
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      reconnectDelayMs: 0
    }, { roomId: "old-room", playerId: "player-1", resumeToken: "stale" });
    controller.start();
    sockets[0]!.open();
    expect(sent(sockets[0]!)).toMatchObject({ type: "hello", resumeToken: "stale" });
    sockets[0]!.receive({ type: "error", code: "invalid-token", message: "Invalid resume token" });
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    expect(sent(sockets[1]!)).toEqual({ type: "hello", protocolVersion: "2.0.0" });
    expect(controller.currentSession).toBeNull();
    controller.stop();
  });
});
