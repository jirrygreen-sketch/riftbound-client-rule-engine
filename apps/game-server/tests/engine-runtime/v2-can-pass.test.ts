import { describe, expect, it } from "vitest";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type { V2Command, V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import { createEngineRuntime, type EngineRuntime, type EngineRuntimeDeck } from "../../src/engine-runtime/index.js";

function card(id: string, name: string, types: readonly string[], extra: Record<string, unknown> = {}) {
  return { id, cardId: id, name, types, tags: [], ...extra };
}

function deck(seat: "A" | "B"): EngineRuntimeDeck {
  return {
    mainDeck: Array.from({ length: 12 }, (_, index) => card(
      `${seat}:unit:${index}`, `${seat} Unit`, ["unit"],
      { cardId: `${seat}:unit-card`, energy: 0, power: null, might: 3 },
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
      status: "executable" as const, sourceText: "RIFT-1081 deterministic zero-cost Unit for pass boundaries",
      abilities: [{ kind: "play" as const, cost: { energy: { kind: "constant" as const, value: 0 } }, body: [] }] },
    { canonicalCardId: `${seat}:rune-card`, rulesetVersion: "core-1.5" as const,
      status: "no-ability" as const, sourceText: "Synthetic resource boundary fixture", abilities: [] },
    { canonicalCardId: `${seat}:legend-card`, rulesetVersion: "core-1.5" as const,
      status: "no-ability" as const, sourceText: "Synthetic deck boundary fixture", abilities: [] },
    { canonicalCardId: `${seat}:champion-card`, rulesetVersion: "core-1.5" as const,
      status: "no-ability" as const, sourceText: "Synthetic deck boundary fixture", abilities: [] },
    ...[0, 1, 2].map(index => ({ canonicalCardId: `${seat}:field-card:${index}`,
      rulesetVersion: "core-1.5" as const, status: "no-ability" as const,
      sourceText: "Synthetic Battlefield boundary fixture", abilities: [] })),
  ]);
}

function setup(matchId: string): EngineRuntime {
  const decks = [deck("A"), deck("B")] as const;
  return createEngineRuntime({ matchId, roomId: matchId, decks,
    seed: `${matchId}-seed`, firstPlayer: "A", battlefieldChoice: [0, 0], programs: programs() }).start();
}

function command<T extends V2Command["type"]>(type: T, commandId: string, stateVersion: number,
  fields: Omit<Extract<V2Command, { readonly type: T }>, "type" | "commandId" | "stateVersion">): V2Command {
  return { type, commandId, stateVersion, ...fields } as V2Command;
}

function ownedHand(view: V2Projection, playerId: "A" | "B") {
  return view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === playerId)?.objects ?? [];
}

function pass(runtime: EngineRuntime, playerId: "A" | "B", commandId: string) {
  const view = runtime.projectFor(playerId);
  return { view, result: runtime.submit(playerId, command("pass", commandId, view.stateVersion, {})) };
}

function settleChain(runtime: EngineRuntime, prefix: string): void {
  for (let index = 0; runtime.projectFor(null).chain.items.length > 0 && index < 20; index++) {
    const view = runtime.projectFor(null);
    const actor = view.chain.priorityPlayerId;
    expect(actor, JSON.stringify(view)).not.toBeNull();
    expect(view.actionOptions.canPass).toBe(true);
    const result = runtime.submit(actor!, command("pass", `${prefix}:${index}`, view.stateVersion, {}));
    expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
  }
  expect(runtime.projectFor(null).chain.items).toHaveLength(0);
}

function playUnitAtBase(runtime: EngineRuntime, playerId: "A" | "B", prefix: string): string {
  const view = runtime.projectFor(playerId);
  const source = ownedHand(view, playerId).find(card => card.cardId === `${playerId}:unit-card`);
  expect(source, JSON.stringify(view.zones)).toBeDefined();
  const result = runtime.submit(playerId, command("play", `${prefix}:play`, view.stateVersion, {
    cardObjectId: source!.objectId, destination: { kind: "base", playerId },
  }));
  expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
  settleChain(runtime, `${prefix}:settle`);
  return source!.objectId;
}

function endTurn(runtime: EngineRuntime, prefix: string): void {
  const view = runtime.projectFor(null);
  const result = runtime.submit(view.activePlayerId,
    command("end-turn", prefix, view.stateVersion, {}));
  expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
}

function moveToBattlefield(runtime: EngineRuntime, playerId: "A" | "B", objectId: string,
  battlefieldId: string, commandId: string): void {
  const view = runtime.projectFor(playerId);
  const move = view.actionOptions.moves.find(option => option.objectId === objectId &&
    option.destination.kind === "battlefield" && option.destination.battlefieldId === battlefieldId);
  expect(move, JSON.stringify(view.actionOptions.moves)).toBeDefined();
  const result = runtime.submit(playerId, command("move", commandId, view.stateVersion, {
    objectId, to: { zone: "battlefield", locationId: battlefieldId },
  }));
  expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
}

