import { describe, expect, it } from "vitest";
import { DUEL_RULESET_ID, type ClientSession } from "@riftbound/protocol";
import {
  isV2CommandReceipt,
  isV2Projection,
  type V2Command,
  type V2CommandReceipt,
  type V2Projection,
} from "../../../../packages/protocol/dist/v2/index.js";
import { GameRoom } from "../../src/room.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import type { EngineRuntime } from "../../src/engine-runtime/index.js";
import {
  botCommand,
  projectedCombatDamagePlayer,
} from "../../../../packages/integration-tests/src/v2-duel/bot.js";
import { V2_M1_PRECONS } from "../../../../packages/integration-tests/src/v2-duel/m1-precons.js";
import { cardProgramsById } from "../../../../packages/card-dsl/dist/cards/registry.generated.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";

type CardFact = {
  readonly energy: number | null;
  readonly power: number | null;
  readonly status: string;
  readonly kind: "unit" | "gear" | "spell";
};

interface StartedRoom {
  readonly room: GameRoom;
  readonly sessions: Readonly<Record<string, ClientSession>>;
  readonly connections: Readonly<Record<string, string>>;
  readonly observedEngineCommands: readonly V2Command[];
}

const cardFacts = new Map<string, CardFact>(Object.values(V2_M1_PRECONS).flatMap(precon =>
  precon.cards.map(card => {
    const program = cardProgramsById.get(card.canonicalCardId) as unknown as CardProgram | undefined;
    const normalized = card.cardType.toLowerCase();
    const kind: CardFact["kind"] = normalized === "unit" ? "unit" : normalized === "gear" ? "gear" : "spell";
    return [card.canonicalCardId, {
      energy: card.energy ?? null,
      power: card.power ?? null,
      status: String(program?.status ?? "pending"),
      kind,
    }] as const;
  })));

function readProjection(room: GameRoom, playerId: string): V2Projection {
  let result: unknown;
  room.sendProjection(playerId, message => {
    if (message !== null && typeof message === "object" &&
        (message as { readonly type?: unknown }).type === "projection") {
      result = (message as { readonly projection?: unknown }).projection;
    }
  });
  if (!isV2Projection(result)) throw new Error(`Invalid projection for ${playerId}`);
  return result;
}

function submitThroughRoom(started: StartedRoom, playerId: string, command: V2Command): V2CommandReceipt {
  const session = started.sessions[playerId];
  const connection = started.connections[playerId];
  if (!session || !connection) throw new Error(`Missing room session for ${playerId}`);
  let receipt: unknown;
  started.room.submitEngineV2(session, connection, command, message => {
    if (isV2CommandReceipt(message)) receipt = message;
  });
  if (!isV2CommandReceipt(receipt)) throw new Error(`Missing receipt for ${command.commandId}`);
  return receipt;
}

async function startedM1Room(roomId: string): Promise<StartedRoom> {
  const catalog = await loadCardCatalogRuntime();
  const room = new GameRoom(roomId, DUEL_RULESET_ID, catalog, () => 0,
    undefined, undefined, undefined, "engine-v2");
  const noMessages = () => undefined;
  const first = room.join("Alice", noMessages, `${roomId}-a`);
  const second = room.join("Bob", noMessages, `${roomId}-b`);
  const sessions = {
    [first.playerId]: { roomId, playerId: first.playerId, resumeToken: first.resumeToken },
    [second.playerId]: { roomId, playerId: second.playerId, resumeToken: second.resumeToken },
  } as const;
  const connections = { [first.playerId]: first.connectionId, [second.playerId]: second.connectionId } as const;
  room.submitDeck(sessions[first.playerId], first.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS["rumble-sfd"].deck, `${roomId}-deck-a`, noMessages);
  room.setReady(sessions[first.playerId], first.connectionId, room.currentRoomVersion,
    true, `${roomId}-ready-a`, noMessages);
  room.submitDeck(sessions[second.playerId], second.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS["fiora-sfd"].deck, `${roomId}-deck-b`, noMessages);
  room.setReady(sessions[second.playerId], second.connectionId, room.currentRoomVersion,
    true, `${roomId}-ready-b`, noMessages);
  const started = { room, sessions, connections };
  const playerIds = [first.playerId, second.playerId] as const;
  for (let index = 0; index < 2; index += 1) {
    const views = playerIds.map(playerId => readProjection(room, playerId));
    const due = views.find(view => view.phase === "setup" &&
      view.pendingChoice.status === "pending" && view.pendingChoice.ownerPlayerId === view.viewerPlayerId);
    if (!due || due.pendingChoice.status !== "pending") throw new Error("Expected a due mulligan owner");
    const owner = due.pendingChoice.ownerPlayerId;
    const receipt = submitThroughRoom(started, owner, {
      type: "mulligan", commandId: `${roomId}-mulligan-${index}`,
      stateVersion: 0, selectedObjectIds: [],
    });
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  }
  for (const playerId of playerIds) expect(readProjection(room, playerId).phase).toBe("main");
  const runtime = (room as unknown as { readonly engineRuntime: EngineRuntime | null }).engineRuntime;
  if (runtime === null) throw new Error("Started room has no engine runtime");
  const observedEngineCommands: V2Command[] = [];
  const submit = runtime.submit.bind(runtime);
  runtime.submit = (playerId, command) => {
    observedEngineCommands.push(structuredClone(command));
    return submit(playerId, command);
  };
  return { ...started, observedEngineCommands };
}

