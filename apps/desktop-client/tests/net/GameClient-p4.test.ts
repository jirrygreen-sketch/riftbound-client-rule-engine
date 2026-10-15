import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, DUEL_PROJECTION_SCHEMA_V3,
  DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1, PROTOCOL_VERSION,
  isDuelCommandMessageV3Actions1, isDuelProjection, isDuelProjectionAny,
  isDuelProjectionMessageTransport, isDuelProjectionV2, isDuelProjectionV3,
  isDuelProjectionV3Actions1, isServerMessage,
  type DuelProjection, type DuelProjectionTransport, type DuelProjectionV2,
  type DuelProjectionV3, type DuelProjectionV3Actions1, type DuelWireAction
} from "@riftbound/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameClient, type GameClientHandlers } from "../../src/net/GameClient";

/*
 * Focused P4 client-transport regressions for the *real* formal Duel client
 * (`GameClient` / `DuelProjectionTransport`). They cover only the seams Root
 * actually wired: the P4 owner frame, the exact-token packet the actions panel
 * forwards, the read-only refusals, reconnect identity, the P3<->P4 same-match
 * schema boundary, and no legacy V1/V2/V3 regression.
 *
 * Every fixture is a *tracked wire-shape* fixture under
 * `packages/protocol/test/fixtures`, converted in-test into a real P4 DTO and
 * asserted with the production `isDuelProjectionV3Actions1` guard. These are
 * shape fixtures, NOT a recorded human match: a guard pass is structural only
 * and never proves IR/window/cost/actor authority.
 */

const url = "ws://127.0.0.1:8787/ws";
const session = { roomId: "room-1", playerId: "p1", resumeToken: "private-token" };
const BASE_P1 = JSON.stringify(["duel-base", "p1"]);
const FIELD_P1 = JSON.stringify(["duel-battlefield", "p1-field-0"]);

const v2Fixtures = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../../../packages/protocol/test/fixtures/duel-v2-projection.json", import.meta.url
)), "utf8")) as Record<string, Record<string, DuelProjectionV2>>;
const v1Fixtures = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../../../packages/protocol/test/fixtures/duel-projections.json", import.meta.url
)), "utf8")) as Record<string, Record<string, DuelProjection>>;

function v2Fixture(scenario: string, viewer: "p1" | "p2" | null = "p1"): DuelProjectionV2 {
  const source = v2Fixtures[scenario]?.[viewer === null ? "null" : viewer];
  if (!source) throw Error(`missing v2 fixture ${scenario}/${viewer}`);
  return structuredClone(source);
}

function v1Fixture(scenario: string, viewer = "p1"): DuelProjection {
  const source = v1Fixtures[scenario]?.[viewer];
  if (!source) throw Error(`missing v1 fixture ${scenario}/${viewer}`);
  return structuredClone(source);
}

/**
 * Convert a tracked V2 fixture into a real P4 DTO: `projectionSchema` and
 * `match.schemaVersion` move to the P4 profile, V2 legends gain the V3
 * permanent fields, `board.gears` is added, and the frame gains the three P4
 * summary fields. The result is asserted against the production guard by
 * {@link p4}.
 */
function toP4(
  scenario: string,
  viewer: "p1" | "p2" | null = "p1",
  mutate?: (projection: DuelProjectionV3Actions1) => void
): DuelProjectionV3Actions1 {
  const projection = v2Fixture(scenario, viewer) as unknown as DuelProjectionV3Actions1;
  (projection as { projectionSchema: string }).projectionSchema = DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1;
  const match = projection.match as unknown as { schemaVersion: number; stage: string;
    players: readonly { legend: DuelWireLegendLegacy | DuelProjectionV3Legend }[];
    board: { gears?: readonly unknown[] };
    frame: Record<string, unknown> };
  match.schemaVersion = 3;
  if (match.stage === "playing") {
    for (const player of match.players) {
      player.legend = {
        cardId: (player.legend as DuelWireLegendLegacy).cardId,
        controllerPlayerId: (player as { playerId: string }).playerId,
        readiness: "ready"
      };
    }
    match.board.gears = [];
    match.frame.chain = { active: false };
    match.frame.pendingChoice = null;
    match.frame.execution = { status: "ready" };
    mutate?.(projection);
  }
  return projection;
}

interface DuelWireLegendLegacy { readonly cardId: string }
interface DuelProjectionV3Legend { readonly cardId: string; readonly controllerPlayerId: string; readonly readiness: string }

