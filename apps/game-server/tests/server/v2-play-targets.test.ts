import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { DUEL_RULESET_ID, type ClientSession, type RoomDeckSubmission } from "@riftbound/protocol";
import {
  PROTOCOL_V2_VERSION,
  isV2CommandReceipt,
  isV2Projection,
  type V2Command,
  type V2ProjectedObject,
  type V2Projection
} from "../../../../packages/protocol/dist/v2/index.js";
import { createGameServer, type GameServer } from "../../src/server.js";
import { GameRoom } from "../../src/room.js";
import { InMemoryRoomStore } from "../../src/room-store.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import {
  createEngineRuntime,
  type EngineRuntime,
} from "../../src/engine-runtime/index.js";
import { cardProgramsById } from "../../../../packages/card-dsl/dist/cards/registry.generated.js";
import { p4RuntimeFixtureCatalog } from "../duel/fixtures/p4-runtime-catalog.js";
import { setupAdapterFixtureDecks } from "../duel/fixtures/setup-adapter-catalog.js";

const servers: GameServer[] = [];
const sockets: WebSocket[] = [];

class Client {
  readonly messages: unknown[] = [];
  latestProjection: V2Projection | null = null;
  private readonly wakeups = new Set<() => void>();

  constructor(readonly socket: WebSocket) {
    socket.on("message", raw => {
      const value = JSON.parse(String(raw)) as unknown;
      if (value !== null && typeof value === "object" &&
          (value as { type?: unknown }).type === "projection" &&
          isV2Projection((value as { projection?: unknown }).projection)) {
        this.latestProjection = (value as { projection: V2Projection }).projection;
      }
      this.messages.push(value);
      for (const wake of this.wakeups) wake();
    });
  }

  send(value: unknown): void { this.socket.send(JSON.stringify(value)); }

  discardProjections(): void {
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      const value = this.messages[index];
      if (value !== null && typeof value === "object" &&
          (value as { type?: unknown }).type === "projection") this.messages.splice(index, 1);
    }
  }

  async wait(
    predicate: (value: any) => boolean,
    rejectError = true,
    timeoutMs = 120_000,
  ): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (rejectError) {
        const failure = this.messages.find(value => value !== null && typeof value === "object" &&
          (value as { type?: unknown }).type === "error");
        if (failure) throw new Error(`v2 operation failed: ${JSON.stringify(failure)}`);
      }
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await new Promise<void>(resolve => {
        const wake = () => { this.wakeups.delete(wake); resolve(); };
        this.wakeups.add(wake);
        setTimeout(wake, Math.max(1, deadline - Date.now()));
      });
    }
    throw new Error(`Timed out waiting for v2 message: ${JSON.stringify(this.messages)}`);
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => { this.socket.once("close", resolve); this.socket.close(); });
  }
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  }
  for (const server of servers.splice(0)) await server.stop();
});

async function start(port: number, roomId = "r996-play-targets", store = new InMemoryRoomStore(), catalog?: unknown): Promise<{
  readonly server: GameServer;
  readonly store: InMemoryRoomStore;
  readonly url: string;
}> {
  const server = createGameServer({
    host: "127.0.0.1",
    port,
    roomIdFactory: () => roomId,
    roomStore: store,
    duelRandomIndex: () => 0,
    ...(catalog === undefined ? {} : { catalog }),
  });
  servers.push(server);
  await server.start();
  return { server, store, url: `ws://127.0.0.1:${port}/ws` };
}

async function submissions(): Promise<readonly [RoomDeckSubmission, RoomDeckSubmission]> {
  const targetFixture: RoomDeckSubmission = {
    // Official M1 cards. This focused room uses test-local structural sizes so
    // the opening hand can deterministically contain the target-bearing spell.
    mainDeck: [
      { cardId: "sfd-167-221", quantity: 3 },
      { cardId: "ogn-229-298", quantity: 3 },
      { cardId: "sfd-159-221", quantity: 3 },
      { cardId: "sfd-155-221", quantity: 2 },
      { cardId: "sfd-157-221", quantity: 2 },
      { cardId: "sfd-156-221", quantity: 2 },
      { cardId: "sfd-160-221", quantity: 2 },
      { cardId: "ogn-230-298", quantity: 2 },
      { cardId: "ogn-208-298", quantity: 1 },
    ],
    runes: [{ cardId: "ogn-214-298", quantity: 12 }],
    legend: [{ cardId: "sfd-205-221", quantity: 1 }],
    champion: [{ cardId: "sfd-110a-221", quantity: 1 }],
    battlefields: [
      { cardId: "ogn-275-298", quantity: 1 },
      { cardId: "ogn-277-298", quantity: 1 },
      { cardId: "ogn-278-298", quantity: 1 },
    ],
  };
  return [structuredClone(targetFixture), structuredClone(targetFixture)];
}

