import { describe, expect, it } from "vitest";
import { DUEL_RULESET_ID, type ClientSession } from "@riftbound/protocol";
import type { V2Command, V2CommandReceipt, V2Projection }
  from "../../../../packages/protocol/dist/v2/index.js";
import { botCommand, projectedCombatDamagePlayer }
  from "../../../../packages/integration-tests/src/v2-duel/bot.js";
import { runV2Duel } from "../../../../packages/integration-tests/src/v2-duel/runner.js";
import { V2_M1_PRECONS }
  from "../../../../packages/integration-tests/src/v2-duel/m1-precons.js";
import { GameRoom } from "../../src/room.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
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
  return result as V2Projection;
}

function submitThroughRoom(started: StartedRoom, playerId: string,
  command: V2Command): V2CommandReceipt {
  const session = started.sessions[playerId];
  const connection = started.connections[playerId];
  if (session === undefined || connection === undefined) throw new Error(`Missing room session for ${playerId}`);
  let receipt: V2CommandReceipt | null = null;
  started.room.submitEngineV2(session, connection, command, message => {
    if (message !== null && typeof message === "object" &&
        (message as { readonly type?: unknown }).type === "command-receipt") {
      receipt = message as V2CommandReceipt;
    }
  });
  if (receipt === null) throw new Error(`Missing receipt for ${command.commandId}`);
  return receipt;
}

async function startedM1Room(roomId: string): Promise<StartedRoom> {
  const catalog = await loadCardCatalogRuntime();
  const room = new GameRoom(roomId, DUEL_RULESET_ID, catalog, () => 0,
    undefined, undefined, undefined, "engine-v2");
  const noMessages = (): void => undefined;
  const first = room.join("Rumble", noMessages, `${roomId}-a`);
  const second = room.join("Fiora", noMessages, `${roomId}-b`);
  const sessions = {
    [first.playerId]: { roomId, playerId: first.playerId, resumeToken: first.resumeToken },
    [second.playerId]: { roomId, playerId: second.playerId, resumeToken: second.resumeToken },
  } as const;
  const connections = {
    [first.playerId]: first.connectionId,
    [second.playerId]: second.connectionId,
  } as const;
  room.submitDeck(sessions[first.playerId]!, first.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS["rumble-sfd"].deck, `${roomId}-deck-a`, noMessages);
  room.setReady(sessions[first.playerId]!, first.connectionId, room.currentRoomVersion,
    true, `${roomId}-ready-a`, noMessages);
  room.submitDeck(sessions[second.playerId]!, second.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS["fiora-sfd"].deck, `${roomId}-deck-b`, noMessages);
  room.setReady(sessions[second.playerId]!, second.connectionId, room.currentRoomVersion,
    true, `${roomId}-ready-b`, noMessages);
  const started: StartedRoom = { room, sessions, connections };
  const playerIds = [first.playerId, second.playerId] as const;
  for (let index = 0; index < 2; index += 1) {
    const due = playerIds.map(playerId => readProjection(room, playerId)).find(view =>
      view.phase === "setup" && view.pendingChoice.status === "pending" &&
      view.pendingChoice.ownerPlayerId === view.viewerPlayerId);
    if (due === undefined || due.pendingChoice.status !== "pending") throw new Error("Expected a due mulligan owner");
    const receipt = submitThroughRoom(started, due.pendingChoice.ownerPlayerId, {
      type: "mulligan", commandId: `${roomId}-mulligan-${index}`,
      stateVersion: 0, selectedObjectIds: [],
    });
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  }
  return started;
}

function actorAndView(first: V2Projection, second: V2Projection): {
  readonly actor: string;
  readonly view: V2Projection;
} {
  const pending = [first, second].find(view => view.pendingChoice.status === "pending" &&
    view.pendingChoice.ownerPlayerId === view.viewerPlayerId);
  if (pending !== undefined) return { actor: pending.viewerPlayerId!, view: pending };
  const damageActor = projectedCombatDamagePlayer(first);
  const actor = damageActor ?? first.priority.playerId ??
    (first.actionOptions.canAdvance ? first.activePlayerId : null) ??
    (first.phase === "main" && first.chain.items.length === 0 && first.combat.status === "none"
      ? first.activePlayerId : null) ??
    (first.actionOptions.canEndTurn ? first.activePlayerId : null);
  if (actor === null) throw new Error(`No actor at state ${first.stateVersion}: ${JSON.stringify({
    first: summary(first), second: summary(second),
  })}`);
  return { actor, view: actor === first.viewerPlayerId ? first : second };
}

