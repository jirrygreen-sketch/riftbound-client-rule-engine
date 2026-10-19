import { describe, expect, it } from "vitest";
import { ChainEngine } from "../../../../packages/engine-core/dist/chain/engine.js";
import { createActionPipelineHost } from "../../../../packages/engine-core/dist/events/action-adapter.js";
import type { FinalizedCostPlan, GameAction, ObjectRef } from "../../../../packages/engine-core/dist/effects/contract.js";
import { createProgramBinding } from "../../../../packages/engine-core/dist/programs/index.js";
import vengeance from "../../../../packages/card-dsl/dist/cards/ogn/vengeance.js";
import singularity from "../../../../packages/card-dsl/dist/cards/ogn/singularity.js";
import { EngineRuntimeHost, type RuntimeCard } from "../../src/engine-runtime/host.js";
import { createEngineRuntime, type EngineRuntimeDeck } from "../../src/engine-runtime/runtime.js";

function host() {
  const state = new EngineRuntimeHost({ A: "A", B: "B" }, request => {
    if (request.type === "select-objects") return request.options as never;
    throw new Error(`unexpected choice ${request.id}`);
  });
  return state;
}

function pay(state: EngineRuntimeHost, plan: FinalizedCostPlan, player = "A") {
  return state.perform({ type: "pay", player, plan });
}

function givePower(state: EngineRuntimeHost, power: readonly ("Fury" | "Calm" | "Mind" | "Body" | "Chaos" | "Order")[], player = "A") {
  return state.perform({ type: "gain-power", player, power });
}

function card(state: EngineRuntimeHost, player: string, id: string, zone: "hand" | "board" | "rune-zone", domains?: RuntimeCard["domains"]): ObjectRef {
  return state.addCard(player, {
    id, cardId: `card:${id}`, name: id, types: [zone === "rune-zone" ? "rune" : "unit"],
    energy: null, power: null, ...(domains === undefined ? {} : { domains }),
  }, zone);
}

function paymentHost(state: EngineRuntimeHost) {
  return createActionPipelineHost({
    checkpoint: () => state.checkpoint(), restore: value => state.restore(value), objects: () => state.objects(),
    perform: action => state.perform(action), choose: request => state.choose(request),
    performWithDeathBoundary: (action, boundary) => state.performWithDeathBoundary(action, boundary),
    performKillBatchWithDeathBoundary: (actions, batchId, boundary) => state.performKillBatchWithDeathBoundary(actions, batchId, boundary),
    context: (source, controller, timingPoint) => state.context(source, controller, timingPoint),
  });
}