async function targetCatalog() {
  return loadCardCatalogRuntime({
    deckRules: targetDeckRules,
  });
}

const targetDeckRules = {
  cardPolicies: {},
  defaultMaxCopiesPerCanonical: 3,
  sizeRules: {
    mainDeck: { minimum: 20, maximum: 20 },
    runes: { minimum: 12, maximum: 12 },
    legend: { minimum: 1, maximum: 1 },
    champion: { minimum: 1, maximum: 1 },
    battlefields: { minimum: 3, maximum: 3 },
  },
  copyRules: [
    { zones: ["mainDeck"] as const, maxCopiesPerCanonical: 3 },
    { zones: ["runes"] as const, maxCopiesPerCanonical: 12 },
    { zones: ["legend"] as const, maxCopiesPerCanonical: 1 },
    { zones: ["champion"] as const, maxCopiesPerCanonical: 1 },
    { zones: ["battlefields"] as const, maxCopiesPerCanonical: 1 },
  ],
  uniqueCanonicalZones: ["battlefields"] as const,
  sizeGroups: [],
};

async function connect(url: string, session?: ClientSession): Promise<Client> {
  const socket = new WebSocket(url);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const client = new Client(socket);
  client.send({
    type: "hello",
    protocolVersion: PROTOCOL_V2_VERSION,
    ...(session === undefined ? {} : { roomId: session.roomId, resumeToken: session.resumeToken }),
  });
  const welcome = await client.wait(value => value?.type === "welcome" || value?.type === "error");
  if (welcome.type === "error") throw new Error(`v2 handshake failed: ${JSON.stringify(welcome)}`);
  return client;
}

async function projection(client: Client, minimumVersion = -1): Promise<V2Projection> {
  const message = await client.wait(value => value?.type === "projection" &&
    (value.projection?.stateVersion ?? -1) >= minimumVersion && value.projection?.phase !== "setup");
  if (!isV2Projection(message.projection)) throw new Error("invalid v2 projection");
  return message.projection;
}

async function setupProjection(client: Client): Promise<V2Projection> {
  const message = await client.wait(value => value?.type === "projection" && value.projection?.phase === "setup");
  if (!isV2Projection(message.projection)) throw new Error("invalid setup projection");
  return message.projection;
}

function receipt(client: Client, commandId: string) {
  return client.wait(value => isV2CommandReceipt(value) && value.commandId === commandId);
}

async function command(client: Client, value: V2Command): Promise<any> {
  client.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION, command: value });
  return receipt(client, value.commandId);
}

async function sync(client: Client, requestId: string, minimumVersion: number): Promise<V2Projection> {
  client.discardProjections();
  client.send({ type: "sync-events", requestId, afterEventSeq: 0 });
  await client.wait(value => value?.type === "request-result" && value.requestId === requestId);
  return projection(client, minimumVersion);
}

function hand(view: V2Projection, playerId: string) {
  return view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === playerId)?.objects ?? [];
}

function base(view: V2Projection, playerId: string): readonly V2ProjectedObject[] {
  return view.objects.filter(object => object.zone === "board" &&
    object.location?.kind === "base" && object.location.playerId === playerId);
}

function readyRunes(view: V2Projection, playerId: string) {
  return (view.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === playerId)?.objects ?? [])
    .filter(rune => rune.exhausted === false && rune.zoneEntryId !== undefined);
}

function playFor(view: V2Projection, playerId: string, names: readonly string[]) {
  const cards = hand(view, playerId);
  return [...view.actionOptions.plays]
    .filter(option => {
      const card = cards.find(candidate => candidate.objectId === option.cardObjectId);
      return card?.name !== undefined && names.includes(card.name);
    })
    .sort((left, right) => left.destination.kind === "base" && right.destination.kind !== "base" ? -1
      : left.destination.kind !== "base" && right.destination.kind === "base" ? 1 : 0)[0];
}

