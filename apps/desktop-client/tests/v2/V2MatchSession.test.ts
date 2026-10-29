import { describe, expect, it, vi } from "vitest";
import type { V2Socket } from "../../src/transport/v2";
import {
  buildV2Hello,
  V2MatchSessionController
} from "../../src/full-product/v2/V2MatchSession";

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

function sent(socket: FakeSocket, index = -1): any {
  return JSON.parse(socket.sent.at(index) ?? "null");
}

describe("V2 waiting-room resume cursor", () => {
  it("sends cursor 0 before the game starts and the authoritative event cursor after events exist", async () => {
    expect(buildV2Hello({ roomId: "room-1", playerId: "player-1", resumeToken: "resume-1" }))
      .toEqual({ type: "hello", protocolVersion: "2.0.0", roomId: "room-1", resumeToken: "resume-1", afterEventSeq: 0 });
    expect(buildV2Hello({ roomId: "room-1", playerId: "player-1", resumeToken: "resume-1" }, {
      eventSeq: 0
    })).toMatchObject({ afterEventSeq: 0 });
    expect(buildV2Hello({ roomId: "room-1", playerId: "player-1", resumeToken: "resume-1" }, {
      eventSeq: 4
    })).toMatchObject({ afterEventSeq: 4 });

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
    expect(sent(sockets[0]!)).toMatchObject({
      type: "hello", protocolVersion: "2.0.0", roomId: "room-1", resumeToken: "resume-1"
    });
    expect(sent(sockets[0]!)).toMatchObject({ afterEventSeq: 0 });

    sockets[0]!.receive({ type: "welcome", protocolVersion: "2.0.0", resumed: true, session: {
      roomId: "room-1", playerId: "player-1", resumeToken: "resume-1"
    } });
    sockets[0]!.receive({
      type: "owner-deck-confirmation", schema: "owner-deck-confirmation-v1",
      roomId: "room-1", playerId: "player-1", rulesetId: "riftbound-duel",
      roomVersion: 1, roomEventSeq: 0,
      catalog: { dataVersion: "test", digest: "sha256:test" }, deck: null
    });
    expect(controller.snapshot.error).toBeNull();
    const pending = controller.sendCommand({ type: "pass" });
    const command = sent(sockets[0]!);
    sockets[0]!.close();
    await new Promise(resolve => setTimeout(resolve, 5));
    sockets[1]!.open();
    sockets[1]!.receive({ type: "welcome", protocolVersion: "2.0.0", resumed: true, session: {
      roomId: "room-1", playerId: "player-1", resumeToken: "resume-1"
    } });
    sockets[1]!.receive({ type: "command-receipt", protocolVersion: "2.0.0",
      commandId: command.command.commandId, stateVersion: 1, eventSeq: 1,
      accepted: true, duplicate: true, rejection: null });
    await expect(pending).resolves.toMatchObject({ accepted: true, duplicate: true });

    sockets[1]!.close();
    await new Promise(resolve => setTimeout(resolve, 5));
    sockets[2]!.open();
    expect(sent(sockets[2]!)).toMatchObject({
      type: "hello", protocolVersion: "2.0.0", roomId: "room-1",
      resumeToken: "resume-1", afterEventSeq: 1
    });
    controller.stop();
  });

  it("accepts only the authenticated owner echo and rejects a mismatched owner", () => {
    const sockets: FakeSocket[] = [];
    const controller = new V2MatchSessionController({
      serverUrl: "ws://example.test",
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      }
    }, { roomId: "room-1", playerId: "player-1", resumeToken: "resume-1" });
    controller.start();
    sockets[0]!.open();
    sockets[0]!.receive({ type: "welcome", protocolVersion: "2.0.0", resumed: true, session: {
      roomId: "room-1", playerId: "player-1", resumeToken: "resume-1"
    } });
    const echo = {
      type: "owner-deck-confirmation", schema: "owner-deck-confirmation-v1",
      roomId: "room-1", playerId: "player-1", rulesetId: "riftbound-duel",
      roomVersion: 1, roomEventSeq: 0,
      catalog: { dataVersion: "test", digest: "sha256:test" }, deck: null
    } as const;
    sockets[0]!.receive(echo);
    expect(controller.snapshot.error).toBeNull();

    sockets[0]!.receive({ ...echo, playerId: "player-2" });
    expect(controller.snapshot.error).toBe("V2 服务端返回了未识别数据包。");
    controller.stop();
  });
});

