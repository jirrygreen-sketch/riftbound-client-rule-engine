import { describe, expect, it } from "vitest";
import { ChainEngine } from "../../../../packages/engine-core/dist/chain/engine.js";
import { createActionPipelineHost, killBatch } from "../../../../packages/engine-core/dist/events/action-adapter.js";
import type { ObjectRef, ObjectSnapshot } from "../../../../packages/engine-core/dist/effects/contract.js";
import { createProgramBinding } from "../../../../packages/engine-core/dist/programs/index.js";
import unsungHero from "../../../../packages/card-dsl/dist/cards/sfd/unsung-hero.js";
import { createEngineRuntime } from "../../src/engine-runtime/runtime.js";
import { EngineRuntimeHost, type RuntimeCard } from "../../src/engine-runtime/host.js";

function productionHost() {
  let choose: <T>(request: Parameters<EngineRuntimeHost["choose"]>[0] & { readonly options?: readonly T[] }) => T = () => {
    throw new Error("unexpected choice");
  };
  const state = new EngineRuntimeHost({ A: "A", B: "B" }, request => choose(request as never));
  const pipeline = createActionPipelineHost({
    checkpoint: () => state.checkpoint(),
    restore: checkpoint => state.restore(checkpoint),
    objects: () => state.objects(),
    perform: action => state.perform(action),
    performWithDeathBoundary: (action, boundary) => state.performWithDeathBoundary(action, boundary),
    performKillBatchWithDeathBoundary: (actions, batchId, boundary) =>
      state.performKillBatchWithDeathBoundary(actions, batchId, boundary),
    choose: request => state.choose(request),
    context: (source, controller, timingPoint) => state.context(source, controller, timingPoint),
  });
  const chain = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", host: pipeline, cleanup: () => false });
  return { state, pipeline, chain, setChoose: (next: typeof choose) => { choose = next; } };
}

function unit(state: EngineRuntimeHost, id: string, domains: readonly ("Fury" | "Mind")[] = ["Fury"]): ObjectRef {
  return state.addCard("A", {
    id,
    cardId: `card:${id}`,
    name: id,
    types: ["unit"],
    domains,
    energy: null,
    power: null,
  }, "board");
}

function runtimeDeck(prefix: string): {
  readonly mainDeck: readonly RuntimeCard[];
  readonly runeDeck: readonly RuntimeCard[];
  readonly championLegend: RuntimeCard;
  readonly chosenChampion: RuntimeCard;
  readonly battlefields: readonly [RuntimeCard, RuntimeCard, RuntimeCard];
} {
  return {
    mainDeck: Array.from({ length: 40 }, (_, index) => ({ id: `${prefix}:main:${index}`, cardId: `main-${index}`, types: ["unit"] })),
    runeDeck: Array.from({ length: 12 }, (_, index) => ({ id: `${prefix}:rune:${index}`, cardId: `rune-${index}`, types: ["rune"] })),
    championLegend: { id: `${prefix}:legend`, cardId: `${prefix}-legend`, types: ["legend"] },
    chosenChampion: { id: `${prefix}:champion`, cardId: `${prefix}-champion`, types: ["champion"] },
    battlefields: [
      { id: `${prefix}:field:1`, cardId: `${prefix}-field-1`, types: ["battlefield"] },
      { id: `${prefix}:field:2`, cardId: `${prefix}-field-2`, types: ["battlefield"] },
      { id: `${prefix}:field:3`, cardId: `${prefix}-field-3`, types: ["battlefield"] },
    ],
  };
}

function killTrigger(source: ObjectSnapshot, id: string, once?: "per-game") {
  return {
    id,
    source,
    controller: source.controller,
    spec: {
      at: "object-killed" as const,
      filter: { event: "object-killed" as const, object: { objectId: source.ref.id } },
      ...(once === undefined ? {} : { once }),
    },
    body: [],
  };
}

function observeBoundary(pipeline: ReturnType<typeof productionHost>["pipeline"]) {
  const observed: ObjectSnapshot[][] = [];
  const boundary = pipeline.deathBoundary!;
  return {
    observed,
    boundary: {
      ...boundary,
      execute: (action: Parameters<typeof boundary.execute>[0], callback: Parameters<typeof boundary.execute>[1]) =>
        boundary.execute(action, context => {
          observed.push([...context.before]);
          callback(context);
        }),
      executeContract: (action: Parameters<typeof boundary.executeContract>[0], callback: Parameters<typeof boundary.executeContract>[1]) =>
        boundary.executeContract(action, context => {
          observed.push([...context.before]);
          callback(context);
        }),
    },
  };
}

