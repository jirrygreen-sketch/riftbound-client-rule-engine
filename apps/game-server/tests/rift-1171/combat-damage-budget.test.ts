import { describe, expect, it } from "vitest";

import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type { V2Command, V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import {
  createEngineRuntime,
  type EngineRuntime,
  type EngineRuntimeDeck,
} from "../../src/engine-runtime/index.js";

// Core Rules v1.5 (published 2026-10-09, effective 2026-10-16):
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// 467.2.a-b sum current Might separately for the Attacking and Defending
// Units; 467.2.c assigns each side's total to the opposing Units. The room
// projection must expose those two authoritative totals without adding a
// printed or camp-wide substitute.

function card(id: string, name: string, types: readonly string[], extra: Record<string, unknown> = {}) {
  return { id, cardId: id, name, types, tags: [], ...extra };
}

function deck(seat: "A" | "B", might: number): EngineRuntimeDeck {
  return {
    mainDeck: Array.from({ length: 12 }, (_, index) => card(
      `${seat}:unit:${index}`, `${seat} Unit ${might}`, ["unit"],
      { cardId: `${seat}:unit-card`, energy: 0, power: null, might },
    )),
    runeDeck: Array.from({ length: 12 }, (_, index) => card(
      `${seat}:rune:${index}`, "Mind Rune", ["rune"],
      { cardId: `${seat}:rune-card`, tags: ["Basic"], energy: null, power: null, domains: ["Mind"] },
    )),
    championLegend: card(`${seat}:legend`, "Legend", ["legend"],
      { cardId: `${seat}:legend-card`, energy: null, power: null }),
    chosenChampion: card(`${seat}:champion`, "Champion", ["champion"],
      { cardId: `${seat}:champion-card`, energy: null, power: null }),
    battlefields: [0, 1, 2].map(index => card(
      `${seat}:field:${index}`, `Field ${index}`, ["battlefield"],
      { cardId: `${seat}:field-card:${index}`, energy: null, power: null },
    )) as unknown as EngineRuntimeDeck["battlefields"],
  };
}

function programs(): readonly CardProgram[] {
  return (["A", "B"] as const).flatMap(seat => [
    { canonicalCardId: `${seat}:unit-card`, rulesetVersion: "core-1.5" as const,
      status: "executable" as const, sourceText: "RIFT-1171 zero-cost Unit fixture",
      abilities: [{ kind: "play" as const,
        cost: { energy: { kind: "constant" as const, value: 0 } }, body: [] }] },
    { canonicalCardId: `${seat}:rune-card`, rulesetVersion: "core-1.5" as const,
      status: "no-ability" as const, sourceText: "resource fixture", abilities: [] },
    { canonicalCardId: `${seat}:legend-card`, rulesetVersion: "core-1.5" as const,
      status: "no-ability" as const, sourceText: "layout fixture", abilities: [] },
    { canonicalCardId: `${seat}:champion-card`, rulesetVersion: "core-1.5" as const,
      status: "no-ability" as const, sourceText: "layout fixture", abilities: [] },
    ...[0, 1, 2].map(index => ({ canonicalCardId: `${seat}:field-card:${index}`,
      rulesetVersion: "core-1.5" as const, status: "no-ability" as const,
      sourceText: "layout fixture", abilities: [] })),
  ]);
}

function setup(): EngineRuntime {
  const decks = [deck("A", 2), deck("B", 4)] as const;
  return createEngineRuntime({
    matchId: "RIFT-1171-room-damage-budget", roomId: "RIFT-1171-room-damage-budget",
    decks, seed: "RIFT-1171-room-damage-budget", firstPlayer: "A",
    battlefieldChoice: [0, 0], programs: programs(),
  }).start();
}

function submit(runtime: EngineRuntime, playerId: "A" | "B", command: V2Command) {
  return runtime.submit(playerId, command).receipt;
}

function ownHand(view: V2Projection, playerId: "A" | "B") {
  return view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === playerId)?.objects ?? [];
}

function pass(runtime: EngineRuntime, playerId: "A" | "B", commandId: string) {
  return submit(runtime, playerId, {
    type: "pass", commandId, stateVersion: runtime.projectFor(null).stateVersion,
  });
}

function settle(runtime: EngineRuntime, prefix: string): void {
  for (let index = 0; index < 20 && runtime.projectFor(null).chain.items.length > 0; index += 1) {
    const actor = runtime.projectFor(null).chain.priorityPlayerId;
    expect(actor, JSON.stringify(runtime.projectFor(null).chain)).not.toBeNull();
    const receipt = pass(runtime, actor as "A" | "B", `${prefix}:pass:${index}`);
    expect(receipt.status, JSON.stringify(receipt)).toBe("accepted");
  }
  expect(runtime.projectFor(null).chain.items).toEqual([]);
}

function playBaseUnit(runtime: EngineRuntime, playerId: "A" | "B", prefix: string): string {
  const view = runtime.projectFor(playerId);
  const card = ownHand(view, playerId).find(value => value.cardId === `${playerId}:unit-card`);
  expect(card, JSON.stringify(view.zones)).toBeDefined();
  const receipt = submit(runtime, playerId, {
    type: "play", commandId: `${prefix}:play`, stateVersion: view.stateVersion,
    cardObjectId: card!.objectId, destination: { kind: "base", playerId },
  });
  expect(receipt.status, JSON.stringify(receipt)).toBe("accepted");
  settle(runtime, prefix);
  return card!.objectId;
}

