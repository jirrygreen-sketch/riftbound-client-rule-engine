import { afterEach, describe, expect, it } from "vitest";
import type { V2Command, V2CommandReceipt, V2Projection }
  from "../../../../packages/protocol/dist/v2/index.js";
import { projectedCombatDamagePlayer, projectedPlayCommand }
  from "../../../../packages/integration-tests/src/v2-duel/bot.js";
import { V2WebSocketSession }
  from "../../../../packages/integration-tests/src/v2-duel/ws-session.js";
import { V2_M1_PRECONS }
  from "../../../../packages/integration-tests/src/v2-duel/m1-precons.js";
import { createGameServer, type GameServer } from "../../src/server.js";
import { InMemoryRoomStore } from "../../src/room-store.js";

const FIXED_SEED = "RIFT-1074-v2-combat";
const PUBLIC_PLAYER_IDS = ["player-1", "player-2"] as const;
const MAX_COMMANDS = 500;
const RECEIPT_TIMEOUT_MS = 60_000;

const servers: GameServer[] = [];
const sessions: V2WebSocketSession[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) session.closeImmediately();
  for (const server of servers.splice(0)) {
    if (server.httpServer.listening) await server.stop();
  }
});

async function startPair(seed: string): Promise<{
  readonly server: GameServer;
  readonly first: V2WebSocketSession;
  readonly second: V2WebSocketSession;
}> {
  const server = createGameServer({
    host: "127.0.0.1",
    port: 0,
    roomIdFactory: () => seed,
    roomStore: new InMemoryRoomStore(),
    duelRandomIndex: () => 0,
  });
  servers.push(server);
  await server.start();
  const address = server.httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("Game server did not expose a TCP port");
  }
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const noProjection = (): void => undefined;
  const first = await V2WebSocketSession.connect(url, `${seed}-rumble`, noProjection);
  const second = await V2WebSocketSession.connect(url, `${seed}-fiora`, noProjection);
  sessions.push(first, second);
  await first.createRoom("Rumble");
  await second.joinRoom(first.snapshot.session.roomId, "Fiora");
  await first.submitDeck(V2_M1_PRECONS["rumble-sfd"].deck);
  await second.submitDeck(V2_M1_PRECONS["fiora-sfd"].deck);
  await first.setReady();
  await second.setReady();
  await Promise.all([
    first.waitForProjection(() => true, "rumble setup"),
    second.waitForProjection(() => true, "fiora setup"),
  ]);
  return { server, first, second };
}

function choiceCommand(view: V2Projection, actor: string,
  commandId: string): Extract<V2Command, { type: "choose" }> | null {
  if (view.pendingChoice.status !== "pending" || view.pendingChoice.ownerPlayerId !== actor) return null;
  const choice = view.pendingChoice;
  const options = choice.options ?? [];
  const min = choice.min ?? 1;
  let answer: Extract<V2Command, { type: "choose" }>["answer"] | null;
  switch (choice.kind) {
    case "optional": answer = options[0]?.value ?? options[0]?.id ?? false; break;
    case "mode": answer = options[0]?.value ?? options[0]?.id ?? null; break;
    case "number": answer = min; break;
    case "order": answer = options.map(option => option.objectRef ?? option.id); break;
    case "select-objects":
      answer = min === 0 ? [] : options.slice(0, min)
        .map(option => option.objectRef ?? option.id);
      if (min > 0 && answer.length < min) answer = null;
      break;
  }
  return answer === null ? null : {
    type: "choose", commandId, stateVersion: view.stateVersion,
    choiceId: choice.choiceId, answer,
  };
}

