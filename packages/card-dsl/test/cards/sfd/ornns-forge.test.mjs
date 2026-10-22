// RIFT-921 focused evidence for Ornn's Forge. The card remains judge-required
// until Chain Finalize consumes its registered static cost source. The tests
// distinguish the merged production binder/collector from an actual card play
// and assert that a real gear still pays its printed Energy in the latter.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/ornns-forge.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { finalizeCostPlan } from "../../../../engine-core/dist/cost/discounts/index.js";
import { staticCostSources } from "../../../../engine-core/dist/programs/static-adapters/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { productionPlay } from "../../fixtures/production-play.mjs";
import orbOfRegret from "../../../dist/cards/ogn/orb-of-regret.js";

const CANONICAL = "card.hash-44e95dd0a87b7dfcd7565b73a33e204f85c97ac82e004a6127ff7ed649fb41ad";
const SOURCE_TEXT =
  "While you control this battlefield, the first friendly non-token gear played each turn costs :rb_energy_1: less.";
const [ability] = program.abilities;

test("sfd-213-221 Ornn's Forge: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /staticCostSources/);
  assert.match(program.judgeReason, /chain\/engine\.ts:843-854/);
  assert.match(program.judgeReason, /purpose \"play\"/);
  assert.match(program.judgeReason, /finalized-play history/);
  assert.doesNotMatch(program.judgeReason, /Unsupported static appliesTo/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-213-221 Ornn's Forge: static cost-modify structure", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // 356.4 / 356.4.b: "cost [1] less" is a discount in the energy component.
  assert.equal(ability.effect.kind, "cost.modify");
  assert.deepEqual(ability.effect.value, { kind: "constant", value: { energy: -1 } });
  // The collector implements this window; production Finalize still lacks it.
  assert.equal(ability.effect.duration, "per-turn-first-play");
  assert.equal(ability.effect.appliesTo, "play-cost");
  assert.deepEqual(ability.effect.filter, { type: "gear", controller: "controller", isToken: false });
  // 190.6.a / 190.6.d: "While you control this battlefield" is kept explicit.
  assert.deepEqual(ability.condition, {
    kind: "compare",
    left: { kind: "count", subject: "objects", filter: { object: "self", controller: "self" } },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("sfd-213-221 Ornn's Forge component: the merged cost.modify primitive really applies the authored delta", () => {
  // The primitive itself is executable: given a locked base cost it applies the
  // declared energy reduction through the merged cost plan (356.4 / 356.4.f).
  const kernel = world().player("A", { energy: 20 }).unit("source", { might: 2 }).build();
  const bound = kernel.clone({ source: kernel.getObject("source") });
  const run = runInstruction(costModify, {
    id: "cost:ornns-forge",
    cost: { kind: "explicit", energy: { kind: "constant", value: 3 } },
    modifier: { kind: "reduce", resource: "energy", amount: { kind: "constant", value: 1 } }
  }, { world: bound });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.cost.total.energy, 2);
  assert.deepEqual(run.linked.cost.total.power, []);
});

test("sfd-213-221 Ornn's Forge: the merged collector honors the first qualifying gear history", () => {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .battlefield("forge", { cardId: CANONICAL, types: ["battlefield"] })
    .hand("first", { types: ["gear"], energy: 2, power: [], isToken: false })
    .hand("second", { types: ["gear"], energy: 2, power: [], isToken: false })
    .hand("token-gear", { types: ["gear"], energy: 2, power: [], isToken: true })
    .hand("spell", { types: ["spell"], energy: 2, power: [], isToken: false })
    .object("enemy-gear", { owner: "B", controller: "B", types: ["gear"], energy: 2, power: [], isToken: false })
    .build();
  const binding = { id: "forge-static", source: kernel.ref("forge"), ability };
  const input = id => ({
    id,
    cost: { energy: { kind: "constant", value: 2 } }
  });
  const context = id => {
    const source = kernel.getObject(id);
    return bindResolveContext(kernel, { source, controller: source.controller });
  };
  const firstPlan = finalizeCostPlan(context("first"), input("first"), {
    statics: [binding],
    finalizedPlaysThisTurn: []
  });
  assert.equal(firstPlan.total.energy, 1);

  const secondPlan = finalizeCostPlan(context("second"), input("second"), {
    statics: [binding],
    finalizedPlaysThisTurn: [{ object: kernel.getObject("first"), player: "A" }]
  });
  assert.equal(secondPlan.total.energy, 2);

  const activationPlan = finalizeCostPlan(context("first"), input("first"), {
    statics: [binding],
    finalizedPlaysThisTurn: [],
    purpose: "activate"
  });
  assert.equal(activationPlan.total.energy, 2, "a play-cost modifier must not discount an activated ability");

  const tokenPlan = finalizeCostPlan(context("token-gear"), input("token-gear"), {
    statics: [binding],
    finalizedPlaysThisTurn: []
  });
  assert.equal(tokenPlan.total.energy, 2, "the printed non-token clause excludes token Gear");

  const spellPlan = finalizeCostPlan(context("spell"), input("spell"), {
    statics: [binding],
    finalizedPlaysThisTurn: []
  });
  assert.equal(spellPlan.total.energy, 2, "the discount is limited to Gear");

  const enemyPlan = finalizeCostPlan(context("enemy-gear"), input("enemy-gear"), {
    statics: [binding],
    finalizedPlaysThisTurn: []
  });
  assert.equal(enemyPlan.total.energy, 2, "the printed friendly clause excludes an opponent's Gear");
});

test("sfd-213-221 Ornn's Forge: production binding registers its cost source", () => {
  const kernel = world()
    .player("A", { energy: 10 })
    .player("B", { energy: 10 })
    .battlefield("forge", {
      cardId: CANONICAL,
      types: ["battlefield"],
      controller: "A",
      zone: "chain"
    })
    .build();
  const choose = () => { throw new Error("unexpected choice"); };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
    cleanup: () => false, describePlay: () => { throw new Error("no play"); }
  });
  const executable = { ...program, status: "executable" };
  delete executable.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [executable] });
  binding.attachLifecycle(engine, error => { throw error; });
  const chained = kernel.getObject("forge");
  engine.commit({ type: "move-zone", object: chained.ref, to: "battlefield", location: { type: "battlefield", id: "forge-field" } });

  const [source] = staticCostSources(engine);
  assert.ok(source, "the production static source must be discoverable");
  assert.equal(source.source.id, "forge");
  assert.equal(source.ability.effect.kind, "cost.modify");
  assert.equal(source.ability.effect.appliesTo, "play-cost");
  assert.deepEqual(source.ability.effect.filter, { type: "gear", controller: "controller", isToken: false });
});