function endTurn(runtime: EngineRuntime, prefix: string): void {
  const view = runtime.projectFor(null);
  const receipt = submit(runtime, view.activePlayerId as "A" | "B", {
    type: "end-turn", commandId: prefix, stateVersion: view.stateVersion,
  });
  expect(receipt.status, JSON.stringify(receipt)).toBe("accepted");
}

function moveTo(runtime: EngineRuntime, playerId: "A" | "B", objectId: string,
  fieldId: string, commandId: string): void {
  const view = runtime.projectFor(playerId);
  expect(view.actionOptions.moves, JSON.stringify(view.actionOptions.moves)).toContainEqual({
    objectId, destination: { kind: "battlefield", battlefieldId: fieldId },
  });
  const receipt = submit(runtime, playerId, {
    type: "move", commandId, stateVersion: view.stateVersion, objectId,
    to: { zone: "battlefield", locationId: fieldId },
  });
  expect(receipt.status, JSON.stringify(receipt)).toBe("accepted");
}

describe("RIFT-1171 authoritative room combat damage budget", () => {
  it("projects 2 versus 4 from each side's participating current Might", () => {
    const runtime = setup();
    const aUnit = playBaseUnit(runtime, "A", "budget-a");
    endTurn(runtime, "budget-a-end");
    const bUnit = playBaseUnit(runtime, "B", "budget-b");
    endTurn(runtime, "budget-b-end");

    const aView = runtime.projectFor("A");
    const aMove = aView.actionOptions.moves.find(option => option.objectId === aUnit &&
      option.destination.kind === "battlefield");
    expect(aMove).toBeDefined();
    const fieldId = aMove!.destination.kind === "battlefield" ? aMove!.destination.battlefieldId : "";
    moveTo(runtime, "A", aUnit, fieldId, "budget-a-move");
    expect(pass(runtime, "A", "budget-a-showdown").status).toBe("accepted");
    expect(pass(runtime, "B", "budget-b-showdown").status).toBe("accepted");
    endTurn(runtime, "budget-a-after-showdown");

    moveTo(runtime, "B", bUnit, fieldId, "budget-b-move");
    expect(runtime.projectFor(null).combat).toMatchObject({
      status: "active", step: "showdown", battlefieldId: fieldId,
    });
    expect(pass(runtime, "B", "budget-b-focus").status).toBe("accepted");
    expect(pass(runtime, "A", "budget-a-focus").status).toBe("accepted");
    const responsible = runtime.projectFor(null).activePlayerId as "A" | "B";
    expect(runtime.projectFor(responsible).actionOptions.canAdvance).toBe(true);

    const advance = submit(runtime, responsible, {
      type: "advance", commandId: "budget-advance", stateVersion: runtime.projectFor(null).stateVersion,
    });
    expect(advance.status, JSON.stringify(advance)).toBe("accepted");
    const combat = runtime.projectFor(null).combat;
    expect(combat).toMatchObject({
      status: "active", step: "damage", combatId: expect.any(String),
      damage: { attackerMight: 4, defenderMight: 2, attackerSubmitted: false },
    });
    const field = runtime.projectFor(null).battlefields.find(value => value.battlefieldId === fieldId);
    expect(field?.occupantObjectIds.sort()).toEqual([aUnit, bUnit].sort());
    const objects = runtime.projectFor(null).objects;
    expect(objects.find(value => value.objectId === aUnit)).toMatchObject({ might: 2 });
    expect(objects.find(value => value.objectId === bUnit)).toMatchObject({ might: 4 });
    const damage = combat.status === "active" && combat.step === "damage" ? combat.damage : undefined;
    expect(damage).toBeDefined();
    if (combat.status !== "active" || combat.step !== "damage" || combat.combatId === undefined ||
        combat.attackerPlayerId === undefined || combat.defenderPlayerId === undefined || damage === undefined) {
      throw new Error("RIFT-1171 expected a stable Combat damage projection");
    }
    const attackerReceipt = submit(runtime, combat.attackerPlayerId, {
      type: "combat-damage", commandId: "budget-attacker-damage",
      stateVersion: runtime.projectFor(combat.attackerPlayerId).stateVersion,
      combatId: combat.combatId,
      assignments: [{ unitObjectId: aUnit, amount: damage.attackerMight }],
    });
    expect(attackerReceipt.status, JSON.stringify(attackerReceipt)).toBe("accepted");
    const waiting = runtime.projectFor(null).combat;
    expect(waiting).toMatchObject({ status: "active", step: "damage",
      damage: { attackerMight: 4, defenderMight: 2, attackerSubmitted: true } });
    const defenderReceipt = submit(runtime, combat.defenderPlayerId, {
      type: "combat-damage", commandId: "budget-defender-damage",
      stateVersion: runtime.projectFor(combat.defenderPlayerId).stateVersion,
      combatId: combat.combatId,
      assignments: [{ unitObjectId: bUnit, amount: damage.defenderMight }],
    });
    expect(defenderReceipt.status, JSON.stringify(defenderReceipt)).toBe("accepted");
    expect(runtime.projectFor(null).combat.status).toBe("none");
    expect(combat).toMatchObject({ damage: {
      attackerMight: objects.find(value => value.objectId === bUnit)?.might,
      defenderMight: objects.find(value => value.objectId === aUnit)?.might,
    } });
  }, 120_000);
});
