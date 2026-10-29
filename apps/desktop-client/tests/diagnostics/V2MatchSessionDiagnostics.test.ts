import { beforeEach, describe, expect, it } from "vitest";
import type { V2Socket } from "../../src/transport/v2";
import { V2MatchSessionController } from "../../src/full-product/v2/V2MatchSession";
import { getClientLog } from "../../src/diagnostics/client-log";
import { readActiveMatchRoom, readMatchLog } from "../../src/diagnostics/match-log";
import { event, MemoryStorage, projection } from "./fixtures";

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

let storage: MemoryStorage;

beforeEach(() => { storage = new MemoryStorage(); });

describe("V2 diagnostic capture points", () => {
  it("records room, projection summary, command, accepted receipt and status changes", async () => {
    const socket = new FakeSocket();
    const controller = new V2MatchSessionController({
      serverUrl: "ws://127.0.0.1:37480", socketFactory: () => socket,
      diagnosticStorage: storage, requestTimeoutMs: 1_000, reconnectDelayMs: 0
    }, { roomId: "room-diagnostics", playerId: "player-1", resumeToken: "resume-hint" });
    controller.start();
    socket.open();
    socket.receive({ type: "welcome", protocolVersion: "2.0.0",
      session: { roomId: "room-diagnostics", playerId: "player-1", resumeToken: "secret-resume" } });
    socket.receive({ type: "room", room: {
      roomId: "room-diagnostics", status: "playing", rulesetId: "riftbound-duel",
      version: 0, roomVersion: 1, roomEventSeq: 0, players: []
    } });
    socket.receive({ type: "projection", protocolVersion: "2.0.0", projection: projection({
      matchId: "match-diagnostics", stateVersion: 9, eventSeq: 4
    }) });
    const pending = controller.sendCommand({ type: "pass" });
    const command = socket.sent.map(value => JSON.parse(value) as Record<string, unknown>)
      .find(value => value.type === "command") as { command: { commandId: string } };
    socket.receive({ type: "command-receipt", protocolVersion: "2.0.0",
      commandId: command.command.commandId, stateVersion: 9, eventSeq: 4,
      accepted: true, duplicate: false, rejection: null });
    await pending;
    controller.stop();

    const log = readMatchLog(storage, "room-diagnostics");
    expect(log?.entries.map(entry => entry.kind)).toEqual(expect.arrayContaining([
      "projection", "command", "receipt", "status"
    ]));
    const projectionIndex = log?.entries.findIndex(entry => entry.kind === "projection") ?? -1;
    expect(projectionIndex).toBeGreaterThanOrEqual(0);
    expect(log?.entries[projectionIndex]?.payload).toMatchObject({
      stateVersion: 9, eventSeq: 4, phase: "main", turnNumber: 2,
      activePlayerId: "player-1", pendingChoice: { status: "none" }
    });
    expect(log?.entries[projectionIndex]?.payload).not.toHaveProperty("players");
    expect(getClientLog().some(entry => entry.source === "v2-session" &&
      entry.message.includes("connected"))).toBe(true);
    expect(JSON.stringify(log)).not.toContain("secret-resume");
    expect(readActiveMatchRoom(storage)).toBeNull();
  });

  it("records a rejected command receipt and reason", async () => {
    const socket = new FakeSocket();
    const controller = new V2MatchSessionController({
      serverUrl: "ws://127.0.0.1:37480", socketFactory: () => socket,
      diagnosticStorage: storage, requestTimeoutMs: 1_000
    }, { roomId: "room-reject", playerId: "player-1", resumeToken: "not-for-log" });
    controller.start();
    socket.open();
    socket.receive({ type: "welcome", protocolVersion: "2.0.0", resumed: true,
      session: { roomId: "room-reject", playerId: "player-1", resumeToken: "new-secret" } });
    const pending = controller.sendCommand({ type: "concede" });
    const commandPacket = socket.sent.map(value => JSON.parse(value) as Record<string, unknown>)
      .find(value => value.type === "command") as { command: { commandId: string } };
    socket.receive({ type: "command-receipt", protocolVersion: "2.0.0",
      commandId: commandPacket.command.commandId, stateVersion: 0, eventSeq: 0,
      accepted: false, duplicate: false, rejection: "Duel resources: insufficient Energy" });
    await expect(pending).rejects.toThrow("insufficient Energy");
    controller.stop();

    const log = readMatchLog(storage, "room-reject");
    expect(log?.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "receipt", payload: expect.objectContaining({ accepted: false }) }),
      expect.objectContaining({ kind: "error", payload: expect.objectContaining({
        message: "Duel resources: insufficient Energy"
      }) })
    ]));
    expect(getClientLog()).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "error", source: "v2-session",
        message: "Duel resources: insufficient Energy" })
    ]));
    expect(JSON.stringify(log)).not.toContain("not-for-log");
    expect(JSON.stringify(log)).not.toContain("new-secret");
  });

  it("records a reconnect-delivered rejection even when its local pending entry is gone", () => {
    const socket = new FakeSocket();
    const controller = new V2MatchSessionController({
      serverUrl: "ws://127.0.0.1:37480", socketFactory: () => socket,
      diagnosticStorage: storage, requestTimeoutMs: 1_000
    }, { roomId: "room-replayed-reject", playerId: "player-1", resumeToken: "hidden-token" });
    controller.start();
    socket.open();
    socket.receive({ type: "welcome", protocolVersion: "2.0.0", resumed: true,
      session: { roomId: "room-replayed-reject", playerId: "player-1",
        resumeToken: "hidden-token" } });
    socket.receive({ type: "command-receipt", protocolVersion: "2.0.0",
      commandId: "already-completed-before-reconnect", stateVersion: 3, eventSeq: 2,
      accepted: false, duplicate: true, rejection: "Choice is no longer pending" });
    controller.stop();

    const log = readMatchLog(storage, "room-replayed-reject");
    expect(log?.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "receipt", payload: expect.objectContaining({
        commandId: "already-completed-before-reconnect", duplicate: true
      }) }),
      expect.objectContaining({ kind: "error", payload: expect.objectContaining({
        message: "Choice is no longer pending"
      }) })
    ]));
    expect(getClientLog().some(entry => entry.message === "Choice is no longer pending"))
      .toBe(true);
    expect(JSON.stringify(log)).not.toContain("hidden-token");
  });

  it("records projection.events with projection snapshots and de-duplicates replays", () => {
    const socket = new FakeSocket();
    const controller = new V2MatchSessionController({
      serverUrl: "ws://127.0.0.1:37480", socketFactory: () => socket,
      diagnosticStorage: storage, requestTimeoutMs: 1_000
    }, { roomId: "room-projection-events", playerId: "player-1", resumeToken: "private" });
    controller.start();
    socket.open();
    socket.receive({ type: "welcome", protocolVersion: "2.0.0", resumed: true,
      session: { roomId: "room-projection-events", playerId: "player-1",
        resumeToken: "private" } });
    const first = projection({ matchId: "match-events", eventSeq: 2,
      events: [event(1), event(2)] });
    socket.receive({ type: "projection", protocolVersion: "2.0.0", projection: first });
    socket.receive({ type: "projection", protocolVersion: "2.0.0", projection: {
      ...first, stateVersion: 10, eventSeq: 3, events: [event(1), event(2), event(3, 10)]
    } });
    socket.receive({ type: "event", protocolVersion: "2.0.0", event: event(3, 10) });
    controller.stop();

    const log = readMatchLog(storage, "room-projection-events");
    expect(log?.entries.filter(entry => entry.kind === "event").map(entry => entry.eventSeq))
      .toEqual([1, 2, 3]);
    expect(log?.entries.filter(entry => entry.kind === "event").map(entry => entry.payload))
      .toEqual([
        expect.objectContaining({ timingPoint: "card-played", eventSeq: 1 }),
        expect.objectContaining({ timingPoint: "card-played", eventSeq: 2 }),
        expect.objectContaining({ timingPoint: "card-played", eventSeq: 3 })
      ]);
    expect(log?.entries.filter(entry => entry.kind === "projection")).toHaveLength(2);
  });

  it("clears the active room on session stop and room exit", () => {
    const socket = new FakeSocket();
    const controller = new V2MatchSessionController({
      serverUrl: "ws://127.0.0.1:37480", socketFactory: () => socket,
      diagnosticStorage: storage, requestTimeoutMs: 1_000
    }, { roomId: "room-lifecycle", playerId: "player-1", resumeToken: "private" });
    controller.start();
    socket.open();
    socket.receive({ type: "welcome", protocolVersion: "2.0.0", resumed: true,
      session: { roomId: "room-lifecycle", playerId: "player-1", resumeToken: "private" } });
    socket.receive({ type: "room", room: { roomId: "room-lifecycle", status: "playing",
      rulesetId: "riftbound-duel", version: 0, roomVersion: 1, roomEventSeq: 0, players: [] } });
    expect(readActiveMatchRoom(storage)).toBe("room-lifecycle");
    controller.stop();
    expect(readActiveMatchRoom(storage)).toBeNull();
  });
});