describe("EngineRuntimeHost Power payment", () => {
  it("uses the real host through the original Vengeance program and consumes exact repeated Order Power", () => {
    const state = host();
    const spell = state.addCard("A", { id: "vengeance", cardId: vengeance.canonicalCardId, types: ["spell"], energy: 4, power: ["Order"], might: null }, "hand");
    const target = card(state, "B", "target", "board");
    state.perform({ type: "move-location", object: target, to: { type: "battlefield", id: "bf" } });
    givePower(state, ["Order", "Order"]);
    state.perform({ type: "gain-energy", player: "A", amount: 6 });
    const pipeline = paymentHost(state);
    const binding = createProgramBinding({ cardPrograms: [vengeance] });
    const chain = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", host: pipeline, cleanup: () => false, describePlay: binding.describePlay });
    chain.execute(binding.describePlay({ type: "play", object: spell, player: "A" }, state.object(spell)!));
    expect(state.player("A").energy).toBe(2);
    expect(state.player("A").power).toEqual([]);
    expect(chain.items[0]!.payment).toMatchObject({ paid: true, power: { power: [{ requirementIndex: 0, from: "Order", amount: 2 }] } });
    chain.pass("A"); chain.pass("B");
    expect(state.objects().find(object => object.ref.id === "target")?.zone).toBe("trash");
    expect(chain.items).toEqual([]);
  });

  it("debits energy and exact repeated Power in direct host.perform", () => {
    const state = host();
    state.perform({ type: "gain-energy", player: "A", amount: 6 });
    givePower(state, ["Order", "Order", "Mind"]);
    expect(pay(state, { finalized: true, energy: 4, power: ["Order", "Order"] }).status).toBe("done");
    expect(state.player("A")).toMatchObject({ energy: 2, power: ["Mind"] });
  });

  it("rejects insufficient resources and illegal domains atomically", () => {
    const state = host();
    state.perform({ type: "gain-energy", player: "A", amount: 3 });
    givePower(state, ["Order"]);
    expect(pay(state, { finalized: true, energy: 4, power: ["Order"] }).status).toBe("prevented");
    expect(state.player("A")).toMatchObject({ energy: 3, power: ["Order"] });
    expect(pay(state, { finalized: true, energy: 0, power: ["Mind"] }).status).toBe("prevented");
    expect(state.player("A")).toMatchObject({ energy: 3, power: ["Order"] });
  });

  it("rejects malformed counts and Universal Power without any partial debit", () => {
    const state = host();
    state.perform({ type: "gain-energy", player: "A", amount: 5 });
    givePower(state, ["Order"]);
    expect(pay(state, { finalized: true, energy: Number.NaN }).status).toBe("prevented");
    expect(pay(state, { finalized: true, power: ["Fury", "Fury", "Fury"] }).status).toBe("prevented");
    expect(pay(state, { finalized: true, universalPower: 1 }).status).toBe("prevented");
    expect(state.player("A")).toMatchObject({ energy: 5, power: ["Order"] });
  });

  it("requires exhaust/recycle refs to be current and distinct and commits them with resources atomically", () => {
    const state = host();
    const gear = card(state, "A", "gear", "board");
    const rune = card(state, "A", "rune", "rune-zone");
    state.perform({ type: "gain-energy", player: "A", amount: 1 });
    givePower(state, ["Order"]);
    const first = pay(state, { finalized: true, energy: 1, power: ["Order"], exhaust: [gear], recycle: [rune] });
    expect(first.status).toBe("done");
    expect(state.object(gear)).toMatchObject({ exhausted: true });
    expect(state.object(rune)).toBeNull();
    expect(state.zoneObjects("A", "deck")).toHaveLength(1);
    expect(state.player("A")).toMatchObject({ energy: 0, power: [] });
    expect(state.perform({ type: "move-zone", object: gear, to: "hand" }).status).toBe("done");
    const oldGear = { id: gear.id, zoneEntryId: gear.zoneEntryId };
    expect(pay(state, { finalized: true, exhaust: [oldGear] }).status).toBe("prevented");
    const currentGear = { id: gear.id, zoneEntryId: gear.zoneEntryId + 1 };
    expect(state.perform({ type: "move-zone", object: currentGear, to: "board" }).status).toBe("done");
    const latestGear = state.object({ id: gear.id, zoneEntryId: 3 });
    expect(latestGear).not.toBeNull();
    expect(pay(state, { finalized: true, exhaust: [latestGear!.ref, latestGear!.ref] }).status).toBe("prevented");
  });

  it("rolls back resources, exhaustion and recycling when a late payment action fails", () => {
    const state = host();
    const gear = card(state, "A", "gear", "board");
    const rune = card(state, "A", "rune", "rune-zone");
    state.perform({ type: "gain-energy", player: "A", amount: 2 });
    givePower(state, ["Order"]);
    // Move the rune out after planning but before committing a stale recycle.
    const stale = { id: rune.id, zoneEntryId: rune.zoneEntryId };
    state.perform({ type: "move-zone", object: rune, to: "hand" });
    const result = pay(state, { finalized: true, energy: 1, power: ["Order"], exhaust: [gear], recycle: [stale] });
    expect(result.status).toBe("prevented");
    expect(state.player("A")).toMatchObject({ energy: 2, power: ["Order"] });
    expect(state.object(gear)).toMatchObject({ exhausted: false, zone: "board" });
  });

  it("accepts exact Mind Power for Singularity through the default Chain public path", () => {
    const state = host();
    const spell = state.addCard("A", { id: "singularity", cardId: singularity.canonicalCardId, types: ["spell"], energy: 6, power: ["Mind"], might: null }, "hand");
    const one = card(state, "B", "one", "board");
    const two = card(state, "B", "two", "board");
    for (const ref of [one, two]) state.perform({ type: "move-location", object: ref, to: { type: "battlefield", id: "bf" } });
    givePower(state, ["Mind"]);
    state.perform({ type: "gain-energy", player: "A", amount: 7 });
    const pipeline = paymentHost(state);
    const binding = createProgramBinding({ cardPrograms: [singularity] });
    const chain = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", host: pipeline, cleanup: () => false, describePlay: binding.describePlay });
    chain.execute(binding.describePlay({ type: "play", object: spell, player: "A" }, state.object(spell)!));
    expect(state.player("A")).toMatchObject({ energy: 1, power: [] });
    chain.pass("A"); chain.pass("B");
    expect(chain.items).toEqual([]);
  });

  it("keeps checkpoint/restore exact for the Power pool", () => {
    const state = host();
    state.perform({ type: "gain-energy", player: "A", amount: 6 });
    givePower(state, ["Order", "Order"]);
    const before = state.checkpoint();
    pay(state, { finalized: true, energy: 4, power: ["Order", "Order"] });
    state.restore(before);
    expect(state.player("A")).toMatchObject({ energy: 6, power: ["Order", "Order"] });
  });
});
