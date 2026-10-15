import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DUEL_PROJECTION_SCHEMA_V2, PROTOCOL_VERSION, isDuelProjection, isDuelProjectionAny,
  isDuelProjectionV2, type DuelProjection, type DuelProjectionAny, type DuelProjectionV2,
  type DuelWireAction
} from "@riftbound/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameClient, type GameClientHandlers } from "../src/net/GameClient";

const url = "ws://127.0.0.1:8787/ws";
const session = { roomId: "room-1", playerId: "p1", resumeToken: "private-token" };
const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../../packages/protocol/test/fixtures/duel-projections.json", import.meta.url
)), "utf8")) as Record<string, Record<string, DuelProjection>>;

class Socket {
  static readonly OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  private listeners = new Map<string, Array<(event: { data?: string }) => void>>();
  constructor(readonly url: string) { Socket.instances.push(this); }
  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);
  }
  send(payload: string): void { this.sent.push(JSON.parse(payload) as Record<string, unknown>); }
  close(): void { this.readyState = 3; }
  fire(type: string, data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: data === undefined ? undefined : JSON.stringify(data) });
    }
  }
  open(): void { this.readyState = Socket.OPEN; this.fire("open"); }
  receive(data: unknown): void { this.fire("message", data); }
  serverClose(): void { this.close(); this.fire("close"); }
  get commands(): Record<string, unknown>[] {
    return this.sent.filter(message => message.type === "duel-command" || message.type === "command");
  }
}

let originalSocket: unknown;
let originalWindow: unknown;
let originalCrypto: unknown;
let hadSocket: boolean;
let hadWindow: boolean;
let hadCrypto: boolean;
const clients: GameClient[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  hadSocket = Object.hasOwn(globalThis, "WebSocket");
  hadWindow = Object.hasOwn(globalThis, "window");
  hadCrypto = Object.hasOwn(globalThis, "crypto");
  originalSocket = globalThis.WebSocket;
  originalWindow = globalThis.window;
  originalCrypto = globalThis.crypto;
  Socket.instances = [];
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: Socket });
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  } } });
  let nextId = 0;
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: {
    randomUUID: () => `command-uuid-${++nextId}`
  } });
});
afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const [key, present, value] of [
    ["WebSocket", hadSocket, originalSocket], ["window", hadWindow, originalWindow],
    ["crypto", hadCrypto, originalCrypto]
  ] as const) {
    if (present) Object.defineProperty(globalThis, key, { configurable: true, value });
    else Reflect.deleteProperty(globalThis, key);
  }
});

function socket(): Socket {
  const result = Socket.instances.at(-1);
  if (!result) throw Error("No socket");
  return result;
}
function harness() {
  const projections: Array<DuelProjectionAny | null> = [];
  const legacy: unknown[] = [];
  const pending: boolean[] = [];
  const errors: string[] = [];
  const handlers: GameClientHandlers = {
    onStatus() {}, onSession() {}, onProjection: value => legacy.push(value),
    onDuelProjection: value => projections.push(value), onError: value => errors.push(value),
    onRoom() {}, onHandshake() {}, onPendingCommand: value => pending.push(value)
  };
  const client = new GameClient(handlers);
  clients.push(client);
  client.connect(url);
  const first = socket();
  first.open();
  return { client, first, projections, legacy, pending, errors };
}
function welcome(s: Socket, auth = session): void {
  s.receive({ type: "welcome", protocolVersion: PROTOCOL_VERSION, session: auth, resumed: true });
}
function sendProjection(s: Socket, projection: DuelProjectionAny, roomId = session.roomId): void {
  expect(isDuelProjectionAny(projection)).toBe(true);
  s.receive({ type: "duel-projection", roomId, projection });
}
function fixture(scenario: string, viewer = "p1"): DuelProjection {
  const result = fixtures[scenario]?.[viewer];
  if (!result) throw Error(`missing fixture ${scenario}/${viewer}`);
  return structuredClone(result);
}
function v2Fixture(scenario: string): DuelProjectionV2 {
  const source = fixture(scenario);
  if (source.match.stage === "setup") {
    return { ...source, projectionSchema: DUEL_PROJECTION_SCHEMA_V2,
      match: { ...source.match, schemaVersion: 2 } };
  }
  return { ...source, projectionSchema: DUEL_PROJECTION_SCHEMA_V2,
    match: { ...source.match, schemaVersion: 2 } };
}
/** Rebrand any V1 fixture (including its actions) onto the real V2 wire schema. */
function asV2(source: DuelProjection): DuelProjectionV2 {
  if (source.match.stage === "setup") {
    return { ...source, projectionSchema: DUEL_PROJECTION_SCHEMA_V2,
      match: { ...source.match, schemaVersion: 2 } };
  }
  return { ...source, projectionSchema: DUEL_PROJECTION_SCHEMA_V2,
    match: { ...source.match, schemaVersion: 2 } };
}
function withActions(projection: DuelProjection, actions: readonly DuelWireAction[]): DuelProjection {
  return { ...projection, actions };
}
function setupWithAction(): DuelProjection {
  const setup = fixture("setup");
  return withActions(setup, [{
    id: "mulligan-p1", kind: "mulligan", label: "调度", enabled: true,
    selectableUIDs: setup.match.stage === "setup" ? setup.match.setup.players[0].hand!.map(card => card.uid) : [],
    maxSelections: 2
  }]);
}
function poolWithActions(stateVersion = 3): DuelProjection {
  const base = fixture("changed");
  (base.match as unknown as { stateVersion: number; eventSeq: number }).stateVersion = stateVersion;
  (base.match as unknown as { stateVersion: number; eventSeq: number }).eventSeq = stateVersion;
  return withActions(base, [
    { id: "rune-e", kind: "rune-energy", label: "能量", enabled: true, uid: "p1-rune" },
    { id: "rune-p", kind: "rune-power", label: "威能", enabled: true, uid: "p1-rune" },
    { id: "gold-p", kind: "gold-power", label: "金币", enabled: true, uid: "gold-1" }
  ]);
}

