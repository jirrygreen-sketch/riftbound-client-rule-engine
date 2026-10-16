import { describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_V2_EVENT_CONTRACT,
  PROTOCOL_V2_PROJECTION_CONTRACT,
  PROTOCOL_V2_VERSION,
  isV2ClientMessage,
  isV2Projection,
  type V2EngineEvent,
  type V2Projection
} from "../../../../packages/protocol/src/v2/index.js";
import { V2Transport, type V2Socket } from "../../src/transport/v2/index.js";
import {
  applyV2Event,
  applyV2ServerMessage,
  createV2ClientState,
  V2ClientStateStore
} from "../../src/state/v2/index.js";
import {
  buildV2ChooseCommand,
  createV2ChoiceUiState,
  isLegalV2ChoiceAnswer,
  updateV2ChoiceUiState
} from "../../src/state/v2/index.js";

class FakeSocket implements V2Socket {
  public readyState = 0;
  public onopen: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  public onclose: ((event: unknown) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public readonly sent: string[] = [];

  public send(data: string): void {
    if (this.readyState !== 1) throw new Error("socket is not open");
    this.sent.push(data);
  }

  public close(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }

  public open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  public receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  public drop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
}

function event(eventSeq: number, stateVersion = eventSeq): V2EngineEvent {
  return {
    contract: PROTOCOL_V2_EVENT_CONTRACT,
    seq: eventSeq,
    eventSeq,
    stateVersion,
    timingPoint: "card-played",
    audience: { visibility: "public" },
    payload: { eventSeq: { visibility: "public", value: eventSeq } }
  };
}

function projection(
  stateVersion = 0,
  eventSeq = stateVersion,
  pendingChoice: V2Projection["pendingChoice"] = { status: "none" }
): V2Projection {
  const value: V2Projection = {
    projectionContract: PROTOCOL_V2_PROJECTION_CONTRACT,
    protocolVersion: PROTOCOL_V2_VERSION,
    rulesetVersion: "core-1.5",
    matchId: "match-1",
    viewerPlayerId: "alice",
    stateVersion,
    eventSeq,
    phase: "main",
    turnNumber: 1,
    activePlayerId: "alice",
    players: [
      { playerId: "alice", name: "Alice", score: 0, energy: 0, power: {}, xp: 0, handCount: 0, deckCount: 1, runeDeckCount: 1, zoneCounts: {} },
      { playerId: "bob", name: "Bob", score: 0, energy: 0, power: {}, xp: 0, handCount: 0, deckCount: 1, runeDeckCount: 1, zoneCounts: {} }
    ],
    zones: [],
    objects: [],
    chain: { status: "open", phase: "open", priorityPlayerId: "alice", focusPlayerId: null, items: [] },
    priority: { playerId: "alice", focusPlayerId: null, window: "open" },
    scoring: {
      victoryScore: 8,
      battlefieldLocationIds: [],
      players: [
        { playerId: "alice", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] },
        { playerId: "bob", points: 0, controlledBattlefieldIds: [], scoredBattlefieldLocationIds: [] }
      ]
    },
    pendingChoice,
    winnerPlayerId: null,
    events: eventSeq > 0 ? Array.from({ length: eventSeq }, (_, index) => event(index + 1)) : []
  };
  expect(isV2Projection(value)).toBe(true);
  return value;
}

