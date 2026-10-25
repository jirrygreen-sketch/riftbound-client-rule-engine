import { describe, expect, it } from "vitest";
import { cardPrograms } from "../../../card-dsl/dist/cards/registry.generated.js";
import type { CardProgram } from "../../../card-dsl/dist/ir/types.js";
import { AwaitChoice, type PowerPaymentSource } from "../../../engine-core/dist/effects/contract.js";
import { bindResolveContext, createActionPipelineHost } from "../../../engine-core/dist/events/action-adapter.js";
import { TestWorld, world } from "../../../engine-core/dist/effects/testing/test-kernel.js";
import type { ObjectSnapshot } from "../../../engine-core/dist/effects/contract.js";
import type { Condition } from "../../../card-dsl/dist/ir/types.js";
import type { PipelineHost } from "../../../engine-core/dist/events/pipeline-types.js";
import { createProgramBinding } from "../../../engine-core/dist/programs/index.js";
import { TurnFlow } from "../../../engine-core/dist/turn/flow.js";
import {
  buildM1Deck,
  trustedPrintedCatalog,
} from "../../src/headless/decks.js";

const RUMBLE_CANONICAL = "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870";
const FORECASTER_CANONICAL = "card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40";
const FERROUS_CANONICAL = "card.hash-057dababf241fe29f90a9a6c306d4463227bed0d80f3df33c8261f7f43f5fed3";

function runtime(mech: ObjectSnapshot, energy: number, power: readonly PowerPaymentSource[] = []) {
  const builder = world().player("A", { energy, power: [...power] }).player("B")
    .base("rumble", {
      cardId: RUMBLE_CANONICAL, owner: "A", controller: "A", types: ["unit"], tags: ["Mech"], might: 4,
      location: { type: "base", player: "A" },
    })
    .base("fodder", {
      owner: "A", controller: "A", types: ["unit"], might: 3,
      location: { type: "base", player: "A" },
    })
    .card("trash-mech", {
      ...mech, zone: "trash", owner: "A", controller: "A", types: ["unit"], tags: ["Mech"],
    });
  for (const player of ["A", "B"]) {
    builder.deck(Array.from({ length: 8 }, (_, index) => `${player}:deck:${index}`), { owner: player });
    builder.rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  const kernel = builder.build();
  const finalized: unknown[] = [];
  const requests: unknown[] = [];
  let flow: TurnFlow;
  type ChooseRequest = Parameters<NonNullable<PipelineHost["choose"]>>[0];
  const choose = ((request: ChooseRequest): unknown => {
    requests.push(structuredClone(request));
    if (request.type === "optional") return request.id.startsWith("finalize:");
    if (request.type === "mode") return request.options[0];
    if (request.type === "select-objects") {
      if (request.id === "target:rumble.mech-in-trash") return request.options.filter(ref => ref.id === "trash-mech");
      if (request.id.endsWith(":pick:rumble.fodder")) return request.options.filter(ref => ref.id === "fodder");
      if (request.min === 0) return [];
    }
    throw new AwaitChoice(request);
  }) as <T>(request: ChooseRequest) => T;
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      const checkpoint = saved as {
        readonly state: Parameters<typeof kernel.restore>[0];
        readonly links: Parameters<typeof kernel.copyLinkedFrom>[0];
      };
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose: request => choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: registration => kernel.test(registration.spec.condition as Condition),
  });
  const binding = createProgramBinding({
    cardPrograms: cardPrograms as unknown as readonly CardProgram[],
    printedCatalog: trustedPrintedCatalog(),
  });
  flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: null }, { id: "bf2", controller: null }],
    describePlay: binding.describePlay,
  });
  binding.attachLifecycle(flow.chain, error => { throw error; });
  const rumble = kernel.getObject("rumble");
  if (rumble === null) throw new Error("Rumble was not registered at its real Conquer position");
  expect(binding.registerProgramTriggers(flow.chain, rumble)).toEqual(["program:rumble:1:1"]);
  const observe = flow.chain.pipeline.onEvent;
  flow.chain.pipeline.onEvent = event => {
    observe?.(event);
    if (event.timingPoint !== "chain-item-finalize" || event.object?.ref.id !== "trash-mech") return;
    const item = flow.chain.items.find(candidate =>
      candidate.source.ref.id === "trash-mech" && candidate.kind === "unit");
    if (item?.costPlan !== undefined) finalized.push(structuredClone(item.costPlan));
  };
  flow.start();
  if (energy > 0) {
    expect(flow.chain.commit({ type: "gain-energy", player: "A", amount: energy }).status).toBe("done");
  }
  if (power.length > 0) {
    expect(flow.chain.commit({ type: "gain-power", player: "A", power: [...power] }).status).toBe("done");
  }
  expect(flow.chain.commit({
    type: "move-location", object: kernel.ref("rumble"), to: { type: "battlefield", id: "bf1" },
  }).status).toBe("done");
  flow.advance();
  return { binding, finalized, flow, kernel, requests };
}

