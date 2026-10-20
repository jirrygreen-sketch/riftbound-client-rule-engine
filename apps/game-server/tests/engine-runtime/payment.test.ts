import { describe, expect, it, vi } from "vitest";
import { ChainEngine } from "../../../../packages/engine-core/dist/chain/engine.js";
import { createActionPipelineHost } from "../../../../packages/engine-core/dist/events/action-adapter.js";
import type { FinalizedCostPlan, ObjectRef } from "../../../../packages/engine-core/dist/effects/contract.js";
import { createProgramBinding } from "../../../../packages/engine-core/dist/programs/index.js";
import vengeance from "../../../../packages/card-dsl/dist/cards/ogn/vengeance.js";
import singularity from "../../../../packages/card-dsl/dist/cards/ogn/singularity.js";
import singularitySource from "../../../../packages/card-dsl/src/cards/ogn/singularity.ts";
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
  it("uses the fresh Singularity dist IR with the official printed 6 plus 2 cost", () => {
    expect(singularity.canonicalCardId).toBe(singularitySource.canonicalCardId);
    expect(singularity.abilities[0]).toMatchObject({
      cost: singularitySource.abilities[0]!.cost,
      body: singularitySource.abilities[0]!.body,
    });
    expect(singularity.abilities[0]).toMatchObject({
      cost: {
        kind: "cost.printed",
        energy: { kind: "constant", value: 6 },
        power: { kind: "constant", value: 2 },
      },
    });
  });

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

  it("validates every explicit Power source against multi-requirement totals", () => {
    const state = host();
    givePower(state, ["Mind", "Order", "Order"]);
    const exact = pay(state, {
      finalized: true,
      power: ["Mind", "Order"],
      powerSources: [{ source: "Mind", amount: 1 }, { source: "Order", amount: 1 }],
    });
    expect(exact.status).toBe("done");
    expect(state.player("A").power).toEqual(["Order"]);
    const before = state.checkpoint();
    expect(pay(state, {
      finalized: true, power: ["Mind", "Order"],
      powerSources: [{ source: "Order", amount: 2 }],
    }).status).toBe("prevented");
    expect(state.checkpoint()).toEqual(before);
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

  it("commits Energy, XP, repeated Power, exhaustion and recycle as one exact plan", () => {
    const state = host();
    const gear = card(state, "A", "xp-gear", "board");
    const rune = card(state, "A", "xp-rune", "rune-zone");
    state.perform({ type: "gain-energy", player: "A", amount: 3 });
    state.perform({ type: "gain-xp", player: "A", amount: 2 });
    givePower(state, ["Order", "Order"]);
    expect(pay(state, {
      finalized: true, energy: 2, xp: 1, power: ["Order", "Order"],
      exhaust: [gear], recycle: [rune],
    }).status).toBe("done");
    expect(state.player("A")).toMatchObject({ energy: 1, xp: 1, power: [] });
    expect(state.object(gear)).toMatchObject({ exhausted: true, zone: "board" });
    expect(state.object(rune)).toBeNull();
    expect(state.zoneObjects("A", "deck")).toHaveLength(1);
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

  it("prevalidates a stale recycle ref without changing any earlier payment component", () => {
    const state = host();
    const gear = card(state, "A", "gear", "board");
    const rune = card(state, "A", "rune", "rune-zone");
    state.perform({ type: "gain-energy", player: "A", amount: 2 });
    givePower(state, ["Order"]);
    // Move the rune out after planning but before committing a stale recycle.
    const stale = { id: rune.id, zoneEntryId: rune.zoneEntryId };
    state.perform({ type: "move-zone", object: rune, to: "hand" });
    const before = state.checkpoint();
    const result = pay(state, { finalized: true, energy: 1, power: ["Order"], exhaust: [gear], recycle: [stale] });
    expect(result.status).toBe("prevented");
    // All validation happens before commit, so neither the mutation body nor
    // its post-commit catch path is claimed by this regression.
    expect(state.checkpoint()).toEqual(before);
    expect(state.player("A")).toMatchObject({ energy: 2, power: ["Order"] });
    expect(state.object(gear)).toMatchObject({ exhausted: false, zone: "board" });
  });

  it("restores every committed component when a later payment action throws", () => {
    const state = host();
    const gear = card(state, "A", "rollback-gear", "board");
    const rune = card(state, "A", "rollback-rune", "rune-zone");
    state.perform({ type: "gain-energy", player: "A", amount: 3 });
    state.perform({ type: "gain-xp", player: "A", amount: 2 });
    givePower(state, ["Order", "Order"]);
    const plan: FinalizedCostPlan = {
      finalized: true,
      energy: 2,
      xp: 1,
      power: ["Order", "Order"],
      exhaust: [gear],
      recycle: [rune],
    };
    const before = state.checkpoint();
    const target = state as unknown as {
      setExhausted(ref: ObjectRef, exhausted: boolean): void;
    };
    const fault = vi.spyOn(target, "setExhausted").mockImplementationOnce(() => {
      throw new Error("injected post-debit payment failure");
    });

    expect(pay(state, plan).status).toBe("prevented");
    expect(fault).toHaveBeenCalledTimes(1);
    expect(state.checkpoint()).toEqual(before);
    expect(state.player("A")).toMatchObject({ energy: 3, xp: 2, power: ["Order", "Order"] });
    expect(state.object(gear)).toMatchObject({ zone: "board", exhausted: false });
    expect(state.object(rune)).toMatchObject({ zone: "rune-zone" });
    expect(state.zoneObjects("A", "deck")).toHaveLength(0);

    fault.mockRestore();
    expect(pay(state, plan).status).toBe("done");
    expect(state.player("A")).toMatchObject({ energy: 1, xp: 1, power: [] });
    expect(state.object(gear)).toMatchObject({ zone: "board", exhausted: true });
    expect(state.object(rune)).toBeNull();
    expect(state.zoneObjects("A", "deck")).toHaveLength(1);
  });

  it("accepts the original Singularity 6 Energy plus 2 Mind cost and resolves both damages", () => {
    const state = host();
    const spell = state.addCard("A", { id: "singularity", cardId: singularity.canonicalCardId, types: ["spell"], energy: 6, power: ["Mind"], might: null }, "hand");
    const one = card(state, "B", "one", "board");
    const two = card(state, "B", "two", "board");
    for (const ref of [one, two]) state.perform({ type: "move-location", object: ref, to: { type: "battlefield", id: "bf" } });
    givePower(state, ["Mind", "Mind"]);
    state.perform({ type: "gain-energy", player: "A", amount: 7 });
    const pipeline = paymentHost(state);
    const binding = createProgramBinding({ cardPrograms: [singularity] });
    const chain = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", host: pipeline, cleanup: () => false, describePlay: binding.describePlay });
    chain.execute(binding.describePlay({ type: "play", object: spell, player: "A" }, state.object(spell)!));
    expect(state.player("A")).toMatchObject({ energy: 1, power: [] });
    expect(chain.items[0]).toMatchObject({
      costPlan: { total: {
        energy: 6,
        power: [{ amount: 2, allowedDomains: ["Mind"] }],
      } },
      payment: { paid: true, total: {
        energy: 6,
        power: [{ amount: 2, allowedDomains: ["Mind"] }],
      }, power: { power: [{ requirementIndex: 0, from: "Mind", amount: 2 }] } },
    });
    chain.pass("A"); chain.pass("B");
    expect(chain.items).toEqual([]);
    expect(state.objects().find(object => object.ref.id === "one")).toMatchObject({ zone: "board", damage: 6 });
    expect(state.objects().find(object => object.ref.id === "two")).toMatchObject({ zone: "board", damage: 6 });
  });

  it("rejects original Singularity with only one Mind and preserves host, chain and cursor state", () => {
    const state = host();
    const spell = state.addCard("A", { id: "singularity-short", cardId: singularity.canonicalCardId, types: ["spell"], energy: 6, power: ["Mind"], might: null }, "hand");
    const one = card(state, "B", "short-one", "board");
    const two = card(state, "B", "short-two", "board");
    for (const ref of [one, two]) state.perform({ type: "move-location", object: ref, to: { type: "battlefield", id: "bf" } });
    givePower(state, ["Mind"]);
    state.perform({ type: "gain-energy", player: "A", amount: 7 });
    const pipeline = paymentHost(state);
    const binding = createProgramBinding({ cardPrograms: [singularity] });
    const chain = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", host: pipeline, cleanup: () => false, describePlay: binding.describePlay });
    const beforeHost = state.checkpoint();
    const beforePipeline = chain.pipeline.checkpoint();
    const beforeTrace = chain.trace;
    const beforeState = { priority: chain.priority, focus: chain.focus, turnState: chain.turnState, items: chain.items };
    expect(() => chain.execute(binding.describePlay({ type: "play", object: spell, player: "A" }, state.object(spell)!)))
      .toThrow(/cannot-pay-cost|Cannot pay|insufficient|Insufficient/i);
    expect(state.checkpoint()).toEqual(beforeHost);
    const afterPipeline = chain.pipeline.checkpoint();
    expect(afterPipeline.log).toEqual(beforePipeline.log);
    expect(afterPipeline.triggers).toEqual(beforePipeline.triggers);
    expect(afterPipeline.replacements).toEqual(beforePipeline.replacements);
    expect(afterPipeline.consumed).toEqual(beforePipeline.consumed);
    expect(afterPipeline.sequence).toBe(beforePipeline.sequence);
    expect(afterPipeline.clock).toEqual(beforePipeline.clock);
    // restore() increments this private lifetime token so stale named-activation
    // handles cannot survive rollback; it is not a game cursor.
    expect(afterPipeline.namedActivationEpoch).toBeGreaterThan(beforePipeline.namedActivationEpoch);
    expect(chain.trace).toEqual(beforeTrace);
    expect({ priority: chain.priority, focus: chain.focus, turnState: chain.turnState, items: chain.items }).toEqual(beforeState);
    expect(state.player("A")).toMatchObject({ energy: 7, power: ["Mind"] });
    expect(state.object(spell)).toMatchObject({ zone: "hand" });
    expect(state.object(one)).toMatchObject({ zone: "board", damage: 0 });
    expect(state.object(two)).toMatchObject({ zone: "board", damage: 0 });
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

  it("does not double-spend Rune Power across duplicate commands and journal replay", () => {
    const mainDeck = Array.from({ length: 40 }, (_, index) => ({
      id: `runtime:main:${index}`, cardId: `card:runtime-main:${index}`, name: `Card ${index}`,
      types: ["unit"], energy: null, power: null,
    }));
    const runeDeck = Array.from({ length: 12 }, (_, index) => ({
      id: `runtime:rune:${index}`, cardId: `card:runtime-mind-rune:${index}`, name: "Mind Rune",
      types: ["rune"], tags: ["Basic"], domains: ["Mind"] as const, energy: null, power: null,
    }));
    const deck = (): EngineRuntimeDeck => ({
      mainDeck, runeDeck,
      championLegend: { id: "runtime:legend", cardId: "card:runtime-legend", types: ["legend"] },
      chosenChampion: { id: "runtime:champion", cardId: "card:runtime-champion", types: ["champion"] },
      battlefields: [
        { id: "runtime:field:1", cardId: "card:runtime-field:1", types: ["battlefield"] },
        { id: "runtime:field:2", cardId: "card:runtime-field:2", types: ["battlefield"] },
        { id: "runtime:field:3", cardId: "card:runtime-field:3", types: ["battlefield"] },
      ],
    });
    const options = { matchId: "runtime-power-journal", decks: [deck(), deck()] as const, seed: "runtime-power", firstPlayer: "A" as const };
    const runtime = createEngineRuntime(options).start();
    for (let index = 0; index < 4; index++) {
      const view = runtime.projectFor(null);
      expect(runtime.submit(view.activePlayerId, { type: "pass", commandId: `advance:${index}`, stateVersion: view.stateVersion }).receipt.status).toBe("accepted");
    }
    const view = runtime.projectFor("A");
    expect(view.phase).toBe("main");
    const runes = (view.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === "A")?.objects ?? [])
      .filter(rune => !rune.exhausted);
    expect(runes.length).toBeGreaterThanOrEqual(2);
    const command = (index: number) => ({
      type: "rune-power" as const, commandId: `rune-power:${index}`, stateVersion: view.stateVersion + index,
      runeObjectId: runes[index]!.objectId, zoneEntryId: runes[index]!.zoneEntryId!,
    });
    const first = runtime.submit("A", command(0));
    expect(first.receipt.status).toBe("accepted");
    const duplicate = runtime.submit("A", command(0));
    expect(duplicate.receipt).toMatchObject({ status: "duplicate", stateVersion: first.receipt.stateVersion });
    expect(duplicate.projection.players.find(player => player.playerId === "A")?.power).toEqual({ Mind: 1 });
    const secondInput = { ...command(1), stateVersion: first.receipt.stateVersion };
    const second = runtime.submit("A", secondInput);
    expect(second.receipt.status).toBe("accepted");
    expect(second.projection.players.find(player => player.playerId === "A")?.power).toEqual({ Mind: 2 });
    expect(runtime.submit("A", {
      type: "rune-power", commandId: "rune-power:0", stateVersion: view.stateVersion,
      runeObjectId: runes[1]!.objectId, zoneEntryId: runes[1]!.zoneEntryId!,
    }).receipt).toMatchObject({ status: "rejected", error: "commandId was already used for a different command" });
    const wrongActor = runtime.submit("B", {
      type: "rune-power", commandId: "wrong-actor", stateVersion: second.receipt.stateVersion,
      runeObjectId: runes[0]!.objectId, zoneEntryId: runes[0]!.zoneEntryId! + 1,
    });
    expect(wrongActor.receipt.status).toBe("rejected");
    expect(wrongActor.receipt.error).toMatch(/^Rune .+ is not in the Rune Zone$/);
    expect(runtime.submit("A", {
      type: "rune-power", commandId: "stale-state", stateVersion: view.stateVersion,
      runeObjectId: runes[1]!.objectId, zoneEntryId: runes[1]!.zoneEntryId! + 1,
    }).receipt.status).toBe("rejected");
    const restored = createEngineRuntime(options).restore(runtime.journal());
    expect(restored.projectFor("A")).toEqual(runtime.projectFor("A"));
    expect(restored.journal().head).toMatchObject({
      stateVersion: runtime.journal().head.stateVersion,
      eventSeq: runtime.journal().head.eventSeq,
      roomVersion: runtime.journal().head.roomVersion,
      stateDigest: runtime.journal().head.stateDigest,
      privateStateDigest: runtime.journal().head.privateStateDigest,
    });
    expect(restored.projectFor("A").players.find(player => player.playerId === "A")?.power).toEqual({ Mind: 2 });
  }, 120_000);
});