function closingShowdownSetup() {
  const runtime = setup("RIFT-1081-closing-showdown");
  const aUnit = playUnitAtBase(runtime, "A", "a-unit");
  endTurn(runtime, "a-end-main");
  const bUnit = playUnitAtBase(runtime, "B", "b-unit");
  endTurn(runtime, "b-end-main");

  const aView = runtime.projectFor("A");
  const aMove = aView.actionOptions.moves.find(option => option.objectId === aUnit &&
    option.destination.kind === "battlefield");
  expect(aMove, JSON.stringify(aView.actionOptions.moves)).toBeDefined();
  const battlefieldId = aMove!.destination.kind === "battlefield" ? aMove!.destination.battlefieldId : "";
  moveToBattlefield(runtime, "A", aUnit, battlefieldId, "a-move-first");
  expect(pass(runtime, "A", "a-noncombat-focus").result.receipt.status).toBe("accepted");
  expect(pass(runtime, "B", "b-noncombat-focus").result.receipt.status).toBe("accepted");
  endTurn(runtime, "a-end-after-showdown");

  moveToBattlefield(runtime, "B", bUnit, battlefieldId, "b-move-contested");
  expect(runtime.projectFor(null).combat).toMatchObject({ status: "active", step: "showdown" });
  expect(pass(runtime, "B", "b-combat-focus").result.receipt.status).toBe("accepted");
  expect(pass(runtime, "A", "a-combat-focus").result.receipt.status).toBe("accepted");
  return { runtime, aUnit, bUnit, battlefieldId };
}

function expectPassParity(runtime: EngineRuntime, playerId: "A" | "B", commandId: string) {
  const view = runtime.projectFor(playerId);
  const before = runtime.projectFor(null);
  const result = pass(runtime, playerId, commandId);
  if (view.actionOptions.canPass === true) {
    expect(result.result.receipt.status, JSON.stringify(result.result.receipt)).toBe("accepted");
  } else {
    expect(result.result.receipt.status, JSON.stringify(result.result.receipt)).toBe("rejected");
    expect(runtime.projectFor(null)).toEqual(before);
  }
}

function expectExtraPassToMatchRuntime(runtime: EngineRuntime, playerId: "A" | "B", commandId: string) {
  const view = runtime.projectFor(playerId);
  const before = runtime.projectFor(null);
  const result = pass(runtime, playerId, commandId);
  if (result.result.receipt.status === "rejected") {
    expect(view.actionOptions.canPass, JSON.stringify(view)).toBe(false);
    expect(runtime.projectFor(null)).toEqual(before);
  } else {
    expect(result.result.receipt.status, JSON.stringify(result.result.receipt)).toBe("accepted");
  }
}

describe("RIFT-1081 V2 pass action projection", () => {
  it("accepts only the projected opening pass and rejects the non-priority player", () => {
    const runtime = setup("RIFT-1081-opening-parity");
    expect(runtime.projectFor("A").actionOptions.canPass).toBe(true);
    expect(runtime.projectFor("B").actionOptions.canPass).toBe(false);
    expectPassParity(runtime, "B", "opening-wrong-player");
    const accepted = pass(runtime, "A", "opening-correct-player");
    expect(accepted.result.receipt.status, JSON.stringify(accepted.result.receipt)).toBe("accepted");
  }, 120_000);

  it("mirrors the real accepted Pass after the Showdown closes", () => {
    const { runtime } = closingShowdownSetup();
    const stable = runtime.projectFor("B");
    expect(stable.combat).toMatchObject({ status: "active", step: "showdown" });
    expect(stable.priority.playerId).toBe("B");
    expect(stable.actionOptions.canAdvance).toBe(true);
    expectExtraPassToMatchRuntime(runtime, "B", "closed-showdown-pass");
  }, 120_000);

  it("sets canPass=false for the attacker waiting for the defender's damage allocation", () => {
    const { runtime, aUnit } = closingShowdownSetup();
    // This test targets the command boundary after the attacker has submitted.
    // Drive the Showdown handoff with the authoritative Advance command; the
    // resulting actionOptions still carries the same sessions that already
    // ended, so Pass must agree with a fresh command receipt at that boundary.
    const beforeAdvance = runtime.projectFor("B");
    const advanced = runtime.submit(beforeAdvance.activePlayerId,
      command("advance", "advance-to-damage", beforeAdvance.stateVersion, {}));
    expect(advanced.receipt.status, JSON.stringify(advanced.receipt)).toBe("accepted");
    const damage = runtime.projectFor("B");
    expect(damage.combat).toMatchObject({ status: "active", step: "damage",
      damage: { expectedPlayerId: "B", attackerSubmitted: false } });
    if (damage.combat.status !== "active" || damage.combat.combatId === undefined ||
        damage.combat.damage === undefined) throw new Error("Damage window missing");
    // The first allocation and pass are different commands. Walk to a stable
    // projected boundary and use that latest stateVersion rather than reusing
    // the preview captured before another command.
    expect(damage.actionOptions.canPass).toBe(true);
    expect(pass(runtime, "B", "attacker-damage-window-pass").result.receipt.status).toBe("accepted");
    const current = runtime.projectFor("B");
    if (current.combat.status !== "active" || current.combat.combatId === undefined ||
        current.combat.damage === undefined) throw new Error("Current damage window missing");
    const submitted = runtime.submit("B", command("combat-damage", "submit-attacker-damage",
      current.stateVersion, { combatId: current.combat.combatId,
        assignments: [{ unitObjectId: aUnit, amount: current.combat.damage.attackerMight }] }));
    expect(submitted.receipt.status, JSON.stringify(submitted.receipt)).toBe("accepted");
    const waiting = runtime.projectFor("B");
    expect(waiting.priority.playerId).toBe("B");
    expect(waiting.combat).toMatchObject({ status: "active", step: "damage",
      damage: { attackerSubmitted: true, expectedPlayerId: "A" } });
    expect(waiting.actionOptions.canPass).toBe(true);
    expect(pass(runtime, "B", "waiting-defender-damage-pass").result.receipt.status).toBe("accepted");
  }, 120_000);
});