function moveIntoCombat(view: V2Projection, actor: string, commandId: string): V2Command | null {
  if (view.chain.items.length > 0 || view.combat.status !== "none") return null;
  const choices = view.actionOptions.moves.flatMap(option => {
    if (option.destination.kind !== "battlefield") return [];
    const field = view.battlefields.find(candidate =>
      candidate.battlefieldId === option.destination.battlefieldId);
    if (field === undefined || field.controllerPlayerId === actor) return [];
    return [{ option, field }];
  });
  const chosen = choices.sort((left, right) =>
    Number(right.field.contestedByPlayerId !== null) - Number(left.field.contestedByPlayerId !== null) ||
    Number(right.field.controllerPlayerId === null) - Number(left.field.controllerPlayerId === null))[0];
  return chosen === undefined || chosen.option.destination.kind !== "battlefield" ? null : {
    type: "move", commandId, stateVersion: view.stateVersion, objectId: chosen.option.objectId,
    to: { zone: "battlefield", locationId: chosen.option.destination.battlefieldId },
  };
}

function verifyProjectedPlayerIds(view: V2Projection): void {
  const publicIds = new Set<string>(["player-1", "player-2"]);
  const verify = (path: string, playerId: string | null | undefined): void => {
    if (playerId === null || playerId === undefined) return;
    expect(publicIds.has(playerId), `${path} contains non-public player id ${playerId}`).toBe(true);
  };
  verify("viewerPlayerId", view.viewerPlayerId);
  verify("activePlayerId", view.activePlayerId);
  verify("winnerPlayerId", view.winnerPlayerId);
  view.players.forEach((player, index) => verify(`players[${index}].playerId`, player.playerId));
  view.zones.forEach((zone, index) => {
    verify(`zones[${index}].ownerPlayerId`, zone.ownerPlayerId);
    zone.objects?.forEach((object, objectIndex) => {
      verify(`zones[${index}].objects[${objectIndex}].ownerPlayerId`, object.ownerPlayerId);
      verify(`zones[${index}].objects[${objectIndex}].controllerPlayerId`, object.controllerPlayerId);
      if (object.location?.kind === "base") {
        verify(`zones[${index}].objects[${objectIndex}].location.playerId`, object.location.playerId);
      }
    });
  });
  view.objects.forEach((object, index) => {
    verify(`objects[${index}].ownerPlayerId`, object.ownerPlayerId);
    verify(`objects[${index}].controllerPlayerId`, object.controllerPlayerId);
    if (object.location?.kind === "base") {
      verify(`objects[${index}].location.playerId`, object.location.playerId);
    }
  });
  verify("chain.priorityPlayerId", view.chain.priorityPlayerId);
  verify("chain.focusPlayerId", view.chain.focusPlayerId);
  view.chain.items.forEach((item, index) =>
    verify(`chain.items[${index}].controllerPlayerId`, item.controllerPlayerId));
  verify("priority.playerId", view.priority.playerId);
  verify("priority.focusPlayerId", view.priority.focusPlayerId);
  view.scoring.players.forEach((player, index) =>
    verify(`scoring.players[${index}].playerId`, player.playerId));
  view.battlefields.forEach((battlefield, index) => {
    verify(`battlefields[${index}].controllerPlayerId`, battlefield.controllerPlayerId);
    verify(`battlefields[${index}].contestedByPlayerId`, battlefield.contestedByPlayerId);
  });
  if (view.combat.status === "active") {
    verify("combat.attackerPlayerId", view.combat.attackerPlayerId);
    verify("combat.defenderPlayerId", view.combat.defenderPlayerId);
    verify("combat.damage.expectedPlayerId", view.combat.damage?.expectedPlayerId);
  }
  view.actionOptions.moves.forEach((option, index) => {
    if (option.destination.kind === "base") {
      verify(`actionOptions.moves[${index}].destination.playerId`, option.destination.playerId);
    }
  });
  view.actionOptions.plays.forEach((option, index) => {
    if (option.destination.kind === "base") {
      verify(`actionOptions.plays[${index}].destination.playerId`, option.destination.playerId);
    }
  });
  if (view.pendingChoice.status === "pending") {
    verify("pendingChoice.ownerPlayerId", view.pendingChoice.ownerPlayerId);
  }
  const walk = (value: unknown, path: string): void => {
    if (value === "A" || value === "B") throw new Error(`${path} leaked engine player ${value}`);
    if (Array.isArray(value)) value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
    else if (value !== null && typeof value === "object") {
      Object.entries(value).forEach(([key, entry]) => walk(entry, `${path}.${key}`));
    }
  };
  walk(view.events, "events");
}

