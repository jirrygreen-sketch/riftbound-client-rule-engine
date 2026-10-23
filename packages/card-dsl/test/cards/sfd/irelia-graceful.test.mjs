// RIFT-667 single-card golden: validation, identity, the key IR structure of
// Irelia, Graceful, and the merged cost-plan vocabulary it would have to reach.
// The whole-card execution evidence (its own scenario through the generic card
// harness plus the measured outcome of binding its own static ability with the
// production binder) lives in `test/cards/templates/static-667.test.mjs`.
//
// The card stays judge-required: continuous.cost-modification has no layer
// mapping and the production chain does not pass the static binding and locked
// targets into Finalize. The merged collector evidence below does not claim a
// production binding.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/irelia-graceful.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { staticCostSources } from "../../../../engine-core/dist/programs/statics.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { finalizeCostPlan } from "../../../../engine-core/dist/cost/discounts/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-4226ae419dd851644c384f3f4d645badcec767b55055e62cb45fcc436ec55e03";
const SOURCE_TEXT = "Your spells that choose me cost :rb_energy_1: or :rb_rune_rainbow: less.";
const [ability] = program.abilities;

test("sfd-141-221 Irelia, Graceful: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-141-221 Irelia, Graceful: one static cost reduction scoped to spells that choose this unit", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // 363: the printed "While …"-free passive cost change is a Passive Ability.
  assert.equal(ability.effect.kind, "continuous.cost-modification");
  assert.equal(ability.effect.stage, "discount");
  // 356.4.b / 356.4.c: a per-component "cost [amount] less".
  assert.equal(ability.effect.resource, "energy");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
  // 163.2.b: the printed "or [A]" alternative stays an explicit Universal Power.
  assert.deepEqual(ability.effect.alternative, { resource: "power", universal: true, amount: 1 });
  // 355.6: "choose" means Targeting, and "me" is the symbolic self selector.
  assert.deepEqual(ability.effect.appliesTo, { type: "spell", object: "self" });
  assert.equal(ability.condition, undefined);
});

test("sfd-141-221 Irelia, Graceful: the production binder registers the targeted discount source", () => {
  const kernel = world()
    .unit("irelia", { cardId: CARD_ID, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const source = kernel.getObject("irelia");
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("A static binding must not ask for a choice"); },
    context: (value, controller, timingPoint) => bindResolveContext(kernel, { source: value, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host });
  const handle = createEngineStaticBinder(engine).bindStatic(ability, source);
  const [costSource] = staticCostSources(engine);
  assert.deepEqual(costSource.ability.effect.appliesTo, { type: "spell", object: "self" });
  assert.deepEqual(costSource.ability.effect.alternative, { resource: "power", universal: true, amount: 1 });
  handle.unbind();
  assert.deepEqual(staticCostSources(engine), []);
});

test("sfd-141-221 Irelia, Graceful: the merged cost collector honors the locked target and Universal Power choice", () => {
  const makeContext = (cost) => {
    const kernel = world()
      .player("A", { energy: 10, power: ["Mind"] })
      .unit("irelia", { cardId: CARD_ID, location: { type: "battlefield", id: "bf-1" } })
      .hand("spell", { types: ["spell"], energy: 2, power: [] })
      .build();
    const context = kernel.clone({
      source: kernel.ref("spell"),
      sourceSnapshot: kernel.getObject("spell"),
      controller: "A"
    });
    return { context, binding: { id: "irelia-static", source: kernel.ref("irelia"), ability }, cost };
  };

  const unrelated = makeContext({ energy: { kind: "constant", value: 2 } });
  assert.equal(
    finalizeCostPlan(unrelated.context, {
      id: "spell",
      cost: unrelated.cost
    }, {
      statics: [unrelated.binding],
      targets: []
    }).total.energy,
    2
  );

  const primary = makeContext({ energy: { kind: "constant", value: 2 } });
  primary.context.setAnswers({ "spell:modifier:irelia-static:0:total:resource": "primary" });
  assert.equal(
    finalizeCostPlan(primary.context, {
      id: "spell",
      cost: primary.cost
    }, {
      statics: [primary.binding],
      targets: [primary.context.ref("irelia")]
    }).total.energy,
    1
  );

  const alternative = makeContext({
    energy: { kind: "constant", value: 2 },
    payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Mind"] }]
  });
  alternative.context.setAnswers({ "spell:modifier:irelia-static:0:total:resource": "alternative" });
  const plan = finalizeCostPlan(alternative.context, {
    id: "spell",
    cost: alternative.cost
  }, {
    statics: [alternative.binding],
    targets: [alternative.context.ref("irelia")]
  });
  assert.equal(plan.total.energy, 2);
  assert.deepEqual(plan.total.power, []);
});

test("sfd-141-221 Irelia, Graceful: judgeReason names the measured consumer gaps", () => {
  // Re-probed 2026-10-18: the collector is executable; the production
  // static-to-Finalize bridge is still missing.
  assert.match(program.judgeReason, /staticTarget/);
  assert.match(program.judgeReason, /layerFor/);
  assert.match(program.judgeReason, /finalizeCostPlan/);
  assert.match(program.judgeReason, /锁定目标/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test.todo(
  "sfd-141-221 Irelia, Graceful: a spell that chooses me must really cost 1 Energy or 1 Universal Power less " +
    "(CR 355.6 / 356.4.b / 163.2.b) - needs the production CardProgram -> Finalize discount consumer " +
    "to pass the locked target set and static binding into finalizeCostPlan"
);