/** A P4-and-P3-carried legacy action, so a P3 frame can still submit a command. */
const GOLD_ACTION: DuelWireAction = {
  id: "act-gold", kind: "gold-power", label: "使用金币", enabled: true, uid: "gold-1"
};

function p4(source: DuelProjectionV3Actions1): DuelProjectionV3Actions1 {
  expect(isDuelProjectionV3Actions1(source)).toBe(true);
  return source;
}

/** A P4 playing frame with a real card unit, a Gear and the P4 actions under test. */
function p4WithUnitAndActions(): DuelProjectionV3Actions1 {
  return p4(toP4("changed", "p1", projection => {
    const match = projection.match as unknown as {
      board: { bases: { locationId: string; occupancy: string[] }[];
        units: unknown[]; gears: unknown[] };
    };
    match.board.units = [{
      objectId: "u1", controllerPlayerId: "p1", locationId: BASE_P1, ownerPlayerId: "p1",
      readied: true, trait: { kind: "card", cardId: "card.0.1" }, totalDamage: 0, damageMarks: []
    }];
    match.board.bases[0].occupancy = ["u1"];
    match.board.gears = [{
      uid: "gear-1", cardId: "card.0.2", controllerPlayerId: "p1", locationId: BASE_P1,
      readied: true, attachedToUID: "u1"
    }];
    (projection as { actions: readonly unknown[] }).actions = [
      { id: "act-end-turn", kind: "end-turn", label: "结束回合", enabled: true, windowId: "w-main" },
      { id: "act-move", kind: "standard-move", label: "移动", enabled: true, windowId: "w-main",
        selectableUnitUIDs: ["u1"],
        destinations: [{ locationId: FIELD_P1, eligibleUnitUIDs: ["u1"] }] }
    ];
  }));
}

function p4Packet(overrides: Partial<{
  requestId: string; commandId: string; expectedVersion: number;
  commandProfile: string; command: unknown;
}> = {}): Record<string, unknown> {
  const packet = {
    type: "duel-command",
    commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    requestId: "p4-req-1",
    commandId: "p4-cmd-1",
    expectedVersion: 3,
    command: { type: "end-turn", windowId: "w-main" },
    ...overrides
  };
  return packet;
}

/** Strip the three P4 frame fields and rename the profile: a real P3 DTO. */
function toP3(source: DuelProjectionV3Actions1): DuelProjectionV3 {
  const projection = structuredClone(source) as unknown as {
    projectionSchema: string; match: { frame: Record<string, unknown> }
  };
  projection.projectionSchema = DUEL_PROJECTION_SCHEMA_V3;
  delete projection.match.frame.chain;
  delete projection.match.frame.pendingChoice;
  delete projection.match.frame.execution;
  (projection as unknown as { actions: readonly unknown[] }).actions = [GOLD_ACTION];
  return p4AsP3(projection as unknown as DuelProjectionV3);
}
function p4AsP3(projection: DuelProjectionV3): DuelProjectionV3 {
  expect(isDuelProjectionV3(projection)).toBe(true);
  return projection;
}

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
  const projections: Array<DuelProjectionTransport | null> = [];
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
function sendProjection(s: Socket, projection: DuelProjectionTransport, roomId = session.roomId): void {
  const message = { type: "duel-projection", roomId, projection };
  expect(isServerMessage(message)).toBe(true);
  s.receive(message);
}
function receipt(s: Socket, command: Record<string, unknown>, overrides: Record<string, unknown> = {}): void {
  s.receive({ type: "request-result", requestId: command.requestId, ok: true,
    commandId: command.commandId, appliedVersion: command.expectedVersion,
    eventSeq: command.expectedVersion, ...overrides });
}