/**
 * Prepare through normal EngineRuntime commands only. The target spell's source
 * and target are both real M1 cards; no frame, zone, resource, or projection is
 * changed directly.
 */
function playerIdFor(runtime: EngineRuntime, seat: "A" | "B"): string {
  return runtime.projectFor(seat).viewerPlayerId!;
}

function settleAdds(runtime: EngineRuntime, owner: string, actor: string): V2Projection {
  let view = runtime.projectFor(actor);
  for (let index = 0; index < 8 && view.chain.items.length > 0; index += 1) {
    const priority = view.chain.priorityPlayerId ?? view.priority.playerId;
    if (priority === null) throw new Error(`Rune Add chain has no priority player: ${JSON.stringify(view.chain)}`);
    const result = runtime.submit(priority, { type: "pass", commandId: `target-add:${owner}:${index}`,
      stateVersion: view.stateVersion });
    expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
    view = result.projection;
  }
  expect(view.chain.items).toEqual([]);
  return view;
}

function prepareTargetScene(runtime: EngineRuntime): void {
  let sequence = 0;
  for (let step = 0; step < 400; step += 1) {
    const publicView = runtime.projectFor(null);
    if (publicView.winnerPlayerId !== null) throw new Error(`M1 match ended before the target scene: ${JSON.stringify({
      winner: publicView.winnerPlayerId, turn: publicView.turnNumber, active: publicView.activePlayerId,
      score: publicView.scoring, handCounts: publicView.players.map(player => [player.playerId, player.handCount]),
      deckCounts: publicView.players.map(player => [player.playerId, player.deckCount]),
      aHand: hand(runtime.projectFor("A"), playerIdFor(runtime, "A")).map(card => card.name),
      bHand: hand(runtime.projectFor("B"), playerIdFor(runtime, "B")).map(card => card.name),
    })}`);
    const seat: "A" | "B" = publicView.activePlayerId === playerIdFor(runtime, "A") ? "A" : "B";
    const actor = publicView.pendingChoice.status === "pending" ? publicView.pendingChoice.ownerPlayerId : seat;
    const view = runtime.projectFor(actor);
    let next: V2Command;
    if (view.pendingChoice.status === "pending") {
      const choice = view.pendingChoice;
      const options = choice.options ?? [];
      const answer = choice.kind === "optional" ? false
        : choice.kind === "mode" ? options[0]?.value ?? options[0]?.id ?? null
        : choice.kind === "number" ? choice.min ?? 0
        : options.slice(0, Math.max(choice.min ?? 1, 1)).map(option => option.objectRef ?? option.id);
      next = { type: "choose", commandId: `target-scene-${sequence++}`, stateVersion: view.stateVersion,
        choiceId: choice.choiceId, answer: answer as never };
    } else if (view.chain.items.length > 0) {
      next = { type: "pass", commandId: `target-scene-${sequence++}`, stateVersion: view.stateVersion };
    } else if (seat === "A") {
      const spell = hand(view, playerIdFor(runtime, "A")).find(card => card.name === "Vengeance");
      const spellPlay = spell === undefined ? undefined : view.actionOptions.plays.find(option =>
        option.cardObjectId === spell.objectId && option.targetRequirements?.length === 1);
      const source = base(view, playerIdFor(runtime, "A")).find(object => object.name === "Unsung Hero");
      const unitPlay = playFor(view, playerIdFor(runtime, "A"), ["Unsung Hero"]);
      const publicPlayer = view.players.find(player => player.playerId === playerIdFor(runtime, "A"));
      if (spellPlay !== undefined && source !== undefined && (publicPlayer?.energy ?? 0) >= 4 &&
          (publicPlayer?.power.Order ?? 0) >= 2) return;
      if (unitPlay !== undefined && (publicPlayer?.energy ?? 0) >= 2) {
        next = { type: "play", commandId: `target-scene-${sequence++}`, stateVersion: view.stateVersion,
          cardObjectId: unitPlay.cardObjectId, destination: unitPlay.destination };
      } else if ((publicPlayer?.energy ?? 0) < 4 && readyRunes(view, playerIdFor(runtime, "A")).length > 0) {
        next = { type: "rune-energy", commandId: `target-scene-${sequence++}`, stateVersion: view.stateVersion,
          runeObjectId: readyRunes(view, playerIdFor(runtime, "A"))[0]!.objectId,
          zoneEntryId: readyRunes(view, playerIdFor(runtime, "A"))[0]!.zoneEntryId! };
      } else if ((publicPlayer?.power.Order ?? 0) < 2 &&
          readyRunes(view, playerIdFor(runtime, "A")).length > 0) {
        next = { type: "rune-power", commandId: `target-scene-${sequence++}`, stateVersion: view.stateVersion,
          runeObjectId: readyRunes(view, playerIdFor(runtime, "A"))[0]!.objectId,
          zoneEntryId: readyRunes(view, playerIdFor(runtime, "A"))[0]!.zoneEntryId! };
      } else {
        next = { type: "end-turn", commandId: `target-scene-${sequence++}`, stateVersion: view.stateVersion };
      }
    } else {
      const unit = base(view, playerIdFor(runtime, "B")).find(object => object.name === "Unsung Hero");
      const unitPlay = playFor(view, playerIdFor(runtime, "B"), ["Unsung Hero"]);
      const publicPlayer = view.players.find(player => player.playerId === playerIdFor(runtime, "B"));
      if (unit === undefined && unitPlay !== undefined && (publicPlayer?.energy ?? 0) >= 2) {
        next = { type: "play", commandId: `target-scene-${sequence++}`, stateVersion: view.stateVersion,
          cardObjectId: unitPlay.cardObjectId, destination: unitPlay.destination };
      } else if ((unit === undefined || (publicPlayer?.energy ?? 0) < 2) &&
          (publicPlayer?.energy ?? 0) < 2 && readyRunes(view, playerIdFor(runtime, "B")).length > 0) {
        next = { type: "rune-energy", commandId: `target-scene-${sequence++}`, stateVersion: view.stateVersion,
          runeObjectId: readyRunes(view, playerIdFor(runtime, "B"))[0]!.objectId,
          zoneEntryId: readyRunes(view, playerIdFor(runtime, "B"))[0]!.zoneEntryId! };
      } else if ((publicPlayer?.energy ?? 0) >= 6 && readyRunes(view, playerIdFor(runtime, "B")).length > 0) {
        next = { type: "rune-power", commandId: `target-scene-${sequence++}`, stateVersion: view.stateVersion,
          runeObjectId: readyRunes(view, playerIdFor(runtime, "B"))[0]!.objectId,
          zoneEntryId: readyRunes(view, playerIdFor(runtime, "B"))[0]!.zoneEntryId! };
      } else {
        next = { type: "end-turn", commandId: `target-scene-${sequence++}`, stateVersion: view.stateVersion };
      }
    }
    const result = runtime.submit(actor, next);
    if (result.receipt.status === "rejected") {
      throw new Error(`target scene command rejected: ${JSON.stringify({ command: next,
        rejection: result.receipt.error, aHand: hand(runtime.projectFor("A"), playerIdFor(runtime, "A")).map(card => card.name),
        bHand: hand(runtime.projectFor("B"), playerIdFor(runtime, "B")).map(card => card.name) })}`);
    }
  }
  throw new Error("real M1 runtime did not reach a legal Vengeance target scene");
}