// RIFT-1148: a long turn kept the HK server busy for ~40 s while the client
// gave up after five 5 s retries and stayed on a stale stateVersion.
describe("V2 slow command receipts", () => {
  function connected(options: { readonly commandTimeoutMs: number; readonly commandGiveUpMs: number }) {
    const sockets: FakeSocket[] = [];
    const controller = new V2MatchSessionController({
      serverUrl: "ws://example.test",
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      reconnectDelayMs: 0,
      ...options
    }, { roomId: "room-1", playerId: "player-1", resumeToken: "resume-1" });
    controller.start();
    sockets[0]!.open();
    sockets[0]!.receive({ type: "welcome", protocolVersion: "2.0.0", resumed: true, session: {
      roomId: "room-1", playerId: "player-1", resumeToken: "resume-1"
    } });
    return { controller, sockets };
  }
  const commandsSent = (socket: FakeSocket) => socket.sent.map(raw => JSON.parse(raw)).filter(packet => packet.type === "command");

  it("keeps waiting with backed-off resends and accepts a receipt that arrives after 25 s", async () => {
    vi.useFakeTimers();
    try {
      const { controller, sockets } = connected({ commandTimeoutMs: 5_000, commandGiveUpMs: 120_000 });
      vi.setSystemTime(1_000_000);
      const pending = controller.sendCommand({ type: "end-turn" });
      expect(controller.snapshot.pendingCommandSince).toBe(1_000_000);
      vi.advanceTimersByTime(40_000);
      // Resends at 5, 15, 35 s (1x, 2x, 4x backoff), not five sends in 25 s.
      expect(commandsSent(sockets[0]!)).toHaveLength(4);
      expect(new Set(commandsSent(sockets[0]!).map(packet => packet.command.commandId)).size).toBe(1);
      expect(controller.snapshot.error).toBeNull();
      const commandId = commandsSent(sockets[0]!)[0].command.commandId;
      sockets[0]!.receive({ type: "command-receipt", protocolVersion: "2.0.0", commandId,
        stateVersion: 76, eventSeq: 1150, accepted: true, duplicate: false, rejection: null });
      await expect(pending).resolves.toMatchObject({ accepted: true, stateVersion: 76 });
      expect(controller.snapshot.pendingCommandIds).toEqual([]);
      expect(controller.snapshot.pendingCommandSince).toBeNull();
      controller.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up only after the total wait and reconnects to resync instead of keeping a stale state", async () => {
    vi.useFakeTimers();
    try {
      const { controller, sockets } = connected({ commandTimeoutMs: 1_000, commandGiveUpMs: 10_000 });
      const pending = controller.sendCommand({ type: "end-turn" });
      const outcome = pending.then(() => "resolved", (error: Error) => error.message);
      vi.advanceTimersByTime(9_000);
      expect(controller.snapshot.pendingCommandIds).toHaveLength(1);
      expect(sockets).toHaveLength(1);
      vi.advanceTimersByTime(1_000);
      expect(await outcome).toMatch(/等待服务端回执超过 10 秒，已重新同步对局状态/);
      expect(controller.snapshot.pendingCommandIds).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(2);
      sockets[1]!.open();
      expect(JSON.parse(sockets[1]!.sent[0]!)).toMatchObject({ type: "hello", roomId: "room-1", resumeToken: "resume-1" });
      controller.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