function combatDamageCommand(view: V2Projection, actor: string,
  commandId: string): Extract<V2Command, { type: "combat-damage" }> | null {
  if (view.combat.status !== "active" || view.combat.step !== "damage" ||
      view.combat.damage === undefined || view.combat.combatId === undefined ||
      view.combat.damage.expectedPlayerId !== actor) return null;
  const battlefield = view.battlefields.find(field =>
    field.battlefieldId === view.combat.battlefieldId);
  const opponent = view.players.find(player => player.playerId !== actor)?.playerId;
  if (battlefield === undefined || opponent === undefined) return null;
  const targets = battlefield.occupantObjectIds.flatMap(objectId => {
    const object = view.objects.find(candidate => candidate.objectId === objectId);
    return object !== undefined && (object.controllerPlayerId ?? object.ownerPlayerId) === opponent
      ? [object.objectId]
      : [];
  });
  if (targets.length === 0) return null;
  const might = view.combat.damage.attackerSubmitted
    ? view.combat.damage.defenderMight
    : view.combat.damage.attackerMight;
  const base = Math.floor(might / targets.length);
  const assignments = targets.map((unitObjectId, index) => ({
    unitObjectId,
    amount: index === targets.length - 1 ? might - base * (targets.length - 1) : base,
  })).filter(assignment => assignment.amount > 0);
  return assignments.length === 0 ? null : {
    type: "combat-damage", commandId, stateVersion: view.stateVersion,
    combatId: view.combat.combatId, assignments,
  };
}

function nextProjectedCommand(view: V2Projection, actor: string,
  commandId: string): V2Command | null {
  if (view.phase === "setup") {
    return view.pendingChoice.status === "pending" && view.pendingChoice.ownerPlayerId === actor
      ? { type: "mulligan", commandId, stateVersion: view.stateVersion, selectedObjectIds: [] }
      : null;
  }
  const choice = choiceCommand(view, actor, commandId);
  if (choice !== null) return choice;
  const damage = combatDamageCommand(view, actor, commandId);
  if (damage !== null) return damage;
  if (view.combat.status === "active" && view.actionOptions.canAdvance === true &&
      view.priority.playerId === actor) {
    return { type: "advance", commandId, stateVersion: view.stateVersion };
  }
  for (const option of view.actionOptions.plays) {
    const play = projectedPlayCommand(option, commandId, view.stateVersion);
    if (play !== null) return play;
  }
  const move = view.actionOptions.moves[0];
  if (move !== undefined) {
    return {
      type: "move", commandId, stateVersion: view.stateVersion,
      objectId: move.objectId,
      to: move.destination.kind === "base"
        ? { zone: "base", playerId: move.destination.playerId }
        : { zone: "battlefield", locationId: move.destination.battlefieldId },
    };
  }
  if (view.chain.items.length > 0 || view.priority.focusPlayerId !== null) {
    return view.priority.playerId === actor
      ? { type: "pass", commandId, stateVersion: view.stateVersion }
      : null;
  }
  const rune = (view.zones.find(zone => zone.zone === "rune-zone" &&
    zone.ownerPlayerId === actor)?.objects ?? []).find(candidate =>
    candidate.exhausted === false && candidate.zoneEntryId !== undefined);
  if (rune !== undefined && rune.zoneEntryId !== undefined) {
    return {
      type: "rune-energy", commandId, stateVersion: view.stateVersion,
      runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId,
    };
  }
  return view.actionOptions.canEndTurn && view.activePlayerId === actor
    ? { type: "end-turn", commandId, stateVersion: view.stateVersion }
    : null;
}