function verifyProjectionPlayerIds(projection: V2Projection): void {
  const publicIds = new Set(projection.players.map(player => player.playerId));
  expect([...publicIds].sort()).toEqual(["player-1", "player-2"]);
  const verify = (path: string, id: string | null): void => {
    if (id === null) return;
    expect(publicIds.has(id), `${path} contains non-public player id ${id}`).toBe(true);
    expect(["A", "B"]).not.toContain(id);
  };
  verify("viewerPlayerId", projection.viewerPlayerId);
  verify("activePlayerId", projection.activePlayerId);
  verify("winnerPlayerId", projection.winnerPlayerId);
  projection.players.forEach((player, index) => verify(`players[${index}].playerId`, player.playerId));
  projection.zones.forEach((zone, zoneIndex) => {
    verify(`zones[${zoneIndex}].ownerPlayerId`, zone.ownerPlayerId);
    zone.objects?.forEach((object, objectIndex) => {
      verify(`zones[${zoneIndex}].objects[${objectIndex}].ownerPlayerId`, object.ownerPlayerId);
      verify(`zones[${zoneIndex}].objects[${objectIndex}].controllerPlayerId`, object.controllerPlayerId ?? null);
      if (object.location?.kind === "base") {
        verify(`zones[${zoneIndex}].objects[${objectIndex}].location.playerId`, object.location.playerId);
      }
    });
  });
  projection.objects.forEach((object, index) => {
    verify(`objects[${index}].ownerPlayerId`, object.ownerPlayerId);
    verify(`objects[${index}].controllerPlayerId`, object.controllerPlayerId ?? null);
    if (object.location?.kind === "base") verify(`objects[${index}].location.playerId`, object.location.playerId);
  });
  verify("chain.priorityPlayerId", projection.chain.priorityPlayerId);
  verify("chain.focusPlayerId", projection.chain.focusPlayerId);
  projection.chain.items.forEach((item, index) => verify(`chain.items[${index}].controllerPlayerId`, item.controllerPlayerId));
  verify("priority.playerId", projection.priority.playerId);
  verify("priority.focusPlayerId", projection.priority.focusPlayerId);
  projection.scoring.players.forEach((player, index) => verify(`scoring.players[${index}].playerId`, player.playerId));
  projection.battlefields.forEach((battlefield, index) => {
    verify(`battlefields[${index}].controllerPlayerId`, battlefield.controllerPlayerId);
    verify(`battlefields[${index}].contestedByPlayerId`, battlefield.contestedByPlayerId);
  });
  if (projection.combat.status === "active") {
    verify("combat.attackerPlayerId", projection.combat.attackerPlayerId ?? null);
    verify("combat.defenderPlayerId", projection.combat.defenderPlayerId ?? null);
    verify("combat.damage.expectedPlayerId", projection.combat.damage?.expectedPlayerId ?? null);
  }
  projection.actionOptions.moves.forEach((option, index) => {
    if (option.destination.kind === "base") {
      verify(`actionOptions.moves[${index}].destination.playerId`, option.destination.playerId);
    }
  });
  projection.actionOptions.plays.forEach((option, index) => {
    if (option.destination.kind === "base") {
      verify(`actionOptions.plays[${index}].destination.playerId`, option.destination.playerId);
    }
  });
  if (projection.pendingChoice.status === "pending") {
    verify("pendingChoice.ownerPlayerId", projection.pendingChoice.ownerPlayerId);
  }
  const walkEvent = (value: unknown, path: string): void => {
    if (value === "A" || value === "B") throw new Error(`${path} leaked engine player ${value}`);
    if (Array.isArray(value)) value.forEach((item, index) => walkEvent(item, `${path}[${index}]`));
    else if (value !== null && typeof value === "object") {
      Object.entries(value).forEach(([key, nested]) => walkEvent(nested, `${path}.${key}`));
    }
  };
  walkEvent(projection.events, "events");
}

