import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server.node";
import {
  DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1,
  PROTOCOL_VERSION,
  isDuelCommandMessageV3Actions1,
  isDuelProjectionV3Actions1,
  type DuelActionV3Actions1,
  type DuelCommandMessageV3Actions1,
  type DuelProjectionV3Actions1
} from "@riftbound/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameClient, type GameClientHandlers } from "../src/net/GameClient";
import { DuelMatchBoard } from "../src/full-product/DuelMatchBoard";
import { toPlayableConnectionStatus } from "../src/full-product/transport";
import {
  DUEL_ACTIONS_PENDING_NOTICE,
  EMPTY_DUEL_ACTIONS_SELECTION,
  buildDuelCommandPacket
} from "../src/full-product/components/DuelActionsPanelV3";

/*
 * Retry / UI contract for the *real* formal Duel client and surfaces.
 *
 * Every DTO is a tracked wire fixture converted in-test and asserted with the
 * production `isDuelProjectionV3Actions1` guard; every packet is built by the
 * real `DuelActionsPanelV3.buildDuelCommandPacket`. The client under test is the
 * real `GameClient` driven by a fake WebSocket, and the read-only assertions are
 * rendered from the real `DuelMatchBoard` (which composes `DuelActionsPanelV3`
 * and the compact `ResourcePoolPanel`). A guard pass is structural only: this is
 * not a recorded human match and does not prove IR/window/cost/actor authority,
 * real native windows or a real network.
 */

const url = "ws://127.0.0.1:8787/ws";
const session = { roomId: "room-1", playerId: "p1", resumeToken: "private-token" };

const v2Fixtures = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../../packages/protocol/test/fixtures/duel-v2-projection.json", import.meta.url
)), "utf8")) as Record<string, Record<string, unknown>>;

type Loose = {
  projectionSchema: string;
  viewerPlayerId: string | null;
  match: {
    schemaVersion: number;
    stateVersion: number;
    eventSeq: number;
    stage: string;
    players: { playerId: string; legend: Record<string, unknown> }[];
    board: { gears?: readonly unknown[] };
    frame: Record<string, unknown>;
  };
  actions: readonly unknown[];
};

/**
 * Convert the tracked V2 `changed` fixture into a real P4 DTO and attach the
 * server actions under test. The result is re-checked with the production guard
 * by every `sendProjection` call, so a test can never run on a bespoke shape.
 */
function p4Changed(actions: readonly DuelActionV3Actions1[]): DuelProjectionV3Actions1 {
  const projection = structuredClone(v2Fixtures["changed"]!["p1"]) as unknown as Loose;
  projection.projectionSchema = DUEL_PROJECTION_SCHEMA_V3_ACTIONS_1;
  projection.match.schemaVersion = 3;
  for (const player of projection.match.players) {
    player.legend = {
      cardId: player.legend["cardId"],
      controllerPlayerId: player.playerId,
      readiness: "ready"
    };
  }
  projection.match.board.gears = [];
  projection.match.frame.chain = { active: false };
  projection.match.frame.pendingChoice = null;
  projection.match.frame.execution = { status: "ready" };
  projection.actions = actions;
  return projection as unknown as DuelProjectionV3Actions1;
}

function withState(
  projection: DuelProjectionV3Actions1,
  stateVersion: number
): DuelProjectionV3Actions1 {
  const next = structuredClone(projection) as unknown as Loose;
  next.match.stateVersion = stateVersion;
  next.match.eventSeq = stateVersion;
  return next as unknown as DuelProjectionV3Actions1;
}

const RUNE: DuelActionV3Actions1 = {
  id: "act-rune", kind: "rune-energy", label: "获取能量", enabled: true, uid: "p1-rune"
};
const PLAY: DuelActionV3Actions1 = {
  id: "act-play", kind: "play-card", label: "打出单位", enabled: true,
  cardUID: "p1-main-1", windowId: "w-main"
};

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
  const projections: Array<DuelProjectionV3Actions1 | null> = [];
  const pending: boolean[] = [];
  const handshake: boolean[] = [];
  const errors: string[] = [];
  const handlers: GameClientHandlers = {
    onStatus() {}, onSession() {}, onProjection() {},
    onDuelProjection: value => {
      // The transport union includes historical V1/V2/V3 frames; these tests only
      // ever publish the P4 profile, so the handler keeps the accepted P4 frame.
      if (value === null || isDuelProjectionV3Actions1(value)) projections.push(value);
    },
    onError: value => errors.push(value),
    onRoom() {}, onHandshake: value => handshake.push(value),
    onPendingCommand: value => pending.push(value)
  };
  const client = new GameClient(handlers);
  clients.push(client);
  client.connect(url);
  const first = socket();
  first.open();
  welcome(first);
  return { client, first, projections, pending, handshake, errors };
}