async function preparedPair(port: number, roomId: string) {
  const catalog = await targetCatalog();
  const [deckA, deckB] = await submissions();
  const room = new GameRoom(roomId, DUEL_RULESET_ID, catalog, () => 0,
    undefined, undefined, undefined, "engine-v2");
  const noMessages = () => undefined;
  const connectionA = room.join("Alice", noMessages, "prepare-a");
  const connectionB = room.join("Bob", noMessages, "prepare-b");
  const sessionA: ClientSession = { roomId, playerId: connectionA.playerId, resumeToken: connectionA.resumeToken };
  const sessionB: ClientSession = { roomId, playerId: connectionB.playerId, resumeToken: connectionB.resumeToken };
  room.submitDeck(sessionA, connectionA.connectionId, room.currentRoomVersion, deckA, "prepare-deck-a", noMessages);
  room.setReady(sessionA, connectionA.connectionId, room.currentRoomVersion, true, "prepare-ready-a", noMessages);
  room.submitDeck(sessionB, connectionB.connectionId, room.currentRoomVersion, deckB, "prepare-deck-b", noMessages);
  room.setReady(sessionB, connectionB.connectionId, room.currentRoomVersion, true, "prepare-ready-b", noMessages);
  let setup: V2Projection | undefined;
  room.sendProjection("player-1", message => { setup = (message as { projection: V2Projection }).projection; });
  if (!setup) throw new Error("prepared room did not project its mulligan window");
  const order = setup.activePlayerId === "player-1"
    ? [[sessionA, connectionA], [sessionB, connectionB]] as const
    : [[sessionB, connectionB], [sessionA, connectionA]] as const;
  for (const [index, [session, connection]] of order.entries()) {
    room.submitEngineV2(session, connection.connectionId, {
      type: "mulligan", commandId: `prepare-mulligan-${index}`, stateVersion: 0,
      selectedObjectIds: [],
    }, noMessages);
  }
  const runtime = (room as unknown as { readonly engineRuntime: EngineRuntime | null }).engineRuntime;
  if (runtime === null) throw new Error("prepared room did not create its authoritative runtime");
  prepareTargetScene(runtime);
  const store = new InMemoryRoomStore();
  await store.create(room);
  const running = await start(port, roomId, store, catalog);
  const alice = await connect(running.url, sessionA);
  const bob = await connect(running.url, sessionB);
  const a = await projection(alice);
  const b = await projection(bob);
  return { ...running, room, runtime, alice, bob, sessionA, sessionB, actorView: a, opponentView: b };
}

