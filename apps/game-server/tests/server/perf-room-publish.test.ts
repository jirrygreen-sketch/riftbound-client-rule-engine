import { describe, expect, it } from "vitest";
import { DUEL_RULESET_ID, type ClientSession } from "@riftbound/protocol";
import {
  isV2CommandReceipt,
  isV2Projection,
  type V2Command,
  type V2CommandReceipt,
  type V2Projection,
} from "../../../../packages/protocol/dist/v2/index.js";
import { botCommand } from "../../../../packages/integration-tests/src/v2-duel/bot.js";
import { V2_M1_PRECONS } from "../../../../packages/integration-tests/src/v2-duel/m1-precons.js";
import { cardProgramsById } from "../../../../packages/card-dsl/dist/cards/registry.generated.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { GameRoom, type RoomArchive } from "../../src/room.js";
import type { EngineRuntime } from "../../src/engine-runtime/index.js";

interface StartedRoom {
  readonly room: GameRoom;
  readonly sessions: Readonly<Record<string, ClientSession>>;
  readonly connections: Readonly<Record<string, string>>;
  readonly projections: Map<string, V2Projection>;
  readonly messages: unknown[];
}

const cardFacts = new Map(Object.values(V2_M1_PRECONS).flatMap(precon =>
  precon.cards.map(card => {
    const program = cardProgramsById.get(card.canonicalCardId) as unknown as CardProgram | undefined;
    const normalized = card.cardType.toLowerCase();
    return [card.canonicalCardId, {
      energy: card.energy ?? null,
      power: card.power ?? null,
      status: String(program?.status ?? "pending"),
      kind: normalized === "unit" ? "unit" as const :
        normalized === "gear" ? "gear" as const : "spell" as const,
    }] as const;
  })));

function readProjection(room: GameRoom, playerId: string): V2Projection {
  let projection: unknown;
  room.sendProjection(playerId, message => {
    if (message !== null && typeof message === "object" &&
        (message as { readonly type?: unknown }).type === "projection") {
      projection = (message as { readonly projection?: unknown }).projection;
    }
  });
  if (!isV2Projection(projection)) throw new Error(`Invalid projection for ${playerId}`);
  return projection;
}

function receiptFor(command: V2Command): (message: unknown) => boolean {
  return message => isV2CommandReceipt(message) && message.commandId === command.commandId;
}

function availableCommand(view: V2Projection, rejected: ReadonlySet<string> = new Set()): V2Command {
  const actor = view.viewerPlayerId;
  if (actor === null) throw new Error(`No actor at state ${view.stateVersion}`);
  const command = botCommand(view, actor, `RIFT-1086-command-${view.stateVersion}`, rejected, cardFacts);
  if (command === null) throw new Error(`No command at state ${view.stateVersion}`);
  return command;
}

async function startedRoom(): Promise<StartedRoom> {
  const roomId = "69dc614b";
  const catalog = await loadCardCatalogRuntime();
  const projections = new Map<string, V2Projection>();
  const messages: unknown[] = [];
  const observe = (playerId: string) => (message: unknown): void => {
    messages.push(message);
    if (message !== null && typeof message === "object" &&
        (message as { readonly type?: unknown }).type === "projection") {
      const projection = (message as { readonly projection?: unknown }).projection;
      if (isV2Projection(projection)) projections.set(playerId, projection);
    }
  };
  const room = new GameRoom(roomId, DUEL_RULESET_ID, catalog, () => 0,
    undefined, undefined, undefined, "engine-v2");
  const first = room.join("Alice", observe("player-1"), `${roomId}-a`);
  const second = room.join("Bob", observe("player-2"), `${roomId}-b`);
  const sessions = {
    "player-1": { roomId, playerId: "player-1", resumeToken: first.resumeToken },
    "player-2": { roomId, playerId: "player-2", resumeToken: second.resumeToken },
  } as const;
  const connections = {
    "player-1": first.connectionId,
    "player-2": second.connectionId,
  } as const;
  room.submitDeck(sessions["player-1"], first.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS["rumble-sfd"].deck, `${roomId}-deck-a`, observe("player-1"));
  room.setReady(sessions["player-1"], first.connectionId, room.currentRoomVersion,
    true, `${roomId}-ready-a`, observe("player-1"));
  room.submitDeck(sessions["player-2"], second.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS["fiora-sfd"].deck, `${roomId}-deck-b`, observe("player-2"));
  room.setReady(sessions["player-2"], second.connectionId, room.currentRoomVersion,
    true, `${roomId}-ready-b`, observe("player-2"));

  for (let index = 0; index < 2; index += 1) {
    const due = ["player-1", "player-2"].map(playerId => readProjection(room, playerId))
      .find(view => view.pendingChoice.status === "pending" &&
        view.pendingChoice.ownerPlayerId === view.viewerPlayerId);
    if (due === undefined || due.pendingChoice.status !== "pending" ||
        due.pendingChoice.ownerPlayerId === null) throw new Error("Expected a due mulligan owner");
    const owner = due.pendingChoice.ownerPlayerId;
    const command: V2Command = { type: "mulligan", commandId: `${roomId}-mulligan-${index}`,
      stateVersion: 0, selectedObjectIds: [] };
    let receipt: V2CommandReceipt | undefined;
    room.submitEngineV2(sessions[owner], connections[owner], command, message => {
      if (receiptFor(command)(message)) receipt = message as V2CommandReceipt;
    });
    if (receipt === undefined || !receipt.accepted) throw new Error(`Mulligan failed: ${JSON.stringify(receipt)}`);
  }
  for (const playerId of ["player-1", "player-2"]) {
    projections.set(playerId, readProjection(room, playerId));
  }
  return { room, sessions, connections, projections, messages };
}