describe("protocol v2 desktop transport and projection state", () => {
  it("sends a guarded command and applies a normal projection/event flow", async () => {
    const socket = new FakeSocket();
    const received: unknown[] = [];
    const transport = new V2Transport({
      url: "ws://example.test/match",
      socketFactory: () => socket,
      onEvent: item => received.push(item)
    });
    const store = new V2ClientStateStore({ viewerPlayerId: "alice" });
    transport.subscribe(item => {
      if (item.type === "projection") store.apply({ type: "projection", protocolVersion: PROTOCOL_V2_VERSION, projection: item.projection });
      if (item.type === "event") store.apply({ type: "event", protocolVersion: PROTOCOL_V2_VERSION, event: item.event });
    });

    transport.connect();
    socket.open();
    socket.receive({ type: "projection", protocolVersion: PROTOCOL_V2_VERSION, projection: projection() });
    const receiptPromise = transport.sendCommand({ type: "pass" });
    const packet = JSON.parse(socket.sent[0] ?? "null") as unknown;
    expect(isV2ClientMessage(packet)).toBe(true);
    if (!isV2ClientMessage(packet)) throw new Error("expected a v2 command packet");
    socket.receive({
      type: "command-receipt",
      protocolVersion: PROTOCOL_V2_VERSION,
      commandId: packet.command.commandId,
      stateVersion: 1,
      eventSeq: 1,
      accepted: true,
      duplicate: false,
      rejection: null
    });
    expect((await receiptPromise).accepted).toBe(true);
    socket.receive({ type: "event", protocolVersion: PROTOCOL_V2_VERSION, event: event(1, 1) });
    expect(store.state.eventSeq).toBe(1);
    expect(store.state.events.map(item => item.eventSeq)).toEqual([1]);
    expect(received.some(item => item.type === "receipt")).toBe(true);
  });

  it("buffers gaps, drains them in order, and ignores duplicate events", () => {
    let state = createV2ClientState({ viewerPlayerId: "alice" });
    const second = applyV2Event(state, event(2, 2));
    expect(second.accepted).toBe(true);
    expect(second.buffered).toBe(true);
    state = second.state;
    const first = applyV2Event(state, event(1, 1));
    expect(first.buffered).toBe(false);
    state = first.state;
    expect(state.eventSeq).toBe(2);
    expect(state.events.map(item => item.eventSeq)).toEqual([1, 2]);
    const duplicate = applyV2Event(state, event(1, 1));
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.state.events).toHaveLength(2);
  });

  it("reconnects with state and event cursors and retries the same command id", async () => {
    vi.useFakeTimers();
    try {
      const sockets: FakeSocket[] = [];
      const transport = new V2Transport({
        url: "ws://example.test/match?room=one",
        socketFactory: url => {
          expect(url).toContain("stateVersion=4");
          expect(url).toContain("eventSeq=7");
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket;
        },
        initialCursor: { stateVersion: 4, eventSeq: 7 },
        retryDelayMs: 1,
        commandTimeoutMs: 20
      });
      transport.connect();
      sockets[0]?.open();
      transport.handleIncoming({ type: "projection", protocolVersion: PROTOCOL_V2_VERSION, projection: projection(4, 7) });
      const pending = transport.sendCommand({ type: "pass" });
      const firstPacket = JSON.parse(sockets[0]?.sent[0] ?? "null") as { command: { commandId: string } };
      sockets[0]?.drop();
      vi.advanceTimersByTime(2);
      sockets[1]?.open();
      expect(sockets[1]?.sent).toHaveLength(1);
      const retryPacket = JSON.parse(sockets[1]?.sent[0] ?? "null") as { command: { commandId: string } };
      expect(retryPacket.command.commandId).toBe(firstPacket.command.commandId);
      sockets[1]?.receive({
        type: "command-receipt",
        protocolVersion: PROTOCOL_V2_VERSION,
        commandId: retryPacket.command.commandId,
        stateVersion: 5,
        eventSeq: 8,
        accepted: true,
        duplicate: true,
        rejection: null
      });
      await expect(pending).resolves.toMatchObject({ accepted: true, duplicate: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects malformed server packets without changing projection state", () => {
    const errors: unknown[] = [];
    const transport = new V2Transport({ url: "ws://example.test", socketFactory: () => new FakeSocket(), onEvent: item => errors.push(item) });
    expect(transport.handleIncoming({ type: "projection", protocolVersion: "1.0.0" })).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ type: "error", error: { code: "invalid-message" } });

    const state = createV2ClientState({ viewerPlayerId: "alice" });
    const result = applyV2ServerMessage(state, { type: "event", protocolVersion: PROTOCOL_V2_VERSION, event: { timingPoint: "unknown" } });
    expect(result.accepted).toBe(false);
    expect(result.state.projection).toBeNull();
    expect(result.state.rejectedMessages).toBe(1);
  });

  it("keeps choose pending options local, checks legality, and expires them", () => {
    const pending = {
      status: "pending" as const,
      choiceId: "choice-1",
      ownerPlayerId: "alice",
      stateVersion: 9,
      kind: "mode" as const,
      options: [{ id: "yes", label: "Yes", value: true }]
    };
    const state = createV2ChoiceUiState(pending, { viewerPlayerId: "alice", now: 100, timeoutMs: 50 });
    expect(state.answerable).toBe(true);
    expect(isLegalV2ChoiceAnswer(state, true, "alice")).toBe(true);
    expect(isLegalV2ChoiceAnswer(state, false, "alice")).toBe(false);
    expect(buildV2ChooseCommand(state, true, "choose-1")).toMatchObject({ choiceId: "choice-1", stateVersion: 9 });
    const expired = updateV2ChoiceUiState(state, pending, { viewerPlayerId: "alice", now: 150, timeoutMs: 50 });
    expect(expired.status).toBe("expired");
    expect(expired.answerable).toBe(false);
  });
});