function welcome(s: Socket, auth = session): void {
  s.receive({ type: "welcome", protocolVersion: PROTOCOL_VERSION, session: auth, resumed: true });
}

function sendProjection(s: Socket, projection: DuelProjectionV3Actions1, roomId = session.roomId): void {
  // The production guard, not a bespoke shape: a test can never run on a DTO
  // the real client would silently reject.
  expect(isDuelProjectionV3Actions1(projection)).toBe(true);
  s.receive({ type: "duel-projection", roomId, projection });
}

function packet(
  action: DuelActionV3Actions1,
  projection: DuelProjectionV3Actions1,
  requestId: string,
  commandId: string
): DuelCommandMessageV3Actions1 {
  const built = buildDuelCommandPacket(
    action,
    EMPTY_DUEL_ACTIONS_SELECTION,
    null,
    { expectedVersion: projection.match.stateVersion, ids: { requestId, commandId } }
  );
  if (built === null) throw Error("panel refused to build the packet");
  expect(isDuelCommandMessageV3Actions1(built)).toBe(true);
  return built;
}

function receipt(s: Socket, command: Record<string, unknown>, overrides: Record<string, unknown> = {}): void {
  const expected = command.expectedVersion as number;
  s.receive({
    type: "request-result", requestId: command.requestId, ok: true,
    commandId: command.commandId, appliedVersion: expected + 1, eventSeq: expected + 1, ...overrides
  });
}

function renderBoard(
  projection: DuelProjectionV3Actions1,
  connectionStatus: "connected" | "connecting" | "reconnecting" | "disconnected",
  commandPending: boolean
): string {
  return renderToStaticMarkup(
    <DuelMatchBoard
      projection={projection}
      connectionStatus={connectionStatus}
      commandPending={commandPending}
      onCommand={() => {}}
      resolveCardTitle={cardId => cardId}
    />
  );
}

function buttonTag(html: string, ariaLabel: string): string {
  const index = html.indexOf(`aria-label="${ariaLabel}"`);
  expect(index, `button ${ariaLabel} not found`).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf("<button", index);
  const close = html.indexOf(">", index);
  return html.slice(open, close + 1);
}