async function resolveChoicesAndChain(
  h: { readonly alice: Client; readonly bob: Client; readonly sessionA: ClientSession; readonly sessionB: ClientSession },
  starting: V2Projection,
  prefix: string,
): Promise<V2Projection> {
  let current = starting;
  for (let index = 0; index < 30; index += 1) {
    if (current.pendingChoice.status === "pending") {
      const choice = current.pendingChoice;
      const owner = choice.ownerPlayerId === h.sessionA.playerId ? h.alice
        : choice.ownerPlayerId === h.sessionB.playerId ? h.bob : null;
      if (owner === null) throw new Error(`unknown choice owner ${choice.ownerPlayerId}`);
      current = await sync(owner, `${prefix}-choice-owner-sync-${index}`, current.stateVersion);
      if (current.pendingChoice.status !== "pending" || current.pendingChoice.choiceId !== choice.choiceId) continue;
      const options = choice.options ?? [];
      const answer = choice.kind === "optional" ? false
        : choice.kind === "mode" ? options[0]?.value ?? options[0]?.id ?? null
        : choice.kind === "number" ? choice.min ?? 0
        : options.slice(0, Math.max(choice.min ?? 1, 1)).map(option => option.objectRef ?? option.id);
      const result = await command(owner, { type: "choose", commandId: `${prefix}-choose-${index}`,
        stateVersion: current.stateVersion, choiceId: choice.choiceId, answer: answer as never });
      expect(result.accepted, JSON.stringify(result)).toBe(true);
      current = await sync(owner, `${prefix}-choice-sync-${index}`, result.stateVersion);
    } else if (current.chain.items.length > 0) {
      const priority = current.priority.playerId;
      const holder = priority === h.sessionA.playerId ? h.alice : priority === h.sessionB.playerId ? h.bob : null;
      if (holder === null) throw new Error("open chain has no known priority player");
      current = await sync(holder, `${prefix}-pass-owner-sync-${index}`, current.stateVersion);
      const result = await command(holder, { type: "pass", commandId: `${prefix}-pass-${index}`,
        stateVersion: current.stateVersion });
      expect(result.accepted, JSON.stringify(result)).toBe(true);
      current = await sync(holder, `${prefix}-pass-sync-${index}`, result.stateVersion);
    } else {
      return current;
    }
  }
  throw new Error("chain did not settle");
}