function receipt(s: Socket, command: Record<string, unknown>, overrides: Record<string, unknown> = {}): void {
  s.receive({ type: "request-result", requestId: command.requestId, ok: true,
    commandId: command.commandId, appliedVersion: command.expectedVersion,
    eventSeq: command.expectedVersion, ...overrides });
}

describe("Duel GameClient authenticated transport", () => {
  it("accepts V2 via the explicit union without widening the legacy V1 guard", () => {
    const h = harness(); welcome(h.first);
    const v1 = fixture("setup");
    const v2 = v2Fixture("setup");
    expect(isDuelProjection(v1)).toBe(true);
    expect(isDuelProjection(v2)).toBe(false);
    expect(isDuelProjectionV2(v2)).toBe(true);
    expect(isDuelProjectionAny(v2)).toBe(true);
    // V1 is accepted first (same clock) and a V2 frame at the same clock is an
    // allowed promotion; the shared union path carries both without widening
    // the legacy V1-only guard.
    sendProjection(h.first, v1);
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(1);
    sendProjection(h.first, v2);
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
    expect(h.projections.at(-1)?.match.stage).toBe("setup");
    sendProjection(h.first, v2Fixture("playing"));
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
    expect(h.projections.at(-1)?.match.stage).toBe("playing");
    expect(h.legacy.at(-1)).toBeNull();
  });

  it("accepts real setup, playing and pool DTO values, not a cast from Foundation", () => {
    const h = harness();
    sendProjection(h.first, setupWithAction()); // no welcome
    expect(h.projections.at(-1)).toBeNull();
    welcome(h.first);
    sendProjection(h.first, setupWithAction());
    expect(h.projections.at(-1)?.match.stage).toBe("setup");
    expect(h.projections.at(-1)?.match.stateVersion).toBe(0);
    expect(h.projections.at(-1)?.match.stage === "setup" && h.projections.at(-1)?.match.setup.players[0].hand?.[0]?.cardId).toBe("card.0.1");
    sendProjection(h.first, fixture("playing"));
    sendProjection(h.first, poolWithActions());
    const actual = h.projections.at(-1)!;
    expect(actual.match.stage).toBe("playing");
    if (actual.match.stage !== "playing") throw Error("Expected playing");
    expect(actual.match.resources.bases[0].baseRunes[0]?.cardId).toBe("rune.Fury");
    expect(actual.match.resources.bases[0].goldTokens[0]?.uid).toBe("gold-1");
    expect(actual.match.frame.phase).toBe("main");
    expect(h.legacy.at(-1)).toBeNull();
  });

  it("rejects foreign rooms, viewer mismatch, null viewer, absent roster and old match/stale clocks", () => {
    const h = harness(); welcome(h.first);
    const current = setupWithAction();
    sendProjection(h.first, current, "other-room");
    sendProjection(h.first, fixture("setup", "p2"));
    sendProjection(h.first, fixture("setup", "null"));
    const absent = structuredClone(current);
    (absent.match.roster as unknown as Array<{ playerId: string }>)[0]!.playerId = "p3";
    h.first.receive({ type: "duel-projection", roomId: session.roomId, projection: absent });
    expect(h.projections.every(value => value === null)).toBe(true);
    sendProjection(h.first, poolWithActions());
    const count = h.projections.length;
    sendProjection(h.first, fixture("playing"));
    const staleEvents = fixture("changed");
    (staleEvents.match as unknown as { eventSeq: number }).eventSeq = 2;
    sendProjection(h.first, staleEvents);
    const otherMatch = fixture("setup");
    (otherMatch.match as unknown as { matchId: string }).matchId = "match-2";
    sendProjection(h.first, otherMatch);
    expect(h.projections).toHaveLength(count);
    expect(h.projections.at(-1)?.match.matchId).toBe("match-1");
  });

  it("requires a room's observed roster to agree with the Duel match seats", () => {
    const h = harness(); welcome(h.first);
    h.first.receive({ type: "room", room: {
      roomId: session.roomId, status: "playing", rulesetId: "riftbound-duel",
      version: 1, roomVersion: 1, roomEventSeq: 1,
      players: ["p1", "p3"].map(id => ({ id, name: id,
        connected: true, ready: false, deckSubmitted: false }))
    } });
    sendProjection(h.first, setupWithAction());
    expect(h.projections.every(value => value === null)).toBe(true);
    expect(h.client.submitDuelCommand({ type: "mulligan", selectedUIDs: [] })).toBe(false);
  });

  it("ignores a replayed old socket projection after a same-session reconnect", () => {
    const h = harness(); welcome(h.first); sendProjection(h.first, setupWithAction());
    h.first.serverClose(); vi.advanceTimersByTime(1000);
    const second = socket(); second.open(); welcome(second);
    sendProjection(second, poolWithActions());
    const count = h.projections.length;
    h.first.receive({ type: "duel-projection", roomId: session.roomId, projection: setupWithAction() });
    h.first.receive({ type: "welcome", protocolVersion: PROTOCOL_VERSION,
      session: { ...session, playerId: "p2" } });
    expect(h.projections).toHaveLength(count);
    expect(h.projections.at(-1)?.match.stateVersion).toBe(3);
    expect(h.client.submitDuelCommand({ type: "gold-power", uid: "gold-1" })).toBe(true);
  });

  it("accepts version zero only after a witnessed room transition, not an unsolicited match switch", () => {
    const h = harness(); welcome(h.first); sendProjection(h.first, poolWithActions());
    h.first.receive({ type: "room", room: {
      roomId: session.roomId, status: "playing", rulesetId: "riftbound-duel",
      version: 1, roomVersion: 1, roomEventSeq: 1,
      players: ["p1", "p2"].map(id => ({ id, name: id,
        connected: true, ready: false, deckSubmitted: false }))
    } });
    const newMatch = setupWithAction();
    (newMatch.match as unknown as { matchId: string }).matchId = "match-2";
    sendProjection(h.first, newMatch);
    expect(h.projections.at(-1)?.match.matchId).toBe("match-1");
    h.first.receive({ type: "room", room: {
      roomId: session.roomId, status: "waiting", rulesetId: "riftbound-duel",
      version: 2, roomVersion: 2, roomEventSeq: 2,
      players: ["p1", "p2"].map(id => ({ id, name: id,
        connected: true, ready: false, deckSubmitted: false }))
    } });
    const oldCount = h.projections.length;
    sendProjection(h.first, poolWithActions(6));
    expect(h.projections).toHaveLength(oldCount);
    expect(h.client.submitDuelCommand({ type: "gold-power", uid: "gold-1" })).toBe(false);
    sendProjection(h.first, newMatch);
    expect(h.projections.at(-1)?.match.matchId).toBe("match-2");
    expect(h.projections.at(-1)?.match.stateVersion).toBe(0);
    // A delayed replay from the previous match must not use the same waiting
    // witness to restore the old hand or pending command.
    sendProjection(h.first, fixture("setup"));
    expect(h.projections.at(-1)?.match.matchId).toBe("match-2");
    // Another genuine transition must not permit any previously retired match.
    h.first.receive({ type: "room", room: {
      roomId: session.roomId, status: "playing", rulesetId: "riftbound-duel",
      version: 3, roomVersion: 3, roomEventSeq: 3,
      players: ["p1", "p2"].map(id => ({ id, name: id,
        connected: true, ready: false, deckSubmitted: false }))
    } });
    h.first.receive({ type: "room", room: {
      roomId: session.roomId, status: "waiting", rulesetId: "riftbound-duel",
      version: 4, roomVersion: 4, roomEventSeq: 4,
      players: ["p1", "p2"].map(id => ({ id, name: id,
        connected: true, ready: false, deckSubmitted: false }))
    } });
    sendProjection(h.first, fixture("setup"));
    expect(h.projections.at(-1)?.match.matchId).toBe("match-2");
  });

  it("fails closed on an authenticated room contradiction after a Duel projection", () => {
    const h = harness(); welcome(h.first); sendProjection(h.first, poolWithActions());
    h.first.receive({ type: "room", room: {
      roomId: session.roomId, status: "playing", rulesetId: "riftbound-duel",
      version: 3, roomVersion: 1, roomEventSeq: 1,
      players: ["p1", "p2"].map(id => ({ id, name: id,
        connected: true, ready: false, deckSubmitted: false }))
    } });
    expect(h.client.submitDuelCommand({ type: "gold-power", uid: "gold-1" })).toBe(true);
    const sent = h.first.commands.at(-1)!;
    h.first.receive({ type: "room", room: {
      roomId: session.roomId, status: "waiting", rulesetId: "riftbound-foundation",
      version: 4, roomVersion: 2, roomEventSeq: 2,
      players: ["p1", "p2"].map(id => ({ id, name: id,
        connected: true, ready: false, deckSubmitted: false }))
    } });
    expect(h.pending).toEqual([true, false]);
    expect(h.projections.at(-1)).toBeNull();
    expect(h.client.status).toBe("disconnected");
    receipt(h.first, sent);
    expect(h.pending).toEqual([true, false]);
  });

  it("never upgrades a real Foundation room or projection into Duel", () => {
    const h = harness(); welcome(h.first);
    h.first.receive({ type: "room", room: {
      roomId: session.roomId, status: "playing", rulesetId: "riftbound-foundation",
      version: 1, roomVersion: 1, roomEventSeq: 1,
      players: ["p1", "p2"].map(id => ({ id, name: id,
        connected: true, ready: false, deckSubmitted: false }))
    } });
    sendProjection(h.first, setupWithAction());
    expect(h.projections.every(value => value === null)).toBe(true);
    expect(h.client.submitDuelCommand({ type: "mulligan", selectedUIDs: [] })).toBe(false);
  });

  it("requires matching action and exact wire shape for all five commands", () => {
    const h = harness(); welcome(h.first);
    sendProjection(h.first, setupWithAction());
    expect(h.client.submitDuelCommand({ type: "mulligan", selectedUIDs: ["not-owned"] })).toBe(false);
    expect(h.client.submitDuelCommand({ type: "mulligan", selectedUIDs: ["p1-main-1"], actor: "p1" } as never)).toBe(false);
    expect(h.client.submitDuelCommand({ type: "mulligan", selectedUIDs: ["p1-main-1"] })).toBe(true);
    const mulligan = h.first.commands.at(-1)!;
    expect(mulligan).toMatchObject({ type: "duel-command", expectedVersion: 0,
      command: { type: "mulligan", selectedUIDs: ["p1-main-1"] } });
    receipt(h.first, mulligan);
    sendProjection(h.first, poolWithActions());
    let version = 3;
    for (const [kind, uid] of [["rune-energy", "p1-rune"], ["rune-power", "p1-rune"], ["gold-power", "gold-1"]] as const) {
      expect(h.client.submitDuelCommand({ type: kind, uid })).toBe(true);
      const sent = h.first.commands.at(-1)!;
      expect(sent).toMatchObject({ type: "duel-command", expectedVersion: version, command: { type: kind, uid } });
      receipt(h.first, sent);
      version += 1;
      sendProjection(h.first, poolWithActions(version));
    }
    const pay = withActions(fixture("pending"), [{ id: "pay", kind: "pay-pending",
      label: "支付", enabled: true, paymentId: "payment-1" }]);
    (pay.match as unknown as { stateVersion: number; eventSeq: number }).stateVersion = version + 1;
    (pay.match as unknown as { stateVersion: number; eventSeq: number }).eventSeq = version + 1;
    sendProjection(h.first, pay);
    expect(h.client.submitDuelCommand({ type: "pay-pending", paymentId: "payment-1" })).toBe(true);
    expect(h.first.commands.at(-1)).toMatchObject({ type: "duel-command", expectedVersion: version + 1,
      command: { type: "pay-pending", paymentId: "payment-1" } });
    expect(h.client.pass()).toBe(false);
  });

  it("does not mix legacy event cursors with Duel match event clocks", () => {
    const h = harness(); welcome(h.first);
    sendProjection(h.first, poolWithActions());
    h.first.receive({ type: "events", roomId: session.roomId, afterEventSeq: 0,
      nextEventSeq: 40, version: 40, events: [] });
    h.first.serverClose(); vi.advanceTimersByTime(1000);
    const second = socket(); second.open();
    expect(second.sent.at(-1)).not.toHaveProperty("afterEventSeq");
    welcome(second);
    sendProjection(second, poolWithActions());
    expect(h.projections.at(-1)?.match.eventSeq).toBe(3);
  });

  it("does not clear pending on wrong command ID, request ID, incomplete receipt or stale socket", () => {
    const h = harness(); welcome(h.first); sendProjection(h.first, poolWithActions());
    expect(h.client.submitDuelCommand({ type: "rune-energy", uid: "p1-rune" })).toBe(true);
    const sent = h.first.commands.at(-1)!;
    receipt(h.first, sent, { commandId: "wrong" });
    receipt(h.first, sent, { requestId: "wrong" });
    receipt(h.first, sent, { appliedVersion: undefined });
    expect(h.pending).toEqual([true]);
    h.first.serverClose();
    expect(h.projections.at(-1)?.match.matchId).toBe("match-1"); // last safe, read-only
    vi.advanceTimersByTime(1000);
    const second = socket(); second.open(); welcome(second);
    h.first.receive({ type: "request-result", requestId: sent.requestId,
      commandId: sent.commandId, appliedVersion: 3, eventSeq: 3, ok: true });
    second.receive({ type: "request-result", requestId: sent.requestId,
      commandId: sent.commandId, appliedVersion: 3, eventSeq: 3, ok: true });
    expect(h.pending).toEqual([true]);
    sendProjection(second, poolWithActions());
    const retried = second.commands.at(-1)!;
    expect(retried).toMatchObject({ type: "duel-command", commandId: sent.commandId,
      expectedVersion: sent.expectedVersion, command: sent.command });
    expect(retried.requestId).not.toBe(sent.requestId);
    receipt(second, retried, { commandId: "wrong" });
    expect(h.pending).toEqual([true]);
    receipt(second, retried);
    expect(h.pending).toEqual([true, false]);
    expect(h.client.submitDuelCommand({ type: "rune-energy", uid: "p1-rune" })).toBe(false);
    sendProjection(second, poolWithActions(4));
    expect(h.client.submitDuelCommand({ type: "rune-energy", uid: "p1-rune" })).toBe(true);
  });

  it("preserves command ID, payload and original version across timeout even when a newer projection arrives", () => {
    const h = harness(); welcome(h.first); sendProjection(h.first, poolWithActions());
    expect(h.client.submitDuelCommand({ type: "gold-power", uid: "gold-1" })).toBe(true);
    const original = h.first.commands.at(-1)!;
    const newer = poolWithActions();
    (newer.match as unknown as { stateVersion: number; eventSeq: number }).stateVersion = 5;
    (newer.match as unknown as { stateVersion: number; eventSeq: number }).eventSeq = 5;
    sendProjection(h.first, newer);
    vi.advanceTimersByTime(10_000);
    const retried = h.first.commands.at(-1)!;
    expect(retried).toMatchObject({ commandId: original.commandId,
      expectedVersion: original.expectedVersion, command: original.command });
    expect(retried.requestId).not.toBe(original.requestId);
    h.first.receive({ type: "error", requestId: original.requestId,
      code: "stale-version", message: "stale" });
    expect(h.pending).toEqual([true, false]);
  });

  it("keeps a Duel retry on its original version when a reconnect resumes at a newer state version", () => {
    const h = harness(); welcome(h.first);
    sendProjection(h.first, poolWithActions(2));
    expect(h.client.submitDuelCommand({ type: "rune-energy", uid: "p1-rune" })).toBe(true);
    const original = h.first.commands.at(-1)!;
    expect(original).toMatchObject({ type: "duel-command", expectedVersion: 2,
      command: { type: "rune-energy", uid: "p1-rune" } });

    h.first.serverClose(); vi.advanceTimersByTime(1000);
    const second = socket(); second.open(); welcome(second);
    sendProjection(second, poolWithActions(3));

    const retried = second.commands.at(-1)!;
    expect(retried).toMatchObject({ type: "duel-command", commandId: original.commandId,
      expectedVersion: 2, command: original.command });
    expect(retried.requestId).not.toBe(original.requestId);
    expect(h.pending).toEqual([true]);
  });

  it("captures the submitted payload so later caller mutation cannot change a retry", () => {
    const h = harness(); welcome(h.first); sendProjection(h.first, setupWithAction());
    const selectedUIDs = ["p1-main-1"];
    expect(h.client.submitDuelCommand({ type: "mulligan", selectedUIDs })).toBe(true);
    const original = h.first.commands.at(-1)!;
    selectedUIDs[0] = "p1-other";
    selectedUIDs.push("not-in-hand");
    vi.advanceTimersByTime(10_000);
    expect(h.first.commands.at(-1)).toMatchObject({
      commandId: original.commandId, expectedVersion: original.expectedVersion,
      command: { type: "mulligan", selectedUIDs: ["p1-main-1"] }
    });
  });

  it("drops hand and pending immediately when the authenticated actor, room or server changes", () => {
    const h = harness(); welcome(h.first); sendProjection(h.first, setupWithAction());
    expect(h.client.submitDuelCommand({ type: "mulligan", selectedUIDs: [] })).toBe(true);
    const original = h.first.commands.at(-1)!;
    h.first.receive({ type: "welcome", protocolVersion: PROTOCOL_VERSION,
      session: { ...session, roomId: "room-2", resumeToken: "room-2-token" } });
    expect(h.projections.at(-1)).toBeNull();
    expect(h.pending).toEqual([true, false]);
    expect(h.client.status).toBe("disconnected");
    sendProjection(h.first, setupWithAction());
    expect(h.projections.at(-1)).toBeNull();
    h.first.receive({ type: "request-result", requestId: original.requestId,
      commandId: original.commandId, appliedVersion: 0, eventSeq: 0, ok: true });
    expect(h.pending).toEqual([true, false]);
    h.client.connect("ws://other.example/ws");
    expect(h.projections.at(-1)).toBeNull();
    expect(h.client.submitDuelCommand({ type: "mulligan", selectedUIDs: [] })).toBe(false);
  });

  it("never retries a pending Duel command after a different actor welcomes a replacement socket", () => {
    const h = harness(); welcome(h.first); sendProjection(h.first, setupWithAction());
    h.client.submitDuelCommand({ type: "mulligan", selectedUIDs: [] });
    h.first.serverClose(); vi.advanceTimersByTime(1000);
    const second = socket(); second.open();
    welcome(second, { ...session, playerId: "p2", resumeToken: "p2-token" });
    sendProjection(second, fixture("setup", "p2"));
    expect(h.projections.at(-1)).toBeNull();
    expect(h.client.status).toBe("disconnected");
    expect(second.commands).toHaveLength(0);
    expect(h.pending).toEqual([true, false]);
  });

  it("refuses to downgrade a same-match frame from V2 to V1 at an equal or newer clock", () => {
    const h = harness(); welcome(h.first);
    sendProjection(h.first, v2Fixture("changed"));
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
    expect(h.projections.at(-1)?.match.stateVersion).toBe(3);
    const accepted = h.projections.length;
    // Equal clock, older schema: silently replacing V2 with V1 is refused.
    sendProjection(h.first, fixture("changed"));
    expect(h.projections).toHaveLength(accepted);
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
    expect(h.projections.at(-1)?.match.stateVersion).toBe(3);
    // A newer clock does not license a schema downgrade either.
    const newerV1 = fixture("changed");
    (newerV1.match as unknown as { stateVersion: number; eventSeq: number }).stateVersion = 4;
    (newerV1.match as unknown as { stateVersion: number; eventSeq: number }).eventSeq = 4;
    sendProjection(h.first, newerV1);
    expect(h.projections).toHaveLength(accepted);
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
  });

  it("freezes a stale V2 hand read-only and asks for one resync when a same-clock V1 frame is refused", () => {
    const h = harness(); welcome(h.first);
    sendProjection(h.first, asV2(poolWithActions()));
    const accepted = h.projections.length;
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
    // Equal clock, older schema: the display keeps the last V2 frame, but that
    // frame is no longer operable and the refusal asks the server to resync.
    sendProjection(h.first, poolWithActions());
    expect(h.projections).toHaveLength(accepted);
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
    expect(h.client.submitDuelCommand({ type: "gold-power", uid: "gold-1" })).toBe(false);
    expect(h.first.commands).toHaveLength(0);
    expect(h.first.sent.filter(message => message.type === "sync-events")).toHaveLength(1);
    // A fresh authoritative V2 frame restores the ordinary accept path.
    sendProjection(h.first, asV2(poolWithActions(4)));
    expect(h.projections.at(-1)?.match.stateVersion).toBe(4);
    expect(h.client.submitDuelCommand({ type: "gold-power", uid: "gold-1" })).toBe(true);
    expect(h.first.commands).toHaveLength(1);
  });

  it("freezes the stale V2 hand on a newer-clock V1 frame without storming the server with resyncs", () => {
    const h = harness(); welcome(h.first);
    sendProjection(h.first, asV2(poolWithActions()));
    const accepted = h.projections.length;
    sendProjection(h.first, poolWithActions(5));
    expect(h.projections).toHaveLength(accepted);
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
    expect(h.client.submitDuelCommand({ type: "gold-power", uid: "gold-1" })).toBe(false);
    expect(h.first.sent.filter(message => message.type === "sync-events")).toHaveLength(1);
    // A server stuck on the older schema must not drive a resync loop.
    for (const version of [6, 7, 8]) sendProjection(h.first, poolWithActions(version));
    expect(h.projections).toHaveLength(accepted);
    expect(h.first.sent.filter(message => message.type === "sync-events")).toHaveLength(1);
    expect(h.first.commands).toHaveLength(0);
    expect(h.client.submitDuelCommand({ type: "gold-power", uid: "gold-1" })).toBe(false);
  });

  it("never replays a pending command against a refused same-match schema downgrade", () => {
    const h = harness(); welcome(h.first);
    sendProjection(h.first, asV2(setupWithAction()));
    expect(h.client.submitDuelCommand({ type: "mulligan", selectedUIDs: ["p1-main-1"] })).toBe(true);
    const sent = h.first.commands.length;
    expect(h.pending).toEqual([true]);
    sendProjection(h.first, setupWithAction());
    // The accepted V2 frame stays on screen, but it is frozen and its in-flight
    // command is dropped rather than replayed on a contradicted clock.
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
    expect(h.pending).toEqual([true, false]);
    expect(h.first.commands).toHaveLength(sent);
    vi.advanceTimersByTime(60_000);
    expect(h.first.commands).toHaveLength(sent);
    expect(h.client.submitDuelCommand({ type: "mulligan", selectedUIDs: ["p1-main-1"] })).toBe(false);
    expect(h.first.commands).toHaveLength(sent);
  });

  it("ignores a stale-clock V1 frame instead of freezing an operable V2 hand", () => {
    const h = harness(); welcome(h.first);
    sendProjection(h.first, asV2(poolWithActions())); // V2, state/event clock 3
    expect(h.client.submitDuelCommand({ type: "gold-power", uid: "gold-1" })).toBe(true);
    const sent = h.first.commands.at(-1)!;
    const accepted = h.projections.length;
    const errorsBefore = h.errors.length;
    // An out-of-order V1 packet trails the accepted V2 clock: it is stale, not a
    // contradiction, so the operable hand, its pending command and the last
    // accepted frame all stay exactly as they were.
    const staleV1 = poolWithActions();
    (staleV1.match as unknown as { stateVersion: number; eventSeq: number }).stateVersion = 2;
    (staleV1.match as unknown as { stateVersion: number; eventSeq: number }).eventSeq = 2;
    sendProjection(h.first, staleV1);
    expect(h.projections).toHaveLength(accepted);
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
    expect(h.pending).toEqual([true]);
    expect(h.errors).toHaveLength(errorsBefore);
    expect(h.first.sent.filter(message => message.type === "sync-events")).toHaveLength(0);
    // The in-flight command was not dropped: its timeout retry still reaches the
    // wire on the original clock, and the hand stays frozen only on the pending.
    vi.advanceTimersByTime(10_000);
    const retried = h.first.commands.at(-1)!;
    expect(retried).toMatchObject({ commandId: sent.commandId,
      expectedVersion: sent.expectedVersion, command: sent.command });
    expect(h.client.submitDuelCommand({ type: "rune-energy", uid: "p1-rune" })).toBe(false);
  });

  it("surfaces one error and one resync for the first refused downgrade after a reconnect", () => {
    const h = harness(); welcome(h.first);
    sendProjection(h.first, asV2(poolWithActions()));
    h.first.serverClose(); vi.advanceTimersByTime(1000);
    const second = socket(); second.open(); welcome(second);
    const accepted = h.projections.length;
    const errorsBefore = h.errors.length;
    // The reconnect dropped the operable generation, so the very first downgrade
    // frame on the fresh socket is not "operable". It must still be surfaced once
    // with an error and a resync request instead of silently showing a stale
    // read-only screen with no way back.
    sendProjection(second, poolWithActions());
    expect(h.projections).toHaveLength(accepted);
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
    expect(h.errors.length).toBe(errorsBefore + 1);
    expect(second.sent.filter(message => message.type === "sync-events")).toHaveLength(1);
    // Repeated older-schema frames on this socket stay latched: no resync storm.
    sendProjection(second, poolWithActions(4));
    expect(second.sent.filter(message => message.type === "sync-events")).toHaveLength(1);
    expect(h.errors.length).toBe(errorsBefore + 1);
    // A fresh V2 frame recovers operability and clears the latch for a new episode.
    sendProjection(second, asV2(poolWithActions(4)));
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
    expect(h.projections.at(-1)?.match.stateVersion).toBe(4);
    expect(h.client.submitDuelCommand({ type: "gold-power", uid: "gold-1" })).toBe(true);
  });

  it("promotes a same-clock V1 match to V2 without dropping the frame", () => {
    const h = harness(); welcome(h.first);
    sendProjection(h.first, fixture("changed"));
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(1);
    const accepted = h.projections.length;
    sendProjection(h.first, v2Fixture("changed"));
    expect(h.projections).toHaveLength(accepted + 1);
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
    expect(h.projections.at(-1)?.match.stateVersion).toBe(3);
  });

  it("ignores a replayed V2 projection from the old socket after a same-session reconnect", () => {
    const h = harness(); welcome(h.first); sendProjection(h.first, asV2(setupWithAction()));
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
    h.first.serverClose(); vi.advanceTimersByTime(1000);
    const second = socket(); second.open(); welcome(second);
    sendProjection(second, asV2(poolWithActions()));
    const count = h.projections.length;
    h.first.receive({ type: "duel-projection", roomId: session.roomId, projection: asV2(setupWithAction()) });
    h.first.receive({ type: "welcome", protocolVersion: PROTOCOL_VERSION,
      session: { ...session, playerId: "p2" } });
    expect(h.projections).toHaveLength(count);
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
    expect(h.projections.at(-1)?.match.stateVersion).toBe(3);
    expect(h.client.submitDuelCommand({ type: "gold-power", uid: "gold-1" })).toBe(true);
  });

  it("blocks V2 commands behind the reconnect generation gate until a fresh V2 frame arrives", () => {
    const h = harness(); welcome(h.first); sendProjection(h.first, asV2(poolWithActions()));
    expect(h.client.submitDuelCommand({ type: "gold-power", uid: "gold-1" })).toBe(true);
    receipt(h.first, h.first.commands.at(-1)!);
    h.first.serverClose(); vi.advanceTimersByTime(1000);
    const second = socket(); second.open(); welcome(second);
    // The old frame stays read-only: without a V2 frame on the new generation
    // the cached hand must never re-enable a command.
    expect(h.client.submitDuelCommand({ type: "gold-power", uid: "gold-1" })).toBe(false);
    sendProjection(second, asV2(poolWithActions(4)));
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
    expect(h.client.submitDuelCommand({ type: "gold-power", uid: "gold-1" })).toBe(true);
  });

  it("keeps V2 out of a Foundation room and its V1 hand out of a V2 room", () => {
    const h = harness(); welcome(h.first);
    h.first.receive({ type: "room", room: {
      roomId: session.roomId, status: "playing", rulesetId: "riftbound-foundation",
      version: 1, roomVersion: 1, roomEventSeq: 1,
      players: ["p1", "p2"].map(id => ({ id, name: id,
        connected: true, ready: false, deckSubmitted: false }))
    } });
    sendProjection(h.first, asV2(setupWithAction()));
    expect(h.projections.every(value => value === null)).toBe(true);
    expect(h.client.submitDuelCommand({ type: "mulligan", selectedUIDs: [] })).toBe(false);
  });

  it("submits, receipts and retries a V2 duel command on the V2 wire", () => {
    const h = harness(); welcome(h.first);
    sendProjection(h.first, asV2(setupWithAction()));
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
    expect(h.client.submitDuelCommand({ type: "mulligan", selectedUIDs: ["p1-main-1"] })).toBe(true);
    const original = h.first.commands.at(-1)!;
    expect(original).toMatchObject({ type: "duel-command", expectedVersion: 0,
      command: { type: "mulligan", selectedUIDs: ["p1-main-1"] } });
    vi.advanceTimersByTime(10_000);
    const retried = h.first.commands.at(-1)!;
    expect(retried).toMatchObject({ commandId: original.commandId,
      expectedVersion: original.expectedVersion, command: original.command });
    expect(retried.requestId).not.toBe(original.requestId);
    receipt(h.first, retried);
    expect(h.pending).toEqual([true, false]);
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
  });
});
