import { describe, expect, it } from "vitest";

import { DUEL_RULESET_ID, type ClientSession } from "@riftbound/protocol";
import type { V2Command, V2CommandReceipt, V2Projection }
  from "../../../../packages/protocol/dist/v2/index.js";
import { botCommand, projectedCombatDamagePlayer }
  from "../../../../packages/integration-tests/src/v2-duel/bot.js";
import { V2_M1_PRECONS }
  from "../../../../packages/integration-tests/src/v2-duel/m1-precons.js";
import { cardProgramsById }
  from "../../../../packages/card-dsl/dist/cards/registry.generated.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import { GameRoom } from "../../src/room.js";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";

// Core Rules v1.5 (published 2026-10-09, effective 2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// 466.2.c.3 assigns Attacker/Defender during the real Combat Showdown;
// 467.2.a sums only the Attacking Units' current Might, while 467.2.b does the
// same for the Defending Units. The projection and both assignment commands
// must preserve those two server-authoritative totals.

type CardFact = {
  readonly energy: number | null;
  readonly power: number | null;
  readonly status: string;
  readonly kind: "unit" | "gear" | "spell";
};

const cardFacts = new Map<string, CardFact>(Object.values(V2_M1_PRECONS).flatMap(precon =>
  precon.cards.map(card => {
    const program = cardProgramsById.get(card.canonicalCardId) as unknown as CardProgram | undefined;
    const normalized = card.cardType.toLowerCase();
    const kind = normalized === "unit" ? "unit" as const :
      normalized === "gear" ? "gear" as const : "spell" as const;
    return [card.canonicalCardId, { energy: card.energy ?? null, power: card.power ?? null,
      status: String(program?.status ?? "pending"), kind }] as const;
  })));

interface StartedRoom {
  readonly room: GameRoom;
  readonly sessions: Readonly<Record<string, ClientSession>>;
  readonly connections: Readonly<Record<string, string>>;
  readonly playerIds: readonly [string, string];
}

function readProjection(room: GameRoom, playerId: string): V2Projection {
  let result: V2Projection | undefined;
  room.sendProjection(playerId, message => {
    if (message !== null && typeof message === "object" &&
        (message as { readonly type?: unknown }).type === "projection") {
      result = (message as { readonly projection?: V2Projection }).projection;
    }
  });
  if (result === undefined) throw new Error(`Missing projection for ${playerId}`);
  return result;
}

function submitThroughRoom(started: StartedRoom, playerId: string,
  command: V2Command): V2CommandReceipt {
  const session = started.sessions[playerId];
  const connection = started.connections[playerId];
  if (session === undefined || connection === undefined) {
    throw new Error(`Missing room session for ${playerId}`);
  }
  let receipt: V2CommandReceipt | undefined;
  started.room.submitEngineV2(session, connection, command, message => {
    if (message !== null && typeof message === "object" &&
        (message as { readonly type?: unknown }).type === "command-receipt") {
      receipt = message as V2CommandReceipt;
    }
  });
  if (receipt === undefined) throw new Error(`Missing receipt for ${command.commandId}`);
  return receipt;
}

async function startedRumbleRoom(roomId: string): Promise<StartedRoom> {
  const catalog = await loadCardCatalogRuntime();
  const room = new GameRoom(roomId, DUEL_RULESET_ID, catalog, () => 0,
    undefined, undefined, undefined, "engine-v2");
  const noMessages = (): void => undefined;
  const first = room.join("Rumble", noMessages, `${roomId}-a`);
  const second = room.join("Rumble", noMessages, `${roomId}-b`);
  const sessions: Record<string, ClientSession> = {
    [first.playerId]: { roomId, playerId: first.playerId, resumeToken: first.resumeToken },
    [second.playerId]: { roomId, playerId: second.playerId, resumeToken: second.resumeToken },
  };
  const connections: Record<string, string> = {
    [first.playerId]: first.connectionId,
    [second.playerId]: second.connectionId,
  };
  room.submitDeck(sessions[first.playerId]!, first.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS["rumble-sfd"].deck, `${roomId}-deck-a`, noMessages);
  room.setReady(sessions[first.playerId]!, first.connectionId, room.currentRoomVersion,
    true, `${roomId}-ready-a`, noMessages);
  room.submitDeck(sessions[second.playerId]!, second.connectionId, room.currentRoomVersion,
    V2_M1_PRECONS["rumble-sfd"].deck, `${roomId}-deck-b`, noMessages);
  room.setReady(sessions[second.playerId]!, second.connectionId, room.currentRoomVersion,
    true, `${roomId}-ready-b`, noMessages);
  const playerIds = [first.playerId, second.playerId] as const;
  const started: StartedRoom = { room, sessions, connections, playerIds };
  for (let index = 0; index < 2; index += 1) {
    const due = playerIds.map(playerId => readProjection(room, playerId)).find(view =>
      view.phase === "setup" && view.pendingChoice.status === "pending" &&
      view.pendingChoice.ownerPlayerId === view.viewerPlayerId);
    if (due === undefined || due.pendingChoice.status !== "pending") {
      throw new Error("Expected a due Mulligan owner");
    }
    const receipt = submitThroughRoom(started, due.pendingChoice.ownerPlayerId, {
      type: "mulligan", commandId: `${roomId}-mulligan-${index}`,
      stateVersion: 0, selectedObjectIds: [],
    });
    expect(receipt.accepted, JSON.stringify(receipt)).toBe(true);
  }
  return started;
}

