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

function card(state: EngineRuntimeHost, player: string, id: string, zone: "hand" | "board" | "chain" | "trash", types: readonly string[], extra: Partial<Parameters<EngineRuntimeHost["addCard"]>[1]> = {}): ObjectRef {
  return state.addCard(player, {
    id, cardId: `card:${id}`, name: id, types, keywords: [],
    energy: null, power: null, might: types.includes("spell") ? null : 2,
    ...extra,
  }, zone);
}

function battlefield(state: EngineRuntimeHost, id = "field-A"): ObjectRef {
  return card(state, "A", id, "board", ["battlefield"], { might: null });
}

describe("RIFT-837 production runtime primitives", () => {
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
      cardId: riposte.canonicalCardId, keywords: [{ id: "Reaction" }], energy: 2, power: ["Body", "Order"],
    });
    state.perform({ type: "gain-energy", player: "A", amount: 2 });
    state.perform({ type: "gain-power", player: "A", power: ["Body"] });
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
    expect(state.performContract({ type: "recall", object: unit, player: "B" }).status).toBe("impossible");
  });
});