describe("real EngineRuntimeHost death boundary", () => {
  it("rejects unsupported commands through the real createEngineRuntime factory", () => {
    const deckA = runtimeDeck("A");
    const deckB = runtimeDeck("B");
    const runtime = createEngineRuntime({
      matchId: "factory-death-boundary",
      decks: [
        { ...deckA, championLegend: { ...deckA.championLegend, domains: ["Fury"] } },
        { ...deckB, championLegend: { ...deckB.championLegend, domains: ["Fury"] } },
      ],
      seed: "factory",
    }).start();
    const actor = runtime.projectFor(null).activePlayerId;
    const attack = runtime.submit(actor, {
      type: "declare-attack", commandId: "attack", stateVersion: 0,
      battlefieldId: "missing", attackerObjectIds: ["missing"],
    });
    expect(attack.receipt.status).toBe("rejected");
    expect(attack.receipt.error).toMatch(/CR 466\.2\.c/);
    const defense = runtime.submit(actor, {
      type: "declare-defense", commandId: "defense", stateVersion: 0,
      battlefieldId: "missing", defenderObjectIds: ["missing"],
    });
    expect(defense.receipt.status).toBe("rejected");
    expect(defense.receipt.error).toMatch(/CR 466\.2\.c/);
    const unknown = runtime.submit(actor, { type: "unknown", commandId: "unknown", stateVersion: 0 } as never);
    expect(unknown.receipt.status).toBe("rejected");
    expect(unknown.receipt.error).toMatch(/Invalid protocol v2 command/);
  }, 60_000);

  it("scans an ordinary death trigger and publishes Pending while the source is still Board", () => {
    const { state, pipeline } = productionHost();
    const ref = unit(state, "ordinary");
    const watched = observeBoundary(pipeline);
    const chain = new ChainEngine({
      turnOrder: ["A", "B"], turnPlayer: "A",
      host: { ...pipeline, deathBoundary: watched.boundary }, cleanup: () => false,
    });
    chain.pipeline.registerTrigger(killTrigger(state.object(ref)!, "deathknell:ordinary"));

    expect(chain.commit({ type: "kill", object: ref }).status).toBe("done");
    expect(watched.observed).toHaveLength(1);
    expect(watched.observed[0]![0]).toMatchObject({ ref, zone: "board" });
    const order = chain.pipeline.events.map(event => event.timingPoint);
    expect(order.indexOf("object-killed")).toBeLessThan(order.indexOf("chain-item-pending"));
    expect(order.indexOf("chain-item-pending")).toBeLessThan(order.indexOf("object-enters-trash"));
    expect(chain.items).toHaveLength(1);
    expect(chain.items[0]).toMatchObject({
      kind: "triggered",
      status: "pending",
      trigger: { source: { ref, zone: "board" }, event: { object: { ref, zone: "board" } } },
    });
    expect(state.object(ref)).toBeNull();
    expect(state.objects().find(object => object.ref.id === "ordinary")).toMatchObject({ zone: "trash" });
  });

  it("runs the original executable Unsung Hero Deathknell before Trash", () => {
    const { state, pipeline, setChoose } = productionHost();
    const ref = state.addCard("A", {
      id: "unsung-hero", cardId: unsungHero.canonicalCardId, name: "Unsung Hero",
      types: ["unit"], domains: ["Order"], might: 5, energy: null, power: null,
    }, "board");
    setChoose(request => request.type === "mode" ? request.options![0]! : (() => { throw new Error("unexpected choice"); })());
    const chain = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", host: pipeline, cleanup: () => false });
    const lifecycle = createProgramBinding({ cardPrograms: [unsungHero] }).attachLifecycle(chain);
    expect(chain.commit({ type: "kill", object: ref }).status).toBe("done");
    const pending = chain.items.filter(item => item.trigger?.registration.source.cardId === unsungHero.canonicalCardId);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0]).toMatchObject({
      kind: "triggered", status: "pending",
      trigger: {
        source: { ref, zone: "board", cardId: unsungHero.canonicalCardId, might: 5 },
        event: { object: { ref, zone: "board", cardId: unsungHero.canonicalCardId } },
      },
    });
    const order = chain.pipeline.events.map(event => event.timingPoint);
    expect(order.indexOf("object-killed")).toBeLessThan(order.indexOf("chain-item-pending"));
    expect(order.indexOf("chain-item-pending")).toBeLessThan(order.indexOf("object-enters-trash"));
    lifecycle.detach();
  });

  it("lets replacement effects finish before the original Board-incarnation callback", () => {
    const { state, pipeline, chain } = productionHost();
    const ref = unit(state, "prevented");
    const watched = observeBoundary(pipeline);
    const replaced = new ChainEngine({
      turnOrder: ["A", "B"], turnPlayer: "A",
      host: { ...pipeline, deathBoundary: watched.boundary }, cleanup: () => false,
    });
    replaced.pipeline.registerReplacement({
      id: "save",
      matches: action => action.type === "kill",
      apply: action => ({ status: "replace", actions: [
        { type: "move-location", object: action.object, to: { type: "base", player: "A" } },
      ] }),
    });
    expect(replaced.commit({ type: "kill", object: ref }).status).toBe("replaced");
    expect(watched.observed).toHaveLength(0);
    expect(state.object(ref)).toMatchObject({ zone: "board", location: { type: "base", player: "A" } });

    chain.pipeline.registerReplacement({
      id: "prevent", matches: action => action.type === "kill", apply: () => ({ status: "prevent" }),
    });
    expect(chain.commit({ type: "kill", object: ref }).status).toBe("prevented");
    expect(state.object(ref)).toMatchObject({ zone: "board" });
    expect(state.zoneObjects("A", "trash")).toHaveLength(0);
  });

  it("rejects old refs before the callback", () => {
    const { state, pipeline } = productionHost();
    const old = unit(state, "old");
    expect(state.perform({ type: "move-zone", object: old, to: "hand" }).status).toBe("done");
    const watched = observeBoundary(pipeline);
    expect(watched.boundary.execute({ type: "kill", object: old }, () => { throw new Error("must not run"); }).outcome.status)
      .toBe("impossible");
    expect(watched.observed).toHaveLength(0);
    expect(state.zoneObjects("A", "trash")).toHaveLength(0);
  });

  it("commits a typed multi-Kill wave after one callback with separate event identities", () => {
    const { state, pipeline, setChoose } = productionHost();
    const left = unit(state, "left");
    const right = unit(state, "right");
    setChoose(request => request.type === "mode" ? request.options![0]! : (() => { throw new Error("unexpected choice"); })());
    const watched = observeBoundary(pipeline);
    const chain = new ChainEngine({
      turnOrder: ["A", "B"], turnPlayer: "A",
      host: { ...pipeline, deathBoundary: watched.boundary }, cleanup: () => false,
    });
    for (const [id, ref] of [["left", left], ["right", right]] as const) {
      chain.pipeline.registerTrigger(killTrigger(state.object(ref)!, `deathknell:${id}`));
    }
    expect(chain.pipeline.commitContract(killBatch([left, right], "wave-1")).status).toBe("done");
    expect(watched.observed).toHaveLength(1);
    expect(watched.observed[0]!.map(object => object.ref)).toEqual([left, right]);
    const deaths = chain.pipeline.events.filter(event => event.timingPoint === "object-killed");
    expect(deaths.map(event => event.object?.ref)).toEqual([left, right]);
    expect(new Set(deaths.map(event => event.eventId)).size).toBe(2);
    expect(deaths.every(event => event.batchId === "wave-1")).toBe(true);
    expect(chain.items).toHaveLength(2);
    expect(chain.items.every(item => item.trigger?.event.batchId === "wave-1")).toBe(true);
  });

  it("rejects an invalid typed batch without a callback or partial transition", () => {
    const { state, pipeline } = productionHost();
    const live = unit(state, "live");
    const moved = unit(state, "moved");
    state.perform({ type: "move-zone", object: moved, to: "hand" });
    const watched = observeBoundary(pipeline);
    const execution = watched.boundary.executeContract(killBatch([live, moved], "invalid"), () => {
      throw new Error("must not run");
    });
    expect(execution.outcome.status).toBe("impossible");
    expect(watched.observed).toHaveLength(0);
    expect(state.object(live)).toMatchObject({ zone: "board" });
    expect(state.zoneObjects("A", "trash")).toHaveLength(0);
  });

  it("rolls back a typed late failure and retries both original incarnations", () => {
    const { state, pipeline, setChoose } = productionHost();
    const left = unit(state, "typed-retry-left");
    const right = unit(state, "typed-retry-right");
    setChoose(request => request.type === "mode" ? request.options![0]! : (() => { throw new Error("unexpected choice"); })());
    const watched = observeBoundary(pipeline);
    const chain = new ChainEngine({
      turnOrder: ["A", "B"], turnPlayer: "A",
      host: { ...pipeline, deathBoundary: watched.boundary }, cleanup: () => false,
    });
    for (const ref of [left, right]) chain.pipeline.registerTrigger(killTrigger(state.object(ref)!, `typed:${ref.id}`));
    let calls = 0;
    const original = chain.pipeline.onTrigger;
    chain.pipeline.onTrigger = trigger => {
      calls += 1;
      if (calls === 1) throw new Error("typed late failure");
      original(trigger);
    };
    expect(() => chain.pipeline.commitContract(killBatch([left, right], "typed-fail"))).toThrow("typed late failure");
    expect(state.object(left)).toMatchObject({ zone: "board" });
    expect(state.object(right)).toMatchObject({ zone: "board" });
    expect(chain.pipeline.events).toHaveLength(0);
    expect(chain.items).toHaveLength(0);
    expect(chain.pipeline.commitContract(killBatch([left, right], "typed-retry")).status).toBe("done");
    expect(chain.items).toHaveLength(2);
    expect(watched.observed).toHaveLength(2);
    expect(watched.observed[1]!.map(object => object.ref)).toEqual([left, right]);
  });

  it("rolls back a late failure and retries the same once-scoped incarnation exactly once", () => {
    const { state, pipeline } = productionHost();
    const ref = unit(state, "retry");
    const watched = observeBoundary(pipeline);
    const chain = new ChainEngine({
      turnOrder: ["A", "B"], turnPlayer: "A",
      host: { ...pipeline, deathBoundary: watched.boundary }, cleanup: () => false,
    });
    let calls = 0;
    const original = chain.pipeline.onTrigger;
    chain.pipeline.onTrigger = trigger => {
      calls += 1;
      if (calls === 1) throw new Error("late failure");
      original(trigger);
    };
    chain.pipeline.registerTrigger(killTrigger(state.object(ref)!, "deathknell:retry", "per-game"));

    expect(() => chain.commit({ type: "kill", object: ref })).toThrow("late failure");
    expect(state.object(ref)).toMatchObject({ zone: "board" });
    expect(chain.pipeline.events).toHaveLength(0);
    expect(chain.items).toHaveLength(0);
    expect(chain.commit({ type: "kill", object: ref }).status).toBe("done");
    expect(calls).toBe(2);
    expect(chain.items).toHaveLength(1);
    expect(state.objects().find(object => object.ref.id === "retry")).toMatchObject({ zone: "trash" });
  });

  it("consumes a once-per-game trigger once across a simultaneous Kill wave", () => {
    const { state, pipeline, setChoose } = productionHost();
    const observer = unit(state, "observer");
    const left = unit(state, "once-left");
    const right = unit(state, "once-right");
    const chain = new ChainEngine({
      turnOrder: ["A", "B"], turnPlayer: "A", host: pipeline, cleanup: () => false,
    });
    setChoose(request => request.type === "mode" ? request.options![0]! : (() => { throw new Error("unexpected choice"); })());
    chain.pipeline.registerTrigger({
      id: "observer:once", source: state.object(observer)!, controller: "A",
      spec: { at: "object-killed", filter: {}, once: "per-game" }, body: [],
    });
    expect(chain.pipeline.commitContract(killBatch([left, right], "once-wave")).status).toBe("done");
    expect(chain.items).toHaveLength(2);
    expect(chain.items.map(item => item.trigger?.event.object?.ref.id)).toEqual(["once-left", "once-right"]);
    expect(chain.items.every(item => item.trigger?.frequencyKey === chain.items[0]!.trigger?.frequencyKey)).toBe(true);
    chain.advance();
    expect(chain.items).toHaveLength(1);
    expect(chain.items[0]!.trigger?.event.object?.ref.id).toBe("once-left");
    chain.pass(chain.priority);
    chain.pass(chain.priority);
    expect(chain.items).toHaveLength(0);
  });

  it("keeps catalog Domains separate from Power and restores them with the host checkpoint", () => {
    const { state } = productionHost();
    const ref = unit(state, "domain-card", ["Mind", "Fury"]);
    expect(state.object(ref)).toMatchObject({ energy: null, power: null });
    expect(state.runeDomains(ref)).toEqual(["Mind", "Fury"]);
    const checkpoint = state.checkpoint();
    state.perform({ type: "move-zone", object: ref, to: "hand" });
    const current = state.objects().find(object => object.ref.id === "domain-card")!;
    expect(state.runeDomains(current.ref)).toEqual(["Mind", "Fury"]);
    expect(() => state.runeDomains(ref)).toThrow(/Stale object reference/);
    expect(() => state.runeDomains({ id: "missing", zoneEntryId: 1 })).toThrow(/Stale object reference/);
    state.restore(checkpoint);
    expect(state.runeDomains(ref)).toEqual(["Mind", "Fury"]);
  });
});