function responsibleView(views: readonly [V2Projection, V2Projection]): {
  readonly actor: string;
  readonly view: V2Projection;
} {
  const pending = views.find(view => view.pendingChoice.status === "pending" &&
    view.pendingChoice.ownerPlayerId === view.viewerPlayerId);
  if (pending !== undefined) return { actor: pending.viewerPlayerId!, view: pending };
  const damageActor = projectedCombatDamagePlayer(views[0]);
  const actor = damageActor ?? views[0].priority.playerId ??
    (views[0].actionOptions.canAdvance ? views[0].activePlayerId : null) ??
    (views[0].phase === "main" && views[0].chain.items.length === 0 &&
      views[0].combat.status === "none" ? views[0].activePlayerId : null) ??
    (views[0].actionOptions.canEndTurn ? views[0].activePlayerId : null);
  if (actor === null) throw new Error(`No responsible room actor at state ${views[0].stateVersion}`);
  return { actor, view: actor === views[0].viewerPlayerId ? views[0] : views[1] };
}

describe("RIFT-1171 combat damage budget room projection", () => {
  it("keeps a 2-Might side at 2 and a 4-Might side at 4 in the same damage window", async () => {
    const started = await startedRumbleRoom("RIFT-1171-independent-budgets");
    let damageView: V2Projection | null = null;
    for (let step = 0; step < 160; step += 1) {
      const views = started.playerIds.map(playerId =>
        readProjection(started.room, playerId)) as [V2Projection, V2Projection];
      if (views[0].combat.status === "active" && views[0].combat.step === "damage") {
        damageView = views[0];
        break;
      }
      const { actor, view } = responsibleView(views);
      let command: V2Command | null = null;
      if (view.chain.items.length === 0 && view.combat.status === "none") {
        const move = view.actionOptions.moves.find(option => option.destination.kind === "battlefield");
        if (move?.destination.kind === "battlefield") {
          command = { type: "move", commandId: `RIFT-1171-independent-${step}`,
            stateVersion: view.stateVersion, objectId: move.objectId,
            to: { zone: "battlefield", locationId: move.destination.battlefieldId } };
        }
      }
      command ??= botCommand(view, actor, `RIFT-1171-independent-${step}`, new Set(), cardFacts);
      if (command === null) throw new Error(`No projected room command at step ${step}`);
      expect(submitThroughRoom(started, actor, command).accepted).toBe(true);
    }
    expect(damageView).not.toBeNull();
    if (damageView?.combat.status !== "active" || damageView.combat.step !== "damage" ||
        damageView.combat.damage === undefined) throw new Error("Damage window was not reached");
    expect([damageView.combat.damage.attackerMight, damageView.combat.damage.defenderMight].sort())
      .toEqual([2, 4]);
    expect(damageView.combat.damage.attackerMight)
      .not.toBe(damageView.combat.damage.attackerMight + damageView.combat.damage.defenderMight);
    expect(damageView.combat.damage.defenderMight)
      .not.toBe(damageView.combat.damage.attackerMight + damageView.combat.damage.defenderMight);
  }, 120_000);

  it("derives each projected budget from the participating Units on each side", async () => {
    const started = await startedRumbleRoom("RIFT-1171-participant-budget");
    let damageView: V2Projection | null = null;
    for (let step = 0; step < 160; step += 1) {
      const views = started.playerIds.map(playerId =>
        readProjection(started.room, playerId)) as [V2Projection, V2Projection];
      if (views[0].combat.status === "active" && views[0].combat.step === "damage") {
        damageView = views[0];
        break;
      }
      const { actor, view } = responsibleView(views);
      let command: V2Command | null = null;
      if (view.chain.items.length === 0 && view.combat.status === "none") {
        const move = view.actionOptions.moves.find(option => option.destination.kind === "battlefield");
        if (move?.destination.kind === "battlefield") {
          command = { type: "move", commandId: `RIFT-1171-participant-${step}`,
            stateVersion: view.stateVersion, objectId: move.objectId,
            to: { zone: "battlefield", locationId: move.destination.battlefieldId } };
        }
      }
      command ??= botCommand(view, actor, `RIFT-1171-participant-${step}`, new Set(), cardFacts);
      if (command === null) throw new Error(`No projected room command at step ${step}`);
      expect(submitThroughRoom(started, actor, command).accepted).toBe(true);
    }
    expect(damageView).not.toBeNull();
    if (damageView?.combat.status !== "active" || damageView.combat.step !== "damage" ||
        damageView.combat.damage === undefined) throw new Error("Damage window was not reached");
    const combat = damageView.combat;
    const units = damageView.battlefields.find(field =>
      field.battlefieldId === combat.battlefieldId)?.occupantObjectIds ?? [];
    expect(units).toHaveLength(2);
    const sideMight = (playerId: string) => units.flatMap(objectId => {
      const object = damageView!.objects.find(candidate => candidate.objectId === objectId);
      const controller = object?.controllerPlayerId ?? object?.ownerPlayerId;
      return object !== undefined && controller === playerId && object.might !== undefined
        ? [object.might] : [];
    }).reduce((sum, might) => sum + might, 0);
    expect(combat.damage.attackerMight).toBe(sideMight(combat.attackerPlayerId));
    expect(combat.damage.defenderMight).toBe(sideMight(combat.defenderPlayerId));
  }, 120_000);

  it("keeps each side's authoritative damage budget independent", async () => {
    const roomId = "RIFT-1171-combat-damage-budget-room";
    const started = await startedRumbleRoom(roomId);
    let combatDamage: V2Projection["combat"] | null = null;
    let battlefieldUnits: readonly {
      readonly id: string;
      readonly cardId?: string;
      readonly might?: number;
    }[] = [];

    for (let step = 0; step < 160; step += 1) {
      const views = started.playerIds.map(playerId =>
        readProjection(started.room, playerId)) as [V2Projection, V2Projection];
      const combat = views[0].combat;
      if (combat.status === "active") {
        const field = views[0].battlefields.find(candidate =>
          candidate.battlefieldId === combat.battlefieldId);
        battlefieldUnits = (field?.occupantObjectIds ?? []).map(id => {
          const object = views[0].objects.find(candidate => candidate.objectId === id);
          return { id, ...(object?.cardId === undefined ? {} : { cardId: object.cardId }),
            ...(object?.might === undefined ? {} : { might: object.might }) };
        });
        if (combat.step === "damage") {
          combatDamage = combat;
          break;
        }
      }
      const { actor, view } = responsibleView(views);
      let command: V2Command | null = null;
      if (view.chain.items.length === 0 && view.combat.status === "none") {
        const move = view.actionOptions.moves.find(option => option.destination.kind === "battlefield");
        if (move?.destination.kind === "battlefield") {
          command = { type: "move", commandId: `${roomId}-${step}`,
            stateVersion: view.stateVersion, objectId: move.objectId,
            to: { zone: "battlefield", locationId: move.destination.battlefieldId } };
        }
      }
      command ??= botCommand(view, actor, `${roomId}-${step}`, new Set(), cardFacts);
      if (command === null) throw new Error(`No projected room command: ${JSON.stringify({
        step, actor, phase: view.phase, priority: view.priority, combat: view.combat,
        chain: view.chain, actionOptions: view.actionOptions,
      })}`);
      const receipt = submitThroughRoom(started, actor, command);
      expect(receipt.accepted, JSON.stringify({ step, actor, command, receipt })).toBe(true);
    }

    expect(combatDamage).not.toBeNull();
    if (combatDamage === null || combatDamage.status !== "active" || combatDamage.damage === undefined) {
      throw new Error("Combat damage projection was not reached");
    }
    const damageView = started.playerIds
      .map(playerId => readProjection(started.room, playerId)) as [V2Projection, V2Projection];
    const inspectedRuntime = (started.room as unknown as { engineRuntime?: {
      host?: { objects: () => readonly unknown[] };
      match?: { flow?: { chain?: {
        layers: {
          setObjects: (objects: readonly unknown[]) => void;
          evaluateAll: () => readonly {
            ref: { readonly id: string };
            cardId: string | null;
            name: string;
            zone: string;
            keywords: readonly { readonly id: string; readonly value?: number }[];
            might: number | null;
            buffs: number;
            controller: string;
          }[];
          registry: { list: () => readonly {
            effect: {
              readonly id: string;
              readonly source?: { readonly id: string };
              readonly layer: string;
              readonly effect: Readonly<Record<string, unknown>>;
            };
          }[] };
        };
      } } };
    } }).engineRuntime;
    if (inspectedRuntime?.host && inspectedRuntime.match?.flow?.chain) {
      const chain = inspectedRuntime.match.flow.chain;
      chain.layers.setObjects(inspectedRuntime.host.objects());
      const evaluated = chain.layers.evaluateAll();
      const combatants = evaluated.filter(object => battlefieldUnits.some(unit => unit.id === object.ref.id));
      expect(combatants).toHaveLength(2);
      for (const combatant of combatants) {
        expect(combatant.might).toBe(2, "the selected Combatants have printed Might 2 and no combat role in raw state");
        expect(combatant.buffs).toBe(0);
        expect(Array.isArray(combatant.keywords)).toBe(true);
      }
      expect(chain.layers.registry.list().length).toBeGreaterThan(0);
    } else {
      throw new Error("The production room did not expose its authoritative layer engine for inspection");
    }
    expect(battlefieldUnits).toHaveLength(2);
    expect(combatDamage.attackerPlayerId).not.toBe(combatDamage.defenderPlayerId);
    expect(combatDamage.damage.attackerMight).toBeGreaterThanOrEqual(1);
    expect(combatDamage.damage.defenderMight).toBeGreaterThanOrEqual(1);
    expect(Number.isSafeInteger(combatDamage.damage.attackerMight)).toBe(true);
    expect(Number.isSafeInteger(combatDamage.damage.defenderMight)).toBe(true);
    const defenderTarget = battlefieldUnits.find(unit => {
      const object = damageView[0].objects.find(candidate => candidate.objectId === unit.id);
      return object !== undefined && (object.controllerPlayerId ?? object.ownerPlayerId) ===
        combatDamage.defenderPlayerId;
    });
    const attackerTarget = battlefieldUnits.find(unit => {
      const object = damageView[0].objects.find(candidate => candidate.objectId === unit.id);
      return object !== undefined && (object.controllerPlayerId ?? object.ownerPlayerId) ===
        combatDamage.attackerPlayerId;
    });
    expect(attackerTarget).toBeDefined();
    expect(defenderTarget).toBeDefined();
    const firstReceipt = submitThroughRoom(started, combatDamage.damage.expectedPlayerId, {
      type: "combat-damage", commandId: `${roomId}-damage-attacker`,
      stateVersion: damageView[0].stateVersion, combatId: combatDamage.combatId!,
      assignments: [{ unitObjectId: defenderTarget!.id, amount: combatDamage.damage.attackerMight }],
    });
    expect(firstReceipt.accepted, JSON.stringify(firstReceipt)).toBe(true);
    const defendingView = readProjection(started.room, combatDamage.defenderPlayerId!);
    const secondReceipt = submitThroughRoom(started, combatDamage.defenderPlayerId!, {
      type: "combat-damage", commandId: `${roomId}-damage-defender`,
      stateVersion: defendingView.stateVersion, combatId: combatDamage.combatId!,
      assignments: [{ unitObjectId: attackerTarget!.id, amount: combatDamage.damage.defenderMight }],
    });
    expect(secondReceipt.accepted, JSON.stringify(secondReceipt)).toBe(true);
    const afterDamage = readProjection(started.room, damageView[0].viewerPlayerId!).events;
    expect(afterDamage.some(event => event.timingPoint === "combat-damage-after")).toBe(true);
    expect(afterDamage.some(event => event.timingPoint === "combat-damage-before")).toBe(true);
  }, 120_000);
});