function actorAndView(first: V2Projection, second: V2Projection): { readonly actor: string; readonly view: V2Projection } {
  const pending = [first, second].find(view => view.pendingChoice.status === "pending" &&
    view.pendingChoice.ownerPlayerId === view.viewerPlayerId);
  if (pending) return { actor: pending.viewerPlayerId!, view: pending };
  const damageActor = projectedCombatDamagePlayer(first);
  const actor = damageActor ?? first.priority.playerId ??
    (first.actionOptions.canAdvance ? first.activePlayerId : null) ??
    (first.phase === "main" && first.chain.items.length === 0 && first.combat.status === "none"
      ? first.activePlayerId : null) ??
    (first.actionOptions.canEndTurn ? first.activePlayerId : null);
  if (actor === null) throw new Error(`No actor at state ${first.stateVersion}`);
  return { actor, view: actor === first.viewerPlayerId ? first : second };
}

function nextCommand(view: V2Projection, actor: string, commandId: string,
  rejectedPlays: ReadonlySet<string>): V2Command | null {
  return botCommand(view, actor, commandId, rejectedPlays, cardFacts);
}

async function advanceToFirstBasePlay(started: StartedRoom): Promise<{
  readonly actor: string;
  readonly view: V2Projection;
  readonly command: Extract<V2Command, { readonly type: "play" }>;
}> {
  const rejected = new Map<string, Set<string>>();
  for (let action = 0; action < 100; action += 1) {
    const first = readProjection(started.room, "player-1");
    const second = readProjection(started.room, "player-2");
    const { actor, view } = actorAndView(first, second);
    const command = nextCommand(view, actor, `${started.room.roomId}-base-probe-${action}`,
      rejected.get(actor) ?? new Set());
    if (command === null) throw new Error(`No command while preparing base play at state ${view.stateVersion}`);
    if (command.type !== "play" || command.destination?.kind !== "base") {
      const receipt = submitThroughRoom(started, actor, command);
      if (!receipt.accepted && command.type === "play") {
        const values = rejected.get(actor) ?? new Set();
        values.add(command.cardObjectId);
        rejected.set(actor, values);
      }
      continue;
    }
    return { actor, view, command };
  }
  throw new Error("Real M1 room did not expose a Base play");
}