function submit(started: StartedRoom, owner: "player-1" | "player-2", command: V2Command): V2CommandReceipt {
  let receipt: V2CommandReceipt | undefined;
  const transport = (message: unknown): void => {
    started.messages.push(message);
    if (receiptFor(command)(message)) receipt = message as V2CommandReceipt;
  };
  started.room.submitEngineV2(started.sessions[owner]!, started.connections[owner]!, command, transport);
  if (receipt === undefined) throw new Error(`No receipt for ${command.commandId}`);
  for (const playerId of ["player-1", "player-2"]) {
    started.projections.set(playerId, readProjection(started.room, playerId));
  }
  return receipt;
}

function nextAccepted(started: StartedRoom): V2CommandReceipt {
  const rejected = new Set<string>();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const views = ["player-1", "player-2"].map(playerId => started.projections.get(playerId)!);
    let command: V2Command | null = null;
    let owner: "player-1" | "player-2" | null = null;
    for (const view of views) {
      try {
        command = availableCommand(view, rejected);
        owner = view.pendingChoice.status === "pending" ?
          view.pendingChoice.ownerPlayerId as "player-1" | "player-2" :
          view.viewerPlayerId as "player-1" | "player-2";
        break;
      } catch { /* try other view */ }
    }
    if (command === null || owner === null) throw new Error(`No available command at ${views[0]!.stateVersion}`);
    const receipt = submit(started, owner, command);
    if (receipt.accepted) return receipt;
    if (command.type === "play") rejected.add(command.cardObjectId);
  }
  throw new Error("No accepted production command");
}

function projectionMessages(messages: readonly unknown[]): unknown[] {
  return messages.filter(message => message !== null && typeof message === "object" &&
    (message as { readonly type?: unknown }).type === "projection");
}

function remapLikeOldRoom(projection: V2Projection): V2Projection {
  const mapPlayer = (id: string | null): string | null => id === null ? null :
    id === "A" ? "player-1" : id === "B" ? "player-2" : id;
  const mapEventValue = (value: unknown): unknown => {
    if (value === "A" || value === "B") return mapPlayer(value);
    if (Array.isArray(value)) return value.map(mapEventValue);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, mapEventValue(nested)]));
    }
    return value;
  };
  return {
    ...projection,
    viewerPlayerId: mapPlayer(projection.viewerPlayerId),
    activePlayerId: mapPlayer(projection.activePlayerId)!,
    winnerPlayerId: mapPlayer(projection.winnerPlayerId),
    players: projection.players.map(player => ({ ...player, playerId: mapPlayer(player.playerId)! })),
    zones: projection.zones.map(zone => ({ ...zone, ownerPlayerId: mapPlayer(zone.ownerPlayerId)!, ...(zone.objects ? { objects: zone.objects.map(object => ({ ...object, ownerPlayerId: mapPlayer(object.ownerPlayerId)!, ...(object.controllerPlayerId ? { controllerPlayerId: mapPlayer(object.controllerPlayerId)! } : {}), ...(object.location?.kind === "base" ? { location: { ...object.location, playerId: mapPlayer(object.location.playerId)! } } : {}) })) } : {}) })),
    objects: projection.objects.map(object => ({ ...object, ownerPlayerId: mapPlayer(object.ownerPlayerId)!, ...(object.controllerPlayerId ? { controllerPlayerId: mapPlayer(object.controllerPlayerId)! } : {}), ...(object.location?.kind === "base" ? { location: { ...object.location, playerId: mapPlayer(object.location.playerId)! } } : {}) })),
    chain: { ...projection.chain, priorityPlayerId: mapPlayer(projection.chain.priorityPlayerId), focusPlayerId: mapPlayer(projection.chain.focusPlayerId), items: projection.chain.items.map(item => ({ ...item, controllerPlayerId: mapPlayer(item.controllerPlayerId)! })) },
    priority: { ...projection.priority, playerId: mapPlayer(projection.priority.playerId), focusPlayerId: mapPlayer(projection.priority.focusPlayerId) },
    scoring: { ...projection.scoring, players: projection.scoring.players.map(player => ({ ...player, playerId: mapPlayer(player.playerId)! })) },
    battlefields: projection.battlefields.map(battlefield => ({
      ...battlefield,
      controllerPlayerId: mapPlayer(battlefield.controllerPlayerId),
      contestedByPlayerId: mapPlayer(battlefield.contestedByPlayerId),
    })),
    combat: projection.combat.status === "active" ? {
      ...projection.combat,
      ...(projection.combat.attackerPlayerId === undefined ? {} : {
        attackerPlayerId: mapPlayer(projection.combat.attackerPlayerId)!,
      }),
      ...(projection.combat.defenderPlayerId === undefined ? {} : {
        defenderPlayerId: mapPlayer(projection.combat.defenderPlayerId)!,
      }),
      ...(projection.combat.damage === undefined ? {} : {
        damage: {
          ...projection.combat.damage,
          expectedPlayerId: mapPlayer(projection.combat.damage.expectedPlayerId)!,
        },
      }),
    } : projection.combat,
    actionOptions: {
      ...projection.actionOptions,
      moves: projection.actionOptions.moves.map(option => ({
        ...option,
        destination: option.destination.kind === "base"
          ? { ...option.destination, playerId: mapPlayer(option.destination.playerId)! }
          : option.destination,
      })),
      plays: projection.actionOptions.plays.map(option => ({
        ...option,
        destination: option.destination.kind === "base"
          ? { ...option.destination, playerId: mapPlayer(option.destination.playerId)! }
          : option.destination,
      })),
    },
    pendingChoice: projection.pendingChoice.status === "pending"
      ? { ...projection.pendingChoice, ownerPlayerId: mapPlayer(projection.pendingChoice.ownerPlayerId)! }
      : projection.pendingChoice,
    events: projection.events.map(event => mapEventValue(event) as typeof event),
  };
}