function verifyProjectedPlayerIds(view: V2Projection): void {
  const publicIds = new Set<string>(PUBLIC_PLAYER_IDS);
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

function projectionSummary(view: V2Projection): Readonly<Record<string, unknown>> {
  return {
    viewerPlayerId: view.viewerPlayerId, stateVersion: view.stateVersion,
    eventSeq: view.eventSeq, phase: view.phase, turnNumber: view.turnNumber,
    activePlayerId: view.activePlayerId, priority: view.priority, chain: view.chain,
    combat: view.combat, pendingChoice: view.pendingChoice,
    actionOptions: view.actionOptions, scoring: view.scoring,
    winnerPlayerId: view.winnerPlayerId,
  };
}

async function waitAfterReceipt(session: V2WebSocketSession, before: V2Projection,
  command: V2Command, receipt: V2CommandReceipt): Promise<V2Projection> {
  if (command.type === "choose") {
    const current = session.snapshot.projection;
    const changedChoice = current !== null && current.pendingChoice.status === "pending" &&
      before.pendingChoice.status === "pending" &&
      current.pendingChoice.choiceId !== before.pendingChoice.choiceId;
    if (current !== null && (current.stateVersion > before.stateVersion ||
        current.eventSeq > before.eventSeq ||
        (before.pendingChoice.status === "pending" && current.pendingChoice.status === "none") ||
        changedChoice)) return current;
    return session.waitForProjection(view => view.stateVersion > before.stateVersion ||
      view.eventSeq > before.eventSeq ||
      (before.pendingChoice.status === "pending" && view.pendingChoice.status === "none") ||
      (before.pendingChoice.status === "pending" && view.pendingChoice.status === "pending" &&
        view.pendingChoice.choiceId !== before.pendingChoice.choiceId),
      `projection after ${command.commandId}`);
  }
  const current = session.snapshot.projection;
  if (current !== null && (current.stateVersion > before.stateVersion ||
      current.eventSeq > before.eventSeq ||
      (current.stateVersion === receipt.stateVersion && current.pendingChoice.status === "pending"))) {
    return current;
  }
  return session.waitForProjectionAfter(command.commandId, receipt);
}

describe("RIFT-1074 protocol v2 real two-client beta match", () => {
  it("plays rumble-sfd against fiora-sfd through two WebSockets to a natural winner", async () => {
    const { server, first, second } = await startPair(FIXED_SEED);
    const playerIds = [first.snapshot.session.playerId, second.snapshot.session.playerId] as const;
    let firstView = first.snapshot.projection;
    let secondView = second.snapshot.projection;
    if (firstView === null || secondView === null) {
      throw new Error("Both clients require initial projections");
    }
    const rejected: Array<Readonly<Record<string, unknown>>> = [];
    const trace: Array<Readonly<Record<string, unknown>>> = [];
    const commandCounts: Record<string, number> = {};
    let damageCommands = 0;
    let sawConquer = false;
    let sawPlayWithDestination = false;
    let sawScore = false;
    let terminal: V2Projection | null = null;
    try {
      for (let index = 0; index < MAX_COMMANDS; index += 1) {
        verifyProjectedPlayerIds(firstView);
        verifyProjectedPlayerIds(secondView);
        expect(firstView.stateVersion).toBe(secondView.stateVersion);
        expect(firstView.eventSeq).toBe(secondView.eventSeq);
        expect(firstView.viewerPlayerId).toBe(playerIds[0]);
        expect(secondView.viewerPlayerId).toBe(playerIds[1]);
        if (firstView.winnerPlayerId !== null || secondView.winnerPlayerId !== null) {
          terminal = firstView.winnerPlayerId !== null ? firstView : secondView;
          break;
        }
        const pending = firstView.pendingChoice.status === "pending" ? firstView
          : secondView.pendingChoice.status === "pending" ? secondView : null;
        expect(pending === null || pending.pendingChoice.status === "pending").toBe(true);
        const actor = pending?.pendingChoice.status === "pending"
          ? pending.pendingChoice.ownerPlayerId
          : projectedCombatDamagePlayer(firstView) ?? firstView.priority.playerId ??
            (firstView.actionOptions.canAdvance ? firstView.activePlayerId : null) ??
            (firstView.phase === "main" && firstView.chain.items.length === 0 &&
              firstView.combat.status === "none" ? firstView.activePlayerId : null) ??
            (firstView.actionOptions.canEndTurn ? firstView.activePlayerId : null);
        if (actor === null) {
          throw new Error(`No projected actor: ${JSON.stringify({
            first: projectionSummary(firstView), second: projectionSummary(secondView),
          })}`);
        }
        expect(PUBLIC_PLAYER_IDS).toContain(actor);
        const session = actor === playerIds[0] ? first : second;
        const view = actor === playerIds[0] ? firstView : secondView;
        const commandId = `RIFT-1074-full-${index}`;
        const command = nextProjectedCommand(view, actor, commandId);
        if (command === null) {
          throw new Error(`No projected command: ${JSON.stringify(projectionSummary(view))}`);
        }
        trace.push({
          index, actor, commandId, commandType: command.type,
          stateVersion: view.stateVersion, turnNumber: view.turnNumber,
          projection: projectionSummary(view),
        });
        commandCounts[command.type] = (commandCounts[command.type] ?? 0) + 1;
        if (command.type === "play" && command.destination !== undefined) {
          expect(view.actionOptions.plays).toContainEqual(expect.objectContaining({
            cardObjectId: command.cardObjectId, destination: command.destination,
          }));
          sawPlayWithDestination = true;
        }
        if (command.type === "move") {
          const option = view.actionOptions.moves.find(candidate =>
            candidate.objectId === command.objectId &&
            (candidate.destination.kind === "base"
              ? command.to.zone === "base" && command.to.playerId === candidate.destination.playerId
              : command.to.zone === "battlefield" &&
                command.to.locationId === candidate.destination.battlefieldId));
          expect(option).toBeDefined();
        }
        if (command.type === "combat-damage") {
          damageCommands += 1;
          expect(view.combat).toMatchObject({
            status: "active", step: "damage",
            damage: { expectedPlayerId: actor },
          });
          expect(view.combat.attackerPlayerId).toMatch(/^player-[12]$/);
          expect(view.combat.defenderPlayerId).toMatch(/^player-[12]$/);
        }
        const receipt = await session.sendCommandWithin(command, RECEIPT_TIMEOUT_MS);
        if (!receipt.accepted) {
          rejected.push({ command, receipt, projection: projectionSummary(view) });
          throw new Error(`Command rejected: ${JSON.stringify({
            command, receipt, projection: projectionSummary(view),
            recentTrace: trace.slice(-8),
          })}`);
        }
        const next = await Promise.all([
          waitAfterReceipt(first, firstView, command, receipt),
          waitAfterReceipt(second, secondView, command, receipt),
        ]);
        firstView = next[0];
        secondView = next[1];
        sawConquer ||= firstView.events.some(event => event.timingPoint === "conquer");
        sawScore ||= firstView.events.some(event => event.timingPoint === "score") ||
          firstView.scoring.players.some(player => player.points > 0);
      }
    } finally {
      first.closeImmediately();
      second.closeImmediately();
      await server.stop();
    }
    expect(rejected).toEqual([]);
    expect(commandCounts.mulligan).toBe(2);
    expect(commandCounts.play).toBeGreaterThan(0);
    expect(commandCounts.choose).toBeGreaterThan(0);
    expect(commandCounts.move).toBeGreaterThan(0);
    expect(commandCounts.advance).toBeGreaterThan(0);
    expect(damageCommands, JSON.stringify(trace.slice(-10))).toBeGreaterThanOrEqual(2);
    expect(sawConquer, JSON.stringify(trace.slice(-10))).toBe(true);
    expect(sawPlayWithDestination).toBe(true);
    expect(sawScore, JSON.stringify(trace.slice(-10))).toBe(true);
    expect(terminal, JSON.stringify(trace.slice(-10))).not.toBeNull();
    expect(terminal!.phase).toBe("ended");
    expect(PUBLIC_PLAYER_IDS).toContain(terminal!.winnerPlayerId!);
    expect(terminal!.scoring.players.find(player =>
      player.playerId === terminal!.winnerPlayerId)?.points)
      .toBeGreaterThanOrEqual(terminal!.scoring.victoryScore);
    expect(terminal!.actionOptions).toMatchObject({
      canEndTurn: false, canAdvance: false, moves: [], plays: [],
    });
    process.stdout.write(JSON.stringify({
      test: "RIFT-1074-v2-two-client-full-match-e2e", seed: FIXED_SEED,
      commandCount: trace.length, commandCounts, damageCommands,
      winnerPlayerId: terminal!.winnerPlayerId, turnNumber: terminal!.turnNumber,
      finalScoring: terminal!.scoring,
    }) + "\n");
  }, 600_000);
});
