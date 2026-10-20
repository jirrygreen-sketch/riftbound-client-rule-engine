import { describe, expect, it } from "vitest";
import { ChainEngine } from "../../../../../packages/engine-core/dist/chain/engine.js";
import { createActionPipelineHost } from "../../../../../packages/engine-core/dist/events/action-adapter.js";
import type { ObjectRef } from "../../../../../packages/engine-core/dist/effects/contract.js";
import { createProgramBinding } from "../../../../../packages/engine-core/dist/programs/index.js";
import consultThePast from "../../../../../packages/card-dsl/dist/cards/ogn/consult-the-past.js";
import riposte from "../../../../../packages/card-dsl/dist/cards/sfd/riposte.js";
import vengeance from "../../../../../packages/card-dsl/dist/cards/ogn/vengeance.js";
import { EngineRuntimeHost } from "../host.js";
import { projectRuntime } from "../projection.js";
import { createEngineRuntime, type EngineRuntimeDeck } from "../runtime.js";

function host() {
  return new EngineRuntimeHost({ A: "A", B: "B" }, request => {
    if (request.type === "select-objects") return request.options as never;
    if (request.type === "mode") return request.options[0] as never;
    throw new Error(`Unexpected choice ${request.id}`);
  });
}

function pipeline(state: EngineRuntimeHost) {
  return createActionPipelineHost({
    checkpoint: () => state.checkpoint(),
    restore: checkpoint => state.restore(checkpoint),
    objects: () => state.objects(),
    perform: action => state.perform(action),
    performContract: action => state.performContract(action),
    performWithDeathBoundary: (action, boundary) => state.performWithDeathBoundary(action, boundary),
    performKillBatchWithDeathBoundary: (actions, batchId, boundary) =>
      state.performKillBatchWithDeathBoundary(actions, batchId, boundary),
    choose: request => state.choose(request),
    context: (source, controller, timingPoint) => state.context(source, controller, timingPoint),
  });
}

function card(state: EngineRuntimeHost, player: string, id: string, zone: "hand" | "board" | "chain" | "trash" | "rune-zone", types: readonly string[], extra: Partial<Parameters<EngineRuntimeHost["addCard"]>[1]> = {}): ObjectRef {
  return state.addCard(player, {
    id, cardId: `card:${id}`, name: id, types, keywords: [],
    energy: null, power: null, might: types.includes("spell") ? null : 2,
    ...extra,
  }, zone);
}

function battlefield(state: EngineRuntimeHost, id = "field-A"): ObjectRef {
  return card(state, "A", id, "board", ["battlefield"], { might: null });
}

function runtimeDeck(prefix: string): EngineRuntimeDeck {
  return {
    mainDeck: Array.from({ length: 40 }, (_, index) => ({
      id: `${prefix}:main:${index}`, cardId: vengeance.canonicalCardId, name: "Vengeance",
      types: ["spell"], energy: 4, power: ["Order"], might: null,
    })),
    runeDeck: Array.from({ length: 12 }, (_, index) => ({
      id: `${prefix}:rune:${index}`, cardId: `rune-${index}`, name: `Rune ${index}`, types: ["rune"],
    })),
    championLegend: { id: `${prefix}:legend`, cardId: `${prefix}-legend`, types: ["legend"] },
    chosenChampion: { id: `${prefix}:champion`, cardId: `${prefix}-champion`, types: ["champion"] },
    battlefields: [
      { id: `${prefix}:field:1`, cardId: `${prefix}-field-1`, types: ["battlefield"] },
      { id: `${prefix}:field:2`, cardId: `${prefix}-field-2`, types: ["battlefield"] },
      { id: `${prefix}:field:3`, cardId: `${prefix}-field-3`, types: ["battlefield"] },
    ],
  };
}