function assertSameAsOldImplementation(started: StartedRoom): void {
  const runtime = (started.room as unknown as { readonly engineRuntime: EngineRuntime | null }).engineRuntime;
  if (runtime === null) throw new Error("Started room has no runtime");
  const project = (started.room as unknown as {
    publicEngineProjection(projection: V2Projection): V2Projection;
  }).publicEngineProjection.bind(started.room);
  for (const enginePlayerId of ["A", "B"] as const) {
    const privateProjection = runtime.projectFor(enginePlayerId);
    expect(JSON.stringify(project(privateProjection))).toBe(
      JSON.stringify(remapLikeOldRoom(privateProjection)));
  }
}

function runtimeOf(started: StartedRoom): EngineRuntime {
  const runtime = (started.room as unknown as { readonly engineRuntime: EngineRuntime | null }).engineRuntime;
  if (runtime === null) throw new Error("Started room has no runtime");
  return runtime;
}

describe("RIFT-1086 Room publication caching", () => {
  it("keeps both viewer wire projections byte-identical while reusing only verified event prefixes", async () => {
    const started = await startedRoom();
    let previousEvents: readonly V2Projection["events"][number][] | null = null;
    let sawAppend = false;
    const sentBefore = projectionMessages(started.messages).length;
    for (let index = 0; index < 6; index += 1) {
      const receipt = nextAccepted(started);
      expect(receipt.accepted).toBe(true);
      const views = ["player-1", "player-2"].map(playerId => readProjection(started.room, playerId));
      const engineViews = (["A", "B"] as const).map(enginePlayerId => runtimeOf(started).projectFor(enginePlayerId));
      assertSameAsOldImplementation(started);
      expect(projectionMessages(started.messages)).toHaveLength(sentBefore + (index + 1) * 2);
      for (const view of views) {
        expect(view.viewerPlayerId).toMatch(/^player-[12]$/);
        expect(view.events.every(event => !JSON.stringify(event).includes('"A"') &&
          !JSON.stringify(event).includes('"B"'))).toBe(true);
      }
      expect(views[0]!.events.map(event => event.eventSeq)).toEqual(views[1]!.events.map(event => event.eventSeq));
      expect(engineViews[0]!.events.map(event => event.eventSeq)).toEqual(
        engineViews[1]!.events.map(event => event.eventSeq));
      if (previousEvents !== null && views[0]!.events.length > previousEvents.length) {
        expect(views[0]!.events.slice(0, previousEvents.length).map(event => ({
          ...event,
          stateVersion: 0,
        }))).toEqual(previousEvents.map(event => ({ ...event, stateVersion: 0 })));
        sawAppend = true;
      }
      previousEvents = views[0]!.events;
    }
    expect(sawAppend).toBe(true);
  }, 180_000);

  it("does not reuse a prior event view after a rejected command or room restore", async () => {
    const started = await startedRoom();
    nextAccepted(started);
    const before = readProjection(started.room, "player-1");
    assertSameAsOldImplementation(started);
    const actor = before.viewerPlayerId!;
    const command: V2Command = { type: "advance", commandId: "RIFT-1086-invalid-advance",
      stateVersion: before.stateVersion };
    const rejected = submit(started, actor as "player-1" | "player-2", command);
    expect(rejected.accepted).toBe(false);
    expect(readProjection(started.room, actor)).toEqual(before);
    const archive = started.room.exportArchive() as RoomArchive;
    const restored = GameRoom.restore(archive, await loadCardCatalogRuntime());
    expect(readProjection(restored, actor)).toEqual(before);
    expect(JSON.stringify(restored.exportArchive())).toBe(JSON.stringify(started.room.exportArchive()));
  }, 180_000);
});