test("sfd-213-221 Ornn's Forge productionPlay: the first qualifying Gear still pays its printed Energy before the Finalize bridge exists", () => {
  const executable = { ...program, status: "executable" };
  delete executable.judgeReason;
  const f = productionPlay({
    // Lifecycle still refuses the published judge-required status. A metadata-only
    // executable view isolates the independently missing Finalize consumer.
    programs: [executable, orbOfRegret],
    build: w => w.player("A", { energy: 10 }).player("B", { energy: 10 })
      // The entry transition below establishes the real Board lifecycle binding.
      .object("forge", { cardId: CANONICAL, types: ["battlefield"], zone: "chain", controller: "A", energy: null, power: null })
      .object("first", { cardId: orbOfRegret.canonicalCardId, types: ["gear"], zone: "hand", energy: 1, power: [], isToken: false })
      .object("second", { cardId: orbOfRegret.canonicalCardId, types: ["gear"], zone: "hand", energy: 1, power: [], isToken: false })
  });
  const forge = f.kernel.getObject("forge");
  f.engine.commit({ type: "move-zone", object: forge.ref, to: "battlefield", location: { type: "battlefield", id: "forge-field" } });
  assert.ok(staticCostSources(f.engine).some(source => source.source.id === "forge"));
  f.engine.advance();

  const before = f.kernel.player("A").energy;
  const draft = f.describe("first");
  f.engine.execute(draft);
  f.settle();
  assert.equal(f.kernel.getObject("first").zone, "board");
  assert.equal(f.kernel.player("A").energy, before - 1,
    "CR 356.4: the first qualifying Gear should pay 0, but the absent Chain Finalize bridge charges 1");
});

test.todo(
  "sfd-213-221 Ornn's Forge: the first friendly non-token gear played each turn must cost 1 Energy less " +
    "(CR 356.4 / 356.4.f) - staticCostSources(engine) is registered, but Chain Finalize still builds only " +
    "the caller-owned draft cost and supplies neither static sources, purpose play, nor finalized-play history"
);