describe("GameClient P4 owner frame", () => {
  it("accepts a real P4 owner frame and keeps the legacy V1/V2/V3 guards exact", () => {
    const h = harness(); welcome(h.first);
    const projection = p4WithUnitAndActions();
    // The P4 guard passes; the legacy any-profile guard does not widen to it.
    expect(isDuelProjectionAny(projection)).toBe(false);
    expect(isDuelProjectionV2(projection)).toBe(false);
    expect(isDuelProjection(projection)).toBe(false);
    expect(isDuelProjectionMessageTransport({ type: "duel-projection", roomId: session.roomId, projection })).toBe(true);
    sendProjection(h.first, projection);
    expect(h.projections.at(-1)?.projectionSchema).toBe(DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1);
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(3);
    // A seated owner can act on the accepted frame.
    expect(h.client.submitDuelCommandPacket(p4Packet() as never)).toBe(true);
    expect(h.errors).toEqual([]);
  });

  it("refuses a spectator (viewerPlayerId null) P4 frame and keeps the owner frame intact", () => {
    const h = harness(); welcome(h.first);
    sendProjection(h.first, p4WithUnitAndActions());
    const accepted = h.projections.length;
    // A non-owning frame is never accepted for this authenticated seat…
    sendProjection(h.first, p4(toP4("changed", null)));
    expect(h.projections).toHaveLength(accepted);
    // …so the previously accepted owner frame is still the operable one.
    expect(h.projections.at(-1)?.viewerPlayerId).toBe("p1");
    expect(h.client.submitDuelCommandPacket(p4Packet() as never)).toBe(true);
  });
});

describe("GameClient P4 command packet", () => {
  function advancedFrame(version: number): DuelProjectionV3Actions1 {
    const value = p4WithUnitAndActions();
    const match = value.match as unknown as { stateVersion: number; eventSeq: number };
    match.stateVersion = version; match.eventSeq = version;
    return p4(value);
  }

  it("unlocks on a fresh projection at the actual applied clock after ACK arrives first", () => {
    const h = harness(); welcome(h.first); sendProjection(h.first, advancedFrame(3));
    expect(h.client.submitDuelCommandPacket(p4Packet() as never)).toBe(true);
    receipt(h.first, h.first.commands.at(-1)!, { appliedVersion: 4, eventSeq: 4 });
    const next = p4Packet({ requestId: 'next-request', commandId: 'next-command', expectedVersion: 4 });
    expect(h.client.submitDuelCommandPacket(next as never)).toBe(false);
    sendProjection(h.first, advancedFrame(4));
    expect(h.client.submitDuelCommandPacket(next as never)).toBe(true);
    expect(h.first.commands.at(-1)).toMatchObject({ expectedVersion: 4, commandId: 'next-command' });
  });

  it("keeps an already received applied projection operable when its matching ACK arrives later", () => {
    const h = harness(); welcome(h.first); sendProjection(h.first, advancedFrame(3));
    expect(h.client.submitDuelCommandPacket(p4Packet() as never)).toBe(true);
    const sent = h.first.commands.at(-1)!;
    sendProjection(h.first, advancedFrame(4));
    receipt(h.first, sent, { appliedVersion: 4, eventSeq: 4 });
    expect(h.client.submitDuelCommandPacket(p4Packet({ requestId: 'after-projection',
      commandId: 'after-projection', expectedVersion: 4 }) as never)).toBe(true);
  });

  it("requires a newer projection after a matching stale-version error", () => {
    const h = harness(); welcome(h.first); sendProjection(h.first, advancedFrame(3));
    expect(h.client.submitDuelCommandPacket(p4Packet() as never)).toBe(true);
    h.first.receive({ type: 'error', requestId: h.first.commands.at(-1)!.requestId,
      code: 'stale-version', message: 'stale' });
    sendProjection(h.first, advancedFrame(3));
    expect(h.client.submitDuelCommandPacket(p4Packet({ requestId: 'still-old', commandId: 'still-old' }) as never)).toBe(false);
    sendProjection(h.first, advancedFrame(4));
    expect(h.client.submitDuelCommandPacket(p4Packet({ requestId: 'fresh', commandId: 'fresh', expectedVersion: 4 }) as never)).toBe(true);
  });

  it("forwards the exact P4 tag, requestId, commandId and expectedVersion", () => {
    const h = harness(); welcome(h.first);
    sendProjection(h.first, p4WithUnitAndActions());
    const packet = p4Packet();
    expect(isDuelCommandMessageV3Actions1(packet)).toBe(true);
    expect(h.client.submitDuelCommandPacket(packet as never)).toBe(true);
    const sent = h.first.commands.at(-1)!;
    expect(sent).toMatchObject({
      type: "duel-command",
      commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
      requestId: "p4-req-1",
      commandId: "p4-cmd-1",
      expectedVersion: 3,
      command: { type: "end-turn", windowId: "w-main" }
    });
    receipt(h.first, sent);
    expect(h.pending).toEqual([true, false]);
  });

  it("forwards a legal standard-move packet with the exact UID/destination tokens", () => {
    const h = harness(); welcome(h.first);
    sendProjection(h.first, p4WithUnitAndActions());
    const packet = p4Packet({
      requestId: "p4-req-move", commandId: "p4-cmd-move",
      command: { type: "standard-move", windowId: "w-main", unitUIDs: ["u1"], destinationLocationId: FIELD_P1 }
    });
    expect(isDuelCommandMessageV3Actions1(packet)).toBe(true);
    expect(h.client.submitDuelCommandPacket(packet as never)).toBe(true);
    expect(h.first.commands.at(-1)).toMatchObject({
      commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
      requestId: "p4-req-move", commandId: "p4-cmd-move", expectedVersion: 3,
      command: { type: "standard-move", windowId: "w-main", unitUIDs: ["u1"], destinationLocationId: FIELD_P1 }
    });
  });

  it("keeps the board read-only for an invalid tag, a stale version, a foreign window and a foreign UID", () => {
    const h = harness(); welcome(h.first);
    sendProjection(h.first, p4WithUnitAndActions());
    const before = h.first.commands.length;
    // Wrong packet profile tag: rejected by the production P4 packet guard.
    expect(h.client.submitDuelCommandPacket(p4Packet({ commandProfile: "duel-command-v3" }) as never)).toBe(false);
    // Stale/forward version that disagrees with the accepted frame.
    expect(h.client.submitDuelCommandPacket(p4Packet({ expectedVersion: 2 }) as never)).toBe(false);
    // A command that references a window the server never offered.
    expect(h.client.submitDuelCommandPacket(p4Packet({ command: { type: "end-turn", windowId: "w-forged" } }) as never)).toBe(false);
    // A standard-move that names a unit the server did not mark selectable.
    expect(h.client.submitDuelCommandPacket(p4Packet({
      command: { type: "standard-move", windowId: "w-main", unitUIDs: ["u-foreign"], destinationLocationId: FIELD_P1 }
    }) as never)).toBe(false);
    expect(h.first.commands).toHaveLength(before);
    // None of the refusals left a pending command behind.
    expect(h.pending).toEqual([]);
    // The valid packet still works: the refusals did not wedge the transport.
    expect(h.client.submitDuelCommandPacket(p4Packet() as never)).toBe(true);
    expect(h.first.commands).toHaveLength(before + 1);
  });

  it("ignores a stale same-match P4 frame instead of freezing the operable frame", () => {
    const h = harness(); welcome(h.first);
    sendProjection(h.first, p4WithUnitAndActions());
    const accepted = h.projections.length;
    const stale = p4WithUnitAndActions();
    (stale.match as unknown as { stateVersion: number; eventSeq: number }).stateVersion = 2;
    (stale.match as unknown as { stateVersion: number; eventSeq: number }).eventSeq = 2;
    sendProjection(h.first, stale);
    expect(h.projections).toHaveLength(accepted);
    expect(h.projections.at(-1)?.match.stateVersion).toBe(3);
    expect(h.client.submitDuelCommandPacket(p4Packet() as never)).toBe(true);
  });
});