describe("RIFT-837 production runtime primitives", () => {
  it("default production runtime rejects unbound wire picks before the original IR reaches Finalize", () => {
    const runtime = createEngineRuntime({
      matchId: "wire-picks", decks: [runtimeDeck("A"), runtimeDeck("B")], seed: 837,
      firstPlayer: "A", programs: [vengeance],
    }).start();
    const before = runtime.projectFor("A");
    const hand = before.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "A")!.objects!;
    const cardId = hand[0]!.cardId;
    const outcome = runtime.submit("A", {
      type: "play", commandId: "unbound-picks", stateVersion: before.stateVersion,
      cardObjectId: hand[0]!.objectId, picks: [{ kind: "player", playerId: "B" }],
    });
    expect(outcome.receipt).toMatchObject({
      status: "rejected", error: "Wire picks require the authoritative Finalize pick adapter",
      stateVersion: before.stateVersion,
    });
    expect(outcome.projection.stateVersion).toBe(before.stateVersion);
    expect(outcome.projection.eventSeq).toBe(before.eventSeq);
    expect(outcome.projection.players.map(player => [player.playerId, player.energy, player.handCount]))
      .toEqual(before.players.map(player => [player.playerId, player.energy, player.handCount]));
    expect(outcome.projection.chain).toEqual(before.chain);
    const copy = (objects: typeof outcome.projection.objects) => objects.filter(object => object.cardId === cardId)
      .map(({ objectId: _objectId, zoneEntryId: _zoneEntryId, ...object }) => object);
    expect(copy(outcome.projection.objects)).toEqual(copy(before.objects));
  }, 60_000);

  it("plays through original executable IR and fails closed for a judge-required program", () => {
    const state = host();
    const spell = card(state, "A", "vengeance", "hand", ["spell"], {
      cardId: vengeance.canonicalCardId,
    });
    const target = card(state, "B", "original-ir-target", "board", ["unit"]);
    state.perform({ type: "gain-energy", player: "A", amount: 5 });
    state.perform({ type: "gain-power", player: "A", power: ["Order", "Order"] });
    const binding = createProgramBinding({ cardPrograms: [vengeance] });
    const chain = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", host: pipeline(state), cleanup: () => false, describePlay: binding.describePlay });
    const draft = binding.describePlay({ type: "play", object: spell, player: "A" }, state.object(spell)!);
    const targetPlans = draft.body.flatMap(instruction => instruction.targets ?? []).map(requirement => ({
      requirement,
      options: { selected: [target] },
    }));
    chain.execute({ ...draft, targets: targetPlans });
    expect(chain.items[0]).toMatchObject({ kind: "spell", controller: "A", status: "finalized" });
    if (chain.priority === null) throw new Error("Chain priority unexpectedly absent");
    chain.pass(chain.priority);
    if (chain.priority === null) throw new Error("Chain priority unexpectedly absent");
    chain.pass(chain.priority);
    expect(chain.items).toHaveLength(0);
    expect(state.objects().find(object => object.ref.id === spell.id)).toMatchObject({ zone: "trash" });
    expect(state.objects().find(object => object.ref.id === target.id)).toMatchObject({ zone: "trash" });

    const blocked = { ...consultThePast, status: "judge-required" as const, judgeReason: "not ruled" };
    expect(() => createProgramBinding({ cardPrograms: [blocked] }).registry.get(blocked.canonicalCardId)).toThrow(/not ruled/);
  });

  it("uses the real host for Play payment, Chain entry, atomic failure, and Counter to owner Trash", () => {
    const state = host();
    const spell = card(state, "A", "vengeance", "hand", ["spell"], { cardId: vengeance.canonicalCardId });
    const enemy = card(state, "B", "enemy", "board", ["unit"]);
    state.perform({ type: "gain-energy", player: "A", amount: 6 });
    state.perform({ type: "gain-power", player: "A", power: ["Order", "Order"] });
    const before = state.checkpoint();
    expect(state.perform({ type: "play", object: spell, player: "A", cost: { finalized: true, energy: 7, power: ["Order"] } }).status).toBe("prevented");
    expect(state.checkpoint()).toEqual(before);

    const played = state.perform({ type: "play", object: spell, player: "A", cost: { finalized: true, energy: 4, power: ["Order", "Order"] } });
    expect(played.status).toBe("done");
    expect(state.player("A")).toMatchObject({ energy: 2, power: [] });
    const onChain = state.objects().find(object => object.ref.id === spell.id)!;
    expect(onChain.zone).toBe("chain");
    expect(state.object(spell)).toBeNull();
    expect(state.perform({ type: "counter", object: onChain.ref }).status).toBe("done");
    expect(state.objects().find(object => object.ref.id === spell.id)).toMatchObject({ zone: "trash", owner: "A" });
    expect(state.player("A")).toMatchObject({ energy: 2, power: [] });
    expect(state.perform({ type: "counter", object: onChain.ref }).status).toBe("impossible");
    expect(enemy.zoneEntryId).toBe(1);
  });

  it("executes the original Riposte counter IR and retains the failed-payment rollback boundary", () => {
    const state = host();
    const field = battlefield(state);
    state.perform({ type: "move-location", object: field, to: { type: "battlefield", id: field.id } });
    state.configureFacedownZone(field.id, "A", 1);
    const targetSpell = card(state, "B", "target-spell", "chain", ["spell"], { energy: 3 });
    const unit = card(state, "A", "friendly-unit", "board", ["unit"]);
    const riposteCard = card(state, "A", "riposte", "hand", ["spell"], {
      cardId: riposte.canonicalCardId, keywords: [{ id: "Reaction" }], energy: 2, power: ["Body"],
    });
    state.perform({ type: "gain-energy", player: "A", amount: 2 });
    state.perform({ type: "gain-power", player: "A", power: ["Body", "Order"] });
    const binding = createProgramBinding({ cardPrograms: [riposte as never] });
    const chain = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", host: pipeline(state), cleanup: () => false, describePlay: binding.describePlay });
    const draft = binding.describePlay({ type: "play", object: riposteCard, player: "A" }, state.object(riposteCard)!);
    const actual = draft.targets ?? draft.body.flatMap(instruction => instruction.targets ?? []).map(requirement => ({
      requirement,
      options: undefined,
    }));
    const targetPlans = actual.map(target => ({
      ...target,
      options: { selected: [target.requirement.id === "target-spell" ? targetSpell : unit] },
    }));
    expect(targetPlans).toHaveLength(2);
    expect(() => chain.execute({ ...draft, targets: targetPlans })).toThrow();
    expect(state.object(targetSpell)?.zone).toBe("chain");
    expect(state.objects().find(object => object.ref.id === riposteCard.id)).toMatchObject({ zone: "hand" });
    expect(state.objects().find(object => object.ref.id === unit.id)).toMatchObject({ zone: "board" });
  });

  it("counter-resolution from original Riposte IR moves the target spell to its owner Trash without refund", () => {
    const state = host();
    const field = battlefield(state);
    state.perform({ type: "move-location", object: field, to: { type: "battlefield", id: field.id } });
    const targetSpell = card(state, "B", "riposte-target", "hand", ["spell"], {
      cardId: vengeance.canonicalCardId, energy: 4, power: null,
    });
    const targetUnit = card(state, "A", "vengeance-target", "board", ["unit"]);
    state.perform({ type: "gain-energy", player: "B", amount: 4 });
    state.perform({ type: "gain-power", player: "B", power: ["Order", "Order"] });
    const unit = card(state, "A", "riposte-unit", "board", ["unit"]);
    state.perform({ type: "gain-energy", player: "A", amount: 4 });
    state.perform({ type: "gain-power", player: "A", power: ["Body", "Order"] });
    const binding = createProgramBinding({ cardPrograms: [vengeance, riposte as never] });
    const chain = new ChainEngine({ turnOrder: ["B", "A"], turnPlayer: "B", host: pipeline(state), cleanup: () => false, describePlay: binding.describePlay });
    const targetDraft = binding.describePlay({ type: "play", object: targetSpell, player: "B" }, state.object(targetSpell)!);
    const targetPlans = (targetDraft.targets ?? targetDraft.body.flatMap(instruction => (instruction.targets ?? []).map(requirement => ({ requirement, options: undefined })))).map(target => ({
      ...target,
      options: { ...(target.options ?? {}), selected: [targetUnit] },
    }));
    chain.execute({ ...targetDraft, targets: targetPlans });
    chain.pass(chain.priority!);
    const targetOnChain = state.objects().find(object => object.ref.id === targetSpell.id)!.ref;
    const counterSpell = card(state, "A", "riposte-counter", "hand", ["spell"], {
      cardId: riposte.canonicalCardId, keywords: [{ id: "Reaction" }], energy: 2, power: ["Body", "Order"],
    });
    const initial = binding.describePlay({ type: "play", object: counterSpell, player: "A" }, state.object(counterSpell)!);
    expect(initial.speed).toBe("reaction");
    const targets = (initial.targets ?? initial.body.flatMap(instruction => (instruction.targets ?? []).map(requirement => ({ requirement, options: undefined })))).map(target => ({
      ...target,
      options: { ...(target.options ?? {}), selected: [target.requirement.id === "target-spell" ? targetOnChain : unit] },
    }));
    const finalized = { ...initial, targets };
    const targetPlan = finalized.targets.find((target: typeof targets[number]) => target.requirement.id === "target-spell")!;
    expect(targetPlan.options?.selected).toEqual([targetOnChain]);
    chain.execute({ ...initial, targets });
    if (chain.priority === null) throw new Error("Counter spell did not receive priority");
    while (chain.items.length > 0) {
      if (chain.priority === null) throw new Error("Counter chain has no priority holder");
      chain.pass(chain.priority);
    }
    expect(state.objects().find(object => object.ref.id === targetSpell.id)).toMatchObject({ zone: "trash", owner: "B" });
    expect(state.objects().find(object => object.ref.id === targetSpell.id)!.ref.zoneEntryId).toBeGreaterThan(targetOnChain.zoneEntryId);
    expect(state.player("A")).toMatchObject({ energy: 2, power: [] });
    expect(state.objects().find(object => object.ref.id === counterSpell.id)).toMatchObject({ zone: "trash" });
  });

  it("keeps Hidden identity private while enabling only the authoritative Hide action", () => {
    const state = host();
    const field = battlefield(state);
    state.configureFacedownZone(field.id, "A", 1);
    const hiddenCard = card(state, "A", "consult-hidden", "hand", ["spell"], {
      keywords: [{ id: "Hidden" }], cardId: consultThePast.canonicalCardId,
    });
    const hidden = state.performContract({ type: "hide", object: hiddenCard, player: "A", location: { type: "battlefield", id: field.id } });
    expect(hidden.status).toBe("done");
    const current = state.objects().find(object => object.ref.id === hiddenCard.id)!;
    expect(current).toMatchObject({ faceDown: true, facedownLocation: { type: "battlefield", id: field.id } });
    const controllerView = projectRuntime({ flow: {
      chain: { items: [], priority: null, focus: null },
      battlefields: [{ id: field.id, controller: "A", contestedBy: null, staged: "none", cardId: null }],
      victoryScore: 8, scored: () => [], turn: 1, turnPlayer: "A", phase: "main", winner: null,
    } as never, events: () => [], result: () => ({ winner: null, turnNumber: 1 }) } as never, state, "m", "A", 0, null);
    expect(controllerView.objects.find(object => object.zone === "facedown")?.cardId).toBeUndefined();
    const fakeFlow = {
      chain: { items: [], priority: null, focus: null },
      battlefields: [{ id: field.id, controller: null, contestedBy: null, staged: "none", cardId: null }],
      victoryScore: 8, scored: () => [], turn: 1, turnPlayer: "A", phase: "main", winner: null,
    } as never;
    const view = projectRuntime({ flow: fakeFlow, events: () => [], result: () => ({ winner: null, turnNumber: 1 }) } as never, state, "m", "B", 0, null);
    expect(view.objects.find(object => object.zone === "facedown")).toMatchObject({ faceDown: true });
    expect(view.objects.find(object => object.zone === "facedown")?.cardId).toBeUndefined();
    expect(view.objects.find(object => object.zone === "facedown")?.name).toBeUndefined();
    expect(state.performContract({ type: "hide", object: hiddenCard, player: "A", location: { type: "battlefield", id: field.id } }).status).toBe("impossible");
  });

  it("executes a standalone Recall without a Move event and rejects stale or foreign actions", () => {
    const state = host();
    const unit = card(state, "A", "recall-unit", "board", ["unit"]);
    state.perform({ type: "move-location", object: unit, to: { type: "battlefield", id: "field-A" } });
    const outcome = state.performContract({ type: "recall", object: unit, player: "A" });
    expect(outcome.status).toBe("done");
    expect(outcome.receipt?.actions).toEqual([{ type: "recall", status: "done" }]);
    expect((outcome.events[0] as unknown as { action: string }).action).toBe("recall");
    expect(state.object(unit)?.location).toEqual({ type: "base", player: "A" });
    expect(state.object(unit)).toMatchObject({ owner: "A", controller: "A", damage: 0, exhausted: false });
    expect(state.performContract({ type: "recall", object: unit, player: "B" }).status).toBe("impossible");
  });

  it("pays all nonstandard components atomically and retries a failed committed payment", () => {
    const state = host();
    const gear = card(state, "A", "cost-gear", "board", ["gear"]);
    const rune = card(state, "A", "cost-rune", "rune-zone", ["rune"]);
    state.perform({ type: "gain-energy", player: "A", amount: 2 });
    state.perform({ type: "gain-xp", player: "A", amount: 2 });
    state.perform({ type: "gain-power", player: "A", power: ["Order"] });
    const before = state.checkpoint();
    expect(state.perform({ type: "pay", player: "A", plan: {
      finalized: true, energy: 1, xp: 1, power: ["Order"], exhaust: [gear], recycle: [rune],
      powerSources: [{ source: "Order", amount: 1 }],
    } }).status).toBe("done");
    expect(state.player("A")).toMatchObject({ energy: 1, xp: 1, power: [] });
    expect(state.object(gear)).toMatchObject({ exhausted: true });
    expect(state.object(rune)).toBeNull();
    const after = state.checkpoint();
    expect(state.perform({ type: "pay", player: "A", plan: { finalized: true, power: ["Mind"] } }).status).toBe("prevented");
    expect(state.checkpoint()).toEqual(after);
    state.restore(before);
    expect(state.player("A")).toMatchObject({ energy: 2, xp: 2, power: ["Order"] });
    expect(state.object(gear)).toMatchObject({ exhausted: false });
  });

  it("requires Hidden reaction to unlock on the next turn and detaches the Facedown lifecycle when played", () => {
    const state = host();
    const field = battlefield(state);
    state.configureFacedownZone(field.id, "A", 1);
    state.advanceTurn(2);
    const hidden = card(state, "A", "late-hidden", "hand", ["spell"], {
      keywords: [{ id: "Hidden" }, { id: "Reaction" }], cardId: consultThePast.canonicalCardId,
    });
    expect(state.performContract({ type: "hide", object: hidden, player: "A", location: { type: "battlefield", id: field.id } }).status).toBe("done");
    const hiddenRef = state.objects().find(object => object.ref.id === hidden.id)!.ref;
    const sameTurn = state.checkpoint();
    expect(state.perform({ type: "play", object: hiddenRef, player: "A" }).status).toBe("impossible");
    expect(state.checkpoint()).toEqual(sameTurn);
    state.advanceTurn(3);
    expect(state.perform({ type: "play", object: hiddenRef, player: "A", cost: { finalized: true } }).status).toBe("done");
    expect(state.hiddenObjects()).toHaveLength(0);
    expect(state.objects().find(object => object.ref.id === hidden.id)).toMatchObject({
      zone: "chain", faceDown: false, facedownLocation: null,
    });
  });
});