describe("Duel commandPending → UI read-only contract", () => {
  it("explains an authenticated pending Spell payment without claiming the play was refused", () => {
    const h = harness();
    const projection = p4Changed([PLAY]);
    sendProjection(h.first, projection);
    expect(h.client.submitDuelCommandPacket(packet(PLAY, projection, "payment-req", "payment-cmd"))).toBe(true);
    h.first.receive({ type: "error", requestId: "payment-req", code: "command-rejected",
      message: "法术付款仍在等待资源" });
    expect(h.errors).toEqual(["请获取资源并支付当前施放费用，完成后进入响应时点。"]);
    expect(h.pending).toEqual([true, false]);
    expect(h.projections.at(-1)).toEqual(projection);
  });

  it("does not label an unrelated request error as the current Spell payment", () => {
    const h = harness();
    const projection = p4Changed([PLAY]);
    sendProjection(h.first, projection);
    expect(h.client.submitDuelCommandPacket(packet(PLAY, projection, "payment-req", "payment-cmd"))).toBe(true);
    h.first.receive({ type: "error", requestId: "another-request", code: "command-rejected",
      message: "法术付款仍在等待资源" });
    expect(h.errors).toEqual(["服务端未接受该操作，请重试。"]);
    expect(h.pending).toEqual([true]);
  });

  it("keeps genuine play refusal distinct from a pending payment", () => {
    const h = harness();
    const projection = p4Changed([PLAY]);
    sendProjection(h.first, projection);
    expect(h.client.submitDuelCommandPacket(packet(PLAY, projection, "payment-req", "payment-cmd"))).toBe(true);
    h.first.receive({ type: "error", requestId: "payment-req", code: "command-rejected",
      message: "法术出牌未通过规则校验" });
    expect(h.errors).toEqual(["服务端未接受该操作，请重试。"]);
    expect(h.pending).toEqual([true, false]);
  });

  it("disables the real actions-panel button while the real client command is pending, then re-enables it after ack", () => {
    const h = harness();
    const projection = p4Changed([RUNE, PLAY]);
    sendProjection(h.first, projection);

    expect(h.client.submitDuelCommandPacket(packet(PLAY, projection, "ui-req-1", "ui-cmd-1"))).toBe(true);
    expect(h.pending).toEqual([true]);

    const locked = renderBoard(projection, "connected", h.pending.at(-1)!);
    expect(buttonTag(locked, PLAY.label)).toContain("disabled");
    expect(locked).toContain(DUEL_ACTIONS_PENDING_NOTICE);

    receipt(h.first, h.first.commands.at(-1)!);
    expect(h.pending).toEqual([true, false]);

    const open = renderBoard(projection, "connected", h.pending.at(-1)!);
    expect(buttonTag(open, PLAY.label)).not.toContain("disabled");

    // A receipt is not a projection: until a newer frame arrives the client
    // refuses another command, so the UI can never resend against a stale clock.
    expect(h.client.submitDuelCommandPacket(packet(PLAY, projection, "ui-req-x", "ui-cmd-x"))).toBe(false);
    expect(h.pending).toEqual([true, false]);
  });

  it("disables the real resource-pool rune button while pending and re-enables it after ack", () => {
    const h = harness();
    const projection = p4Changed([RUNE]);
    sendProjection(h.first, projection);

    expect(h.client.submitDuelCommand({ type: "rune-energy", uid: "p1-rune" })).toBe(true);
    expect(h.pending).toEqual([true]);

    const locked = renderBoard(projection, "connected", h.pending.at(-1)!);
    expect(buttonTag(locked, RUNE.label)).toContain("disabled");
    expect(locked).toContain("指令处理中");

    receipt(h.first, h.first.commands.at(-1)!);
    expect(h.pending).toEqual([true, false]);

    const open = renderBoard(projection, "connected", h.pending.at(-1)!);
    expect(buttonTag(open, RUNE.label)).not.toContain("disabled");
  });

  it("retries the original real packet after the ack is delayed: same commandId/expectedVersion/payload, new requestId only", () => {
    const h = harness();
    const projection = p4Changed([PLAY]);
    sendProjection(h.first, projection);

    const original = packet(PLAY, projection, "ui-req-a", "ui-cmd-a");
    expect(h.client.submitDuelCommandPacket(original)).toBe(true);
    const first = h.first.commands.at(-1)!;
    expect(first).toMatchObject({
      type: "duel-command", requestId: "ui-req-a", commandId: "ui-cmd-a",
      expectedVersion: projection.match.stateVersion, command: original.command
    });

    // No ack arrives; the real timeout retries the frozen original packet.
    vi.advanceTimersByTime(10_000);
    const retried = h.first.commands.at(-1)!;
    expect(h.first.commands).toHaveLength(2);
    expect(retried.requestId).not.toBe(first.requestId);
    expect(retried).toMatchObject({
      type: "duel-command", requestId: expect.stringMatching(/^command-/),
      commandId: "ui-cmd-a", expectedVersion: projection.match.stateVersion,
      command: original.command
    });

    receipt(h.first, retried);
    expect(h.pending).toEqual([true, false]);

    // After ack + a genuinely newer projection a new operation is allowed, and
    // neither the original nor the retried requestId may ever be reused.
    const next = withState(projection, projection.match.stateVersion + 1);
    sendProjection(h.first, next);
    expect(h.client.submitDuelCommandPacket(packet(PLAY, next, "ui-req-b", "ui-cmd-b"))).toBe(true);
    const second = h.first.commands.at(-1)!;
    expect(second.requestId).toBe("ui-req-b");
    expect([first.requestId, retried.requestId]).not.toContain(second.requestId);
    expect(h.pending).toEqual([true, false, true]);
  });

  it("retries the frozen packet on a replacement socket after a reconnect, keeping commandId/expectedVersion/payload and only minting a new requestId", () => {
    const h = harness();
    const projection = p4Changed([PLAY]);
    sendProjection(h.first, projection);

    const original = packet(PLAY, projection, "ui-req-r", "ui-cmd-r");
    expect(h.client.submitDuelCommandPacket(original)).toBe(true);
    const firstSend = h.first.commands.at(-1)!;

    h.first.serverClose();
    expect(h.client.status).toBe("reconnecting");
    expect(h.pending).toEqual([true]);
    expect(h.client.submitDuelCommandPacket(original)).toBe(false);

    vi.advanceTimersByTime(1000);
    const second = socket();
    second.open();
    welcome(second);
    // Nothing is replayed until a fresh authoritative P4 frame for this socket.
    expect(second.commands).toHaveLength(0);

    const next = withState(projection, projection.match.stateVersion + 1);
    sendProjection(second, next);
    const retried = second.commands.at(-1)!;
    expect(retried).toMatchObject({
      type: "duel-command",
      commandId: "ui-cmd-r",
      expectedVersion: projection.match.stateVersion,
      command: original.command
    });
    expect(retried.requestId).not.toBe(firstSend.requestId);
    expect(h.pending).toEqual([true]);

    // Still pending → the real board keeps the replacement-socket surface read-only.
    const html = renderBoard(next, "connected", h.pending.at(-1)!);
    expect(buttonTag(html, PLAY.label)).toContain("disabled");

    receipt(second, retried);
    expect(h.pending).toEqual([true, false]);
  });

  it("bounds the real retry loop: three sends then one error and a cleared pending state, never a retry storm", () => {
    const h = harness();
    const projection = p4Changed([RUNE]);
    sendProjection(h.first, projection);
    expect(h.client.submitDuelCommand({ type: "rune-energy", uid: "p1-rune" })).toBe(true);
    expect(h.first.commands).toHaveLength(1);

    vi.advanceTimersByTime(10_000);
    expect(h.first.commands).toHaveLength(2);
    vi.advanceTimersByTime(10_000);
    expect(h.first.commands).toHaveLength(3);
    expect(h.pending).toEqual([true]);

    // A fourth timeout exhausts MAX_COMMAND_ATTEMPTS: pending is dropped with one
    // surfaced error rather than retrying forever.
    vi.advanceTimersByTime(10_000);
    expect(h.first.commands).toHaveLength(3);
    expect(h.pending).toEqual([true, false]);
    expect(h.errors).toContain("操作确认超时，请重试。");
    const requestIds = new Set(h.first.commands.map(command => command.requestId));
    expect(requestIds.size).toBe(3);
  });

  it("keeps the surface read-only while the real client is reconnecting after a socket failure", () => {
    const h = harness();
    const projection = p4Changed([RUNE]);
    sendProjection(h.first, projection);
    expect(h.client.submitDuelCommand({ type: "rune-energy", uid: "p1-rune" })).toBe(true);

    h.first.serverClose();
    expect(h.client.status).toBe("reconnecting");
    const connectionStatus = toPlayableConnectionStatus(h.client.status, h.handshake.at(-1) ?? false);
    expect(connectionStatus).toBe("reconnecting");

    const html = renderBoard(projection, connectionStatus, h.pending.at(-1) ?? false);
    expect(html).toContain("正在重连，界面只读");
    expect(buttonTag(html, RUNE.label)).toContain("disabled");
    expect(h.client.submitDuelCommand({ type: "rune-energy", uid: "p1-rune" })).toBe(false);
  });

  it("drops the pending command and the Duel frame when a replacement socket welcomes another room", () => {
    const h = harness();
    const projection = p4Changed([RUNE]);
    sendProjection(h.first, projection);

    expect(h.client.submitDuelCommand({ type: "rune-energy", uid: "p1-rune" })).toBe(true);
    expect(h.pending).toEqual([true]);
    const original = h.first.commands.at(-1)!;

    h.first.receive({
      type: "welcome", protocolVersion: PROTOCOL_VERSION,
      session: { ...session, roomId: "room-2", resumeToken: "room-2-token" }
    });
    expect(h.projections.at(-1)).toBeNull();
    expect(h.pending).toEqual([true, false]);
    expect(h.client.status).toBe("disconnected");

    // A late receipt from the abandoned room must not resurrect the pending command.
    h.first.receive({
      type: "request-result", requestId: original.requestId, commandId: original.commandId,
      ok: true, appliedVersion: original.expectedVersion, eventSeq: original.expectedVersion
    });
    expect(h.pending).toEqual([true, false]);
    expect(h.client.submitDuelCommand({ type: "rune-energy", uid: "p1-rune" })).toBe(false);
  });

  it("never lets a mis-delivered ack (other actor / wrong id / stale clock) consume this actor's pending command", () => {
    const h = harness();
    const projection = p4Changed([RUNE]);
    sendProjection(h.first, projection);

    expect(h.client.submitDuelCommand({ type: "rune-energy", uid: "p1-rune" })).toBe(true);
    const original = h.first.commands.at(-1)!;

    // Another actor's ack carrying this command's id but a foreign requestId.
    h.first.receive({
      type: "request-result", requestId: "other-actor-req", commandId: original.commandId,
      ok: true, appliedVersion: 3, eventSeq: 3
    });
    // This requestId but another actor's commandId.
    h.first.receive({
      type: "request-result", requestId: original.requestId, commandId: "other-actor-cmd",
      ok: true, appliedVersion: 3, eventSeq: 3
    });
    // This actor's ids but an ack behind the frozen clock.
    h.first.receive({
      type: "request-result", requestId: original.requestId, commandId: original.commandId,
      ok: true, appliedVersion: 0, eventSeq: 0
    });

    expect(h.pending).toEqual([true]);
    expect(h.first.commands.at(-1)).toBe(original);
    expect(h.client.submitDuelCommand({ type: "rune-energy", uid: "p1-rune" })).toBe(false);

    receipt(h.first, original);
    expect(h.pending).toEqual([true, false]);
  });
});