describe("GameClient P4 reconnect identity", () => {
  it("retries the P4 packet with the same body, commandId and profile but a fresh requestId", () => {
    const h = harness(); welcome(h.first);
    sendProjection(h.first, p4WithUnitAndActions());
    expect(h.client.submitDuelCommandPacket(p4Packet() as never)).toBe(true);
    const original = h.first.commands.at(-1)!;
    h.first.serverClose(); vi.advanceTimersByTime(1000);
    const second = socket(); second.open(); welcome(second);
    sendProjection(second, p4WithUnitAndActions());
    const retried = second.commands.at(-1)!;
    expect(retried).toMatchObject({
      type: "duel-command",
      commandProfile: original.commandProfile,
      commandId: original.commandId,
      expectedVersion: original.expectedVersion,
      command: original.command
    });
    expect(retried.requestId).not.toBe(original.requestId);
    receipt(second, retried);
    expect(h.pending).toEqual([true, false]);
  });
});

describe("GameClient P3/P4 same-match schema boundary", () => {
  it("refuses a same-match P3->P4 upgrade and asks for one resync", () => {
    const h = harness(); welcome(h.first);
    const source = p4WithUnitAndActions();
    const p3 = toP3(source);
    sendProjection(h.first, p3);
    expect(h.projections.at(-1)?.projectionSchema).toBe(DUEL_PROJECTION_SCHEMA_V3);
    const accepted = h.projections.length;
    const errorsBefore = h.errors.length;
    // Same match, same clock, newer profile: still a refusal, no silent upgrade.
    sendProjection(h.first, p4(source));
    expect(h.projections).toHaveLength(accepted);
    expect(h.errors.length).toBe(errorsBefore + 1);
    expect(h.first.sent.filter(message => message.type === "sync-events")).toHaveLength(1);
    // The accepted P3 frame is frozen read-only; the refused command adds its
    // own read-only error, so re-baseline before checking the next frame.
    expect(h.client.submitDuelCommand({ type: "gold-power", uid: "gold-1" })).toBe(false);
    const errorsAfterCommand = h.errors.length;
    // A repeated P4 frame does not storm the server with resyncs.
    sendProjection(h.first, p4WithUnitAndActions());
    expect(h.first.sent.filter(message => message.type === "sync-events")).toHaveLength(1);
    expect(h.errors.length).toBe(errorsAfterCommand);
  });

  it("refuses a same-match P4->P3 downgrade and freezes the accepted P4 frame", () => {
    const h = harness(); welcome(h.first);
    const source = p4WithUnitAndActions();
    sendProjection(h.first, source);
    expect(h.projections.at(-1)?.projectionSchema).toBe(DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1);
    const accepted = h.projections.length;
    const errorsBefore = h.errors.length;
    sendProjection(h.first, toP3(p4WithUnitAndActions()));
    expect(h.projections).toHaveLength(accepted);
    expect(h.projections.at(-1)?.projectionSchema).toBe(DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1);
    expect(h.errors.length).toBe(errorsBefore + 1);
    expect(h.first.sent.filter(message => message.type === "sync-events")).toHaveLength(1);
    expect(h.client.submitDuelCommandPacket(p4Packet() as never)).toBe(false);
  });
});