function summary(view: V2Projection): Readonly<Record<string, unknown>> {
  return {
    viewerPlayerId: view.viewerPlayerId, stateVersion: view.stateVersion,
    eventSeq: view.eventSeq, phase: view.phase, turnNumber: view.turnNumber,
    activePlayerId: view.activePlayerId, priority: view.priority, chain: view.chain,
    combat: view.combat, pendingChoice: view.pendingChoice,
    actionOptions: view.actionOptions, scoring: view.scoring,
    winnerPlayerId: view.winnerPlayerId,
  };
}

describe("RIFT-1074 protocol v2 real two-client beta match", () => {
  it("plays rumble-sfd against fiora-sfd through two WebSockets to an authoritative winner", async () => {
    const seed = "RIFT-955-v2-07";
    const result = await runV2Duel({
      seed, port: 0, creator: "first", firstPlayerPrecon: "rumble-sfd",
      maxActions: 500, actionTimeoutMs: 45_000,
      acknowledgementTimeoutMs: 60_000, totalTimeoutMs: 780_000,
    });
    expect(result.privacy.violations).toEqual([]);
    expect(result.privacy.checkedProjections).toBeGreaterThan(0);
    expect(result.rejectedCommands).toEqual({ "player-1": 0, "player-2": 0 });
    expect(Object.values(result.rejectedCommands).reduce((sum, count) => sum + count, 0)).toBe(0);
    expect(result.rejectionReasons["player-1"]).toEqual([]);
    expect(result.rejectionReasons["player-2"]).toEqual([]);
    expect(result.termination, result.blockedReason ?? undefined).toBe("winner");
    expect(result.winnerPlayerId).toMatch(/^player-[12]$/);
    expect(result.turnCount).toBeGreaterThan(1);
    expect(result.commandCount).toBeGreaterThan(2);
    expect(result.coverage.play).toBeGreaterThan(0);
    expect(result.coverage.move).toBeGreaterThan(0);
    expect(result.coverage["choose-optional"] + result.coverage["choose-mode"] +
      result.coverage["choose-select-objects"] + result.coverage["choose-order"] +
      result.coverage["choose-number"]).toBeGreaterThan(0);
    expect(result.score[result.winnerPlayerId!]).toBeGreaterThanOrEqual(8);
    process.stdout.write(JSON.stringify({
      test: "RIFT-1074-v2-full-websocket", seed: result.seed,
      commandCount: result.commandCount, elapsedMs: result.elapsedMs,
      winnerPlayerId: result.winnerPlayerId, turnCount: result.turnCount,
      finalScore: result.score, rejectedCommands: result.rejectedCommands,
      coverage: result.coverage,
    }) + "\n");
  }, 850_000);

  it("drives real Conquest, two-sided Combat damage, and same-game scoring without rejected commands", async () => {
    const started = await startedM1Room("RIFT-1074-v2-combat");
    const rejected = new Map<string, Set<string>>();
    const trace: Array<Readonly<Record<string, unknown>>> = [];
    let sawConquer = false;
    let sawScore = false;
    let sawPlayWithDestination = false;
    let damageSubmissions = 0;
    let terminal: V2Projection | null = null;
    for (let action = 0; action < 500; action += 1) {
      const beforeFirst = readProjection(started.room, "player-1");
      const beforeSecond = readProjection(started.room, "player-2");
      verifyProjectedPlayerIds(beforeFirst);
      verifyProjectedPlayerIds(beforeSecond);
      if (beforeFirst.winnerPlayerId !== null || beforeSecond.winnerPlayerId !== null) {
        terminal = beforeFirst.winnerPlayerId !== null ? beforeFirst : beforeSecond;
        break;
      }
      const { actor, view } = actorAndView(beforeFirst, beforeSecond);
      sawPlayWithDestination ||= view.actionOptions.plays.some(option => option.requiresDestination === true);
      const commandId = `RIFT-1074-combat-${action}`;
      const command = moveIntoCombat(view, actor, commandId) ??
        botCommand(view, actor, commandId, rejected.get(actor) ?? new Set(), cardFacts);
      if (command === null) throw new Error(`No projected command for ${actor}: ${JSON.stringify(summary(view))}`);
      trace.push({ action, actor, command: command.type, stateVersion: view.stateVersion,
        turnNumber: view.turnNumber, projection: summary(view) });
      if (command.type === "play" && command.destination !== undefined) {
        expect(view.actionOptions.plays).toContainEqual(expect.objectContaining({
          cardObjectId: command.cardObjectId, destination: command.destination,
        }));
      }
      if (command.type === "combat-damage") {
        expect(view.combat).toMatchObject({ status: "active", step: "damage",
          damage: { expectedPlayerId: actor } });
        expect(view.combat.attackerPlayerId).toMatch(/^player-[12]$/);
        expect(view.combat.defenderPlayerId).toMatch(/^player-[12]$/);
      }
      const receipt = submitThroughRoom(started, actor, command);
      if (!receipt.accepted) {
        throw new Error(`Command rejected: ${JSON.stringify({ command, receipt,
          projection: summary(view), recentTrace: trace.slice(-8) })}`);
      }
      if (command.type === "combat-damage") damageSubmissions += 1;
      const afterFirst = readProjection(started.room, "player-1");
      const afterSecond = readProjection(started.room, "player-2");
      verifyProjectedPlayerIds(afterFirst);
      verifyProjectedPlayerIds(afterSecond);
      sawConquer ||= afterFirst.events.some(event => event.timingPoint === "conquer");
      sawScore ||= afterFirst.events.some(event => event.timingPoint === "score") ||
        afterFirst.scoring.players.some(player => player.points > 0);
    }
    expect(sawPlayWithDestination).toBe(true);
    expect(sawConquer, JSON.stringify(trace.slice(-10))).toBe(true);
    expect(damageSubmissions).toBeGreaterThanOrEqual(2);
    expect(sawScore, JSON.stringify(trace.slice(-10))).toBe(true);
    expect(terminal, JSON.stringify(trace.slice(-10))).not.toBeNull();
    const afterWinner = submitThroughRoom(started, terminal!.winnerPlayerId!, {
      type: "pass", commandId: "RIFT-1074-after-winner",
      stateVersion: terminal!.stateVersion,
    });
    expect(afterWinner.accepted).toBe(false);
    const afterWinnerFirst = readProjection(started.room, "player-1");
    const afterWinnerSecond = readProjection(started.room, "player-2");
    expect(afterWinnerFirst.phase).toBe("ended");
    expect(afterWinnerSecond.phase).toBe("ended");
    expect(afterWinnerFirst.winnerPlayerId).toBe(terminal!.winnerPlayerId);
    expect(afterWinnerSecond.winnerPlayerId).toBe(terminal!.winnerPlayerId);
    expect(afterWinnerFirst.stateVersion).toBe(terminal!.stateVersion);
    expect(afterWinnerSecond.stateVersion).toBe(terminal!.stateVersion);
    expect(terminal!.phase).toBe("ended");
    expect(terminal!.winnerPlayerId).toMatch(/^player-[12]$/);
    expect(terminal!.scoring.players.find(player =>
      player.playerId === terminal!.winnerPlayerId)?.points)
      .toBeGreaterThanOrEqual(terminal!.scoring.victoryScore);
    process.stdout.write(JSON.stringify({ test: "RIFT-1074-v2-combat-e2e",
      commandCount: trace.length, damageSubmissions, sawConquer, sawScore,
      winnerPlayerId: terminal!.winnerPlayerId, turnNumber: terminal!.turnNumber,
      finalScoring: terminal!.scoring }) + "\n");
  }, 300_000);
});