describe("protocol v2 play targets over the real runtime and WebSocket", () => {
  it("correlates a V2 command error with its command id when no room session exists", async () => {
    const port = Number(process.env.SWARM_PORT_BASE ?? 33000) + 2;
    const running = await start(port, "r996-no-session");
    const alice = await connect(running.url);
    const commandId = "r996-no-session-command";
    alice.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION, command: {
      type: "pass", commandId, stateVersion: 0,
    } });
    const failure = await alice.wait(value => value?.type === "error", false);
    expect(failure).toMatchObject({ type: "error", requestId: commandId, code: "command-rejected" });
  }, 60_000);

  it("publishes private Vengeance targets, rejects an invalid play without side effects and resolves the legal play", async () => {
    const port = Number(process.env.SWARM_PORT_BASE ?? 33000);
    const h = await preparedPair(port, "r996-prepared-9");
    const actorPlayerId = h.sessionA.playerId;
    const spell = hand(h.actorView, actorPlayerId).find(card => card.name === "Vengeance");
    expect(spell).toBeDefined();
    const option = h.actorView.actionOptions.plays.find(candidate => candidate.cardObjectId === spell!.objectId);
    expect(option).toMatchObject({ requiresDestination: false });
    expect(option?.targetRequirements?.map(requirement => requirement.id)).toEqual(["chosen-unit"]);
    expect(h.opponentView.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === actorPlayerId)?.objects)
      .toBeUndefined();
    expect(JSON.stringify(h.opponentView.actionOptions)).not.toContain(spell!.objectId);
    expect(JSON.stringify(h.opponentView.actionOptions)).not.toContain("chosen-unit");

    const before = await sync(h.alice, "targets-before-invalid", h.actorView.stateVersion);
    const invalidTargets: Extract<V2Command, { readonly type: "play" }>["targets"] = [
      { kind: "object", objectId: spell!.objectId, zoneEntryId: spell!.zoneEntryId! },
    ];
    const rejected = await command(h.alice, { type: "play", commandId: "vengeance-invalid-targets",
      stateVersion: before.stateVersion, cardObjectId: spell!.objectId, targets: invalidTargets });
    expect(rejected.accepted).toBe(false);
    const after = await sync(h.alice, "targets-after-invalid", before.stateVersion);
    expect(after.stateVersion).toBe(before.stateVersion);
    expect(after.eventSeq).toBe(before.eventSeq);
    expect(after.objects.find(object => object.objectId === spell!.objectId)?.zone).toBe("hand");
    expect(h.room.runtimeClock).toEqual({ stateVersion: before.stateVersion, eventSeq: before.eventSeq });
    expect(before.players.find(player => player.playerId === actorPlayerId)).toMatchObject({ energy: 4 });
    expect(before.players.find(player => player.playerId === actorPlayerId)?.power.Order).toBeGreaterThanOrEqual(2);

    const targets = option!.targetRequirements!.map(requirement => {
      const ref = requirement.options[0]!.objectRef!;
      return { kind: "object" as const, objectId: ref.objectId, zoneEntryId: ref.zoneEntryId };
    });
    const accepted = await command(h.alice, { type: "play", commandId: "vengeance-legal-target",
      stateVersion: after.stateVersion, cardObjectId: spell!.objectId, targets });
    expect(accepted.accepted, JSON.stringify(accepted)).toBe(true);
    const afterAccepted = await sync(h.alice, "targets-after-valid", accepted.stateVersion);
    expect(afterAccepted.objects.find(object => object.objectId === targets![0]!.objectId)).toBeDefined();
    const resolved = await resolveChoicesAndChain(h, afterAccepted, "vengeance-resolve");
    expect(resolved.objects.find(object => object.objectId === spell!.objectId)?.zone).toBe("trash");
    expect(resolved.objects.find(object => object.objectId === targets[0]!.objectId)?.zone).toBe("trash");
    expect(resolved.events.map(event => event.timingPoint)).toEqual(expect.arrayContaining([
      "became-target", "object-killed", "chain-item-finalize", "chain-item-resolve"
    ]));
  }, 300_000);

  it("returns the V2 command id on an outer transaction failure and rolls back state", async () => {
    const failingCommandId = "r996-outer-transaction-failure";
    class FailOnceStore extends InMemoryRoomStore {
      failCommand = false;
      override async save(room: Parameters<InMemoryRoomStore["save"]>[0]) {
        if (this.failCommand) {
          this.failCommand = false;
          throw new Error(`injected v2 save failure for ${failingCommandId}`);
        }
        return super.save(room);
      }
    }
    const port = Number(process.env.SWARM_PORT_BASE ?? 33000) + 1;
    const store = new FailOnceStore();
    const running = await start(port, "r996-error-correlation", store, p4RuntimeFixtureCatalog);
    const deckA = setupAdapterFixtureDecks.a.submission;
    const deckB = setupAdapterFixtureDecks.b.submission;
    const alice = await connect(running.url);
    alice.send({ type: "create-room", requestId: "create", playerName: "Alice", rulesetId: DUEL_RULESET_ID });
    const sessionA = (await alice.wait(value => value?.type === "welcome" && value.session !== undefined)).session as ClientSession;
    await alice.wait(value => value?.type === "request-result" && value.requestId === "create");
    const bob = await connect(running.url);
    bob.send({ type: "join-room", requestId: "join", roomId: sessionA.roomId, playerName: "Bob" });
    const sessionB = (await bob.wait(value => value?.type === "welcome" && value.session !== undefined)).session as ClientSession;
    await bob.wait(value => value?.type === "request-result" && value.requestId === "join");
    const room = running.server.rooms.get(sessionA.roomId)!;
    let roomVersion = room.currentRoomVersion;
    for (const [index, client] of [alice, bob].entries()) {
      client.send({ type: "submit-deck", requestId: `deck-${index}`, expectedRoomVersion: roomVersion,
        deck: index === 0 ? deckA : deckB });
      roomVersion = (await client.wait(value => value?.type === "request-result" &&
        value.requestId === `deck-${index}`)).roomVersion;
      client.send({ type: "set-ready", requestId: `ready-${index}`, expectedRoomVersion: roomVersion, ready: true });
      roomVersion = (await client.wait(value => value?.type === "request-result" &&
        value.requestId === `ready-${index}`)).roomVersion;
    }
    alice.send({ type: "sync-events", requestId: "error-sync-setup-a" });
    bob.send({ type: "sync-events", requestId: "error-sync-setup-b" });
    await Promise.all([
      alice.wait(value => value?.type === "request-result" && value.requestId === "error-sync-setup-a"),
      bob.wait(value => value?.type === "request-result" && value.requestId === "error-sync-setup-b"),
    ]);
    const waitingA = await setupProjection(alice);
    const waitingB = await setupProjection(bob);
    expect(waitingA.phase).toBe("setup");
    expect(waitingB.phase).toBe("setup");
    const firstClient = waitingA.activePlayerId === sessionA.playerId ? alice : bob;
    const secondClient = firstClient === alice ? bob : alice;
    firstClient.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION,
      command: { type: "mulligan", commandId: "error-path-mulligan-a", stateVersion: 0, selectedObjectIds: [] } });
    await receipt(firstClient, "error-path-mulligan-a");
    secondClient.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION,
      command: { type: "mulligan", commandId: "error-path-mulligan-b", stateVersion: 0, selectedObjectIds: [] } });
    await receipt(secondClient, "error-path-mulligan-b");
    for (const client of [alice, bob]) client.latestProjection = null;
    alice.send({ type: "sync-events", requestId: "error-sync-main-a" });
    bob.send({ type: "sync-events", requestId: "error-sync-main-b" });
    await Promise.all([
      alice.wait(value => value?.type === "request-result" && value.requestId === "error-sync-main-a"),
      bob.wait(value => value?.type === "request-result" && value.requestId === "error-sync-main-b"),
    ]);
    const [beforeA, beforeB] = await Promise.all([
      sync(alice, "error-main-sync-a", -1),
      sync(bob, "error-main-sync-b", -1),
    ]);
    expect(beforeA.phase).toBe("main");
    expect(beforeB.phase).toBe("main");
    const commandId = failingCommandId;
    store.failCommand = true;
    alice.send({ type: "command", protocolVersion: PROTOCOL_V2_VERSION,
      command: { type: "pass", commandId, stateVersion: beforeA.stateVersion } });
    const failure = await alice.wait(value => value?.type === "error", false);
    expect(failure).toMatchObject({ type: "error", requestId: commandId, code: "command-rejected",
      message: `injected v2 save failure for ${commandId}` });
    const [afterA, afterB] = await Promise.all([
      sync(alice, "sync-error-a", beforeA.stateVersion),
      sync(bob, "sync-error-b", beforeB.stateVersion),
    ]);
    expect(afterA.stateVersion).toBe(beforeA.stateVersion);
    expect(afterA.eventSeq).toBe(beforeA.eventSeq);
    expect(afterB.stateVersion).toBe(beforeB.stateVersion);
    expect(afterB.eventSeq).toBe(beforeB.eventSeq);
    expect(room.runtimeClock).toEqual({ stateVersion: beforeA.stateVersion, eventSeq: beforeA.eventSeq });
  }, 180_000);
});