describe("GameClient legacy V1/V2/V3 no regression", () => {
  it("keeps accepting V1 and still sends an untagged legacy command", () => {
    const h = harness(); welcome(h.first);
    const setup = v1Fixture("setup");
    const projection: DuelProjection = { ...setup, actions: [{
      id: "act-mulligan", kind: "mulligan", label: "调度", enabled: true,
      selectableUIDs: ["p1-main-1"], maxSelections: 2
    }] };
    expect(isDuelProjection(projection)).toBe(true);
    sendProjection(h.first, projection);
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(1);
    expect(h.client.submitDuelCommand({ type: "mulligan", selectedUIDs: ["p1-main-1"] })).toBe(true);
    const sent = h.first.commands.at(-1)!;
    expect(sent.commandProfile).toBeUndefined();
    expect(sent.command).toEqual({ type: "mulligan", selectedUIDs: ["p1-main-1"] });
  });

  it("keeps accepting V2 and still sends an untagged legacy command", () => {
    const h = harness(); welcome(h.first);
    const setup = v2Fixture("setup");
    const projection = { ...setup, actions: [{
      id: "act-mulligan", kind: "mulligan", label: "调度", enabled: true,
      selectableUIDs: ["p1-main-1"], maxSelections: 2
    }] } as DuelProjectionV2;
    expect(isDuelProjectionV2(projection)).toBe(true);
    sendProjection(h.first, projection);
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(2);
    expect(h.client.submitDuelCommand({ type: "mulligan", selectedUIDs: ["p1-main-1"] })).toBe(true);
    expect(h.first.commands.at(-1)!.commandProfile).toBeUndefined();
  });

  it("keeps accepting V3 (P3) and still sends an untagged legacy command", () => {
    const h = harness(); welcome(h.first);
    const p3 = toP3(p4WithUnitAndActions());
    sendProjection(h.first, p3);
    expect(h.projections.at(-1)?.projectionSchema).toBe(DUEL_PROJECTION_SCHEMA_V3);
    expect(h.projections.at(-1)?.match.schemaVersion).toBe(3);
    expect(h.client.submitDuelCommand({ type: "gold-power", uid: "gold-1" })).toBe(true);
    const sent = h.first.commands.at(-1)!;
    expect(sent.commandProfile).toBeUndefined();
    expect(sent.command).toEqual({ type: "gold-power", uid: "gold-1" });
  });
});
