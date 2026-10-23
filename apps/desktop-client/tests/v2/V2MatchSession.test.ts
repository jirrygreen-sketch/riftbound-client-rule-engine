import { describe, expect, it } from "vitest";
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