function settle(flow: TurnFlow): void {
  for (let guard = 0; guard < 200; guard++) {
    if (flow.chain.items.some(item => item.status === "pending")) { flow.advance(); continue; }
    if (flow.chain.items.length) {
      const holder = flow.chain.priority ?? flow.chain.focus;
      if (holder === null) throw new Error("Rumble chain has no Priority holder");
      flow.pass(holder);
      continue;
    }
    if (flow.chain.focus !== null) { flow.pass(flow.chain.focus); continue; }
    if (flow.chain.priority !== null) { flow.pass(flow.chain.priority); continue; }
    if (flow.combat.active) { flow.advance(); continue; }
    return;
  }
  throw new Error("production Rumble Conquer flow did not settle");
}

function nestedPlans(kernel: TestWorld): unknown[] {
  return Object.entries(kernel.linkedSnapshot())
    .filter(([key]) => key.endsWith("rumble.play-mech.playedCostPlans"))
    .flatMap(([, value]) => Array.isArray(value) ? value : []);
}

describe("RIFT-1066 trusted headless printed catalog", () => {
  it("deduplicates cosmetic reprints and preserves printed Energy and Power nulls", () => {
    const catalog = trustedPrintedCatalog();
    const canonicalIds = catalog.map(card => card.canonicalCardId);
    expect(new Set(canonicalIds).size).toBe(canonicalIds.length);
    expect(catalog.find(card => card.canonicalCardId === FORECASTER_CANONICAL)).toMatchObject({ energy: 2, power: null });
    expect(catalog.find(card => card.canonicalCardId === FERROUS_CANONICAL)).toMatchObject({ energy: 6, power: 1 });
    const rumble = buildM1Deck("rumble-sfd", "A").chosenChampion;
    expect(rumble.cardId).toBe(RUMBLE_CANONICAL);
  });

  it("plays a real M1 Forecaster from trash after Rumble recycles another Unit", () => {
    const fixture = runtime({
      id: "trash-mech", cardId: FORECASTER_CANONICAL, name: "Forecaster",
      energy: 2, power: null, might: 2,
    } as unknown as ObjectSnapshot, 0);
    settle(fixture.flow);

    expect.soft(fixture.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "target:rumble.mech-in-trash" }),
      expect.objectContaining({ id: expect.stringMatching(/:pick:rumble\.fodder$/) }),
    ]));
    expect(fixture.kernel.getObject("trash-mech")?.zone).toBe("board");
    expect(fixture.kernel.getObject("fodder")?.zone).toBe("deck");
    expect(fixture.finalized).toHaveLength(1);
    expect(fixture.finalized[0]).toMatchObject({
      printed: { energy: 2, power: null },
      total: { energy: 0, power: [] },
    });
    const plans = nestedPlans(fixture.kernel);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ energy: 0, power: [] });
    expect(fixture.flow.chain.items).toEqual([]);
  });

  it("uses Ferrous Forerunner's printed numeric Power without inferring it from Domain", () => {
    const fixture = runtime({
      id: "trash-mech", cardId: FERROUS_CANONICAL, name: "Ferrous Forerunner",
      energy: 6, power: ["Fury"], might: 6,
    } as unknown as ObjectSnapshot, 3, ["Fury"]);
    settle(fixture.flow);

    expect(fixture.kernel.getObject("trash-mech")?.zone).toBe("board");
    expect(fixture.finalized).toHaveLength(1);
    expect(fixture.finalized[0]).toMatchObject({
      printed: { energy: 6, power: ["Fury"] },
      total: { energy: 3, power: [{ amount: 1, allowedDomains: ["Fury"] }] },
    });
    const plans = nestedPlans(fixture.kernel);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ energy: 3, power: ["Fury"] });
    expect(fixture.kernel.player("A").power).toEqual([]);
  });
});