describe("protocol v2 room player id boundary", () => {
  it("keeps every projected player field public and completes real conquest and two-sided Combat damage", async () => {
    const started = await startedM1Room("RIFT-1058-v2-07");
    const rejected = new Map<string, Set<string>>();
    let sawBasePlay = false;
    let sawConquer = false;
    let sawBaseMoveOption = false;
    let sawBattlefieldController = false;
    let sawContestedBattlefield = false;
    let sawCombatIdentities = false;
    let sawCombatExpectedPlayer = false;
    let damageSubmissions = 0;
    for (let action = 0; action < 500 && (!sawConquer || damageSubmissions < 2); action += 1) {
      const beforeFirst = readProjection(started.room, "player-1");
      const beforeSecond = readProjection(started.room, "player-2");
      verifyProjectionPlayerIds(beforeFirst);
      verifyProjectionPlayerIds(beforeSecond);
      const { actor, view } = actorAndView(beforeFirst, beforeSecond);
      sawBaseMoveOption ||= beforeFirst.actionOptions.moves.some(option => option.destination.kind === "base");
      sawBattlefieldController ||= beforeFirst.battlefields.some(field => field.controllerPlayerId !== null);
      sawContestedBattlefield ||= beforeFirst.battlefields.some(field => field.contestedByPlayerId !== null);
      sawCombatIdentities ||= beforeFirst.combat.status === "active" &&
        beforeFirst.combat.attackerPlayerId !== undefined && beforeFirst.combat.defenderPlayerId !== undefined;
      sawCombatExpectedPlayer ||= beforeFirst.combat.status === "active" &&
        beforeFirst.combat.damage?.expectedPlayerId !== undefined;
      const command = nextCommand(view, actor, `RIFT-1058-v2-07-${action}`, rejected.get(actor) ?? new Set());
      if (command === null) {
        throw new Error(`No projected command for ${actor}: ${JSON.stringify({
          phase: view.phase, priority: view.priority, combat: view.combat,
          chain: view.chain, choice: view.pendingChoice, actions: view.actionOptions,
        })}`);
      }
      if (command.type === "play" && command.destination?.kind === "base") {
        expect(command.destination.playerId).toBe(actor);
        const option = view.actionOptions.plays.find(candidate =>
          candidate.cardObjectId === command.cardObjectId && candidate.destination.kind === "base");
        expect(option?.destination).toEqual(command.destination);
      }
      if (command.type === "combat-damage") {
        expect(view.combat.status).toBe("active");
        if (view.combat.status !== "active" || view.combat.damage === undefined) {
          throw new Error("Combat damage command requires a damage projection");
        }
        expect(view.combat.damage.expectedPlayerId).toBe(actor);
        expect(view.combat.attackerPlayerId).toMatch(/^player-[12]$/);
        expect(view.combat.defenderPlayerId).toMatch(/^player-[12]$/);
      }
      const receipt = submitThroughRoom(started, actor, command);
      if (!receipt.accepted) {
        if (command.type === "play") {
          const values = rejected.get(actor) ?? new Set();
          values.add(command.cardObjectId);
          rejected.set(actor, values);
        }
        continue;
      }
      if (command.type === "play" && command.destination?.kind === "base") sawBasePlay = true;
      if (command.type === "combat-damage") damageSubmissions += 1;
      const afterFirst = readProjection(started.room, "player-1");
      const afterSecond = readProjection(started.room, "player-2");
      verifyProjectionPlayerIds(afterFirst);
      verifyProjectionPlayerIds(afterSecond);
      sawConquer ||= afterFirst.events.some(event => event.timingPoint === "conquer");
      expect(afterFirst.stateVersion).toBeGreaterThanOrEqual(beforeFirst.stateVersion);
    }
    expect(sawBasePlay).toBe(true);
    expect(sawConquer).toBe(true);
    expect(sawBaseMoveOption).toBe(true);
    expect(sawBattlefieldController).toBe(true);
    expect(sawContestedBattlefield).toBe(true);
    expect(sawCombatIdentities).toBe(true);
    expect(sawCombatExpectedPlayer).toBe(true);
    expect(damageSubmissions).toBeGreaterThanOrEqual(2);
  }, 300_000);

  it("maps public Base ids inbound, preserves legacy A/B input, and still lets the engine reject foreign ids", async () => {
    const started = await startedM1Room("RIFT-1058-v2-input");
    const prepared = await advanceToFirstBasePlay(started);
    const opponent = prepared.actor === "player-1" ? "player-2" : "player-1";
    expect(prepared.command.destination).toEqual({ kind: "base", playerId: prepared.actor });

    const foreign = submitThroughRoom(started, prepared.actor, {
      ...prepared.command, commandId: "RIFT-1058-v2-input-foreign",
      destination: { kind: "base", playerId: opponent },
    });
    expect(foreign.accepted).toBe(false);
    expect(foreign.rejection).toMatch(/Base|Unknown|control|play/i);
    expect(readProjection(started.room, prepared.actor).stateVersion).toBe(prepared.view.stateVersion);

    const unknown = submitThroughRoom(started, prepared.actor, {
      ...prepared.command, commandId: "RIFT-1058-v2-input-unknown",
      destination: { kind: "base", playerId: "player-does-not-exist" },
    });
    expect(unknown.accepted).toBe(false);
    expect(unknown.rejection).toMatch(/Base|Unknown|control|play/i);

    const playerSelection = submitThroughRoom(started, prepared.actor, {
      ...prepared.command, commandId: "RIFT-1058-v2-input-player-selection",
      targets: [{ kind: "player", playerId: opponent }],
      picks: [{ kind: "player", playerId: prepared.actor }],
    });
    expect(playerSelection.accepted).toBe(false);
    const observedSelection = started.observedEngineCommands.find(command =>
      command.commandId === "RIFT-1058-v2-input-player-selection");
    expect(observedSelection).toMatchObject({
      targets: [{ kind: "player", playerId: opponent === "player-1" ? "A" : "B" }],
      picks: [{ kind: "player", playerId: prepared.actor === "player-1" ? "A" : "B" }],
    });

    const legacy = submitThroughRoom(started, prepared.actor, {
      ...prepared.command, commandId: "RIFT-1058-v2-input-legacy",
      destination: { kind: "base", playerId: prepared.actor === "player-1" ? "A" : "B" },
    });
    expect(legacy.accepted, JSON.stringify(legacy)).toBe(true);
  }, 180_000);
});
