// RIFT-667 single-card golden: validation, identity and the key IR structure of
// Ornn's Forge. The whole-card execution evidence (its own real gear plays through
// the generic card harness plus the measured outcome of binding its own static
// ability with the production binder) lives in
// `test/cards/templates/static-667.test.mjs`.
//
// The card stays judge-required: the production binder has no cost layer and
// the chain has no CardProgram -> Finalize consumer. The merged collector's
// first-play history is exercised here without claiming a production binding.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/ornns-forge.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { finalizeCostPlan } from "../../../../engine-core/dist/cost/discounts/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";

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
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-213-221 Ornn's Forge: static cost-modify structure", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // 356.4 / 356.4.b: "cost [1] less" is a discount in the energy component.
  assert.equal(ability.effect.kind, "cost.modify");
  assert.deepEqual(ability.effect.value, { kind: "constant", value: { energy: -1 } });
  // The per-turn "first played" window has no ContinuousEffect/condition shape.
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
    .battlefield("forge", { cardId: CANONICAL, types: ["battlefield"] })
    .hand("first", { types: ["gear"], energy: 2, power: [], isToken: false })
    .hand("second", { types: ["gear"], energy: 2, power: [], isToken: false })
    .build();
  const binding = { id: "forge-static", source: kernel.ref("forge"), ability };
  const input = id => ({
    id,
    cost: { energy: { kind: "constant", value: 2 } }
  });
  const context = id => bindResolveContext(kernel, {
    source: kernel.getObject(id),
    controller: "A"
  });
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
});

test("sfd-213-221 Ornn's Forge: the production static binder refuses this cost-plan shape", () => {
  // The declared ability never reaches the Finalize cost plan. Three independent
  // rejections are measured: the anchor, the printed token filter, then the kind.
  const kernel = world().player("A").player("B").unit("source", { might: 2 }).build();
  const handle = { layers: { addContinuous: () => { throw new Error("must not register"); }, removeContinuous: () => {} } };
  const binder = createEngineStaticBinder(handle);
  const source = kernel.getObject("source");
  assert.throws(
    () => binder.bindStatic(ability, source),
    error => error.code === "judge-required" && /Unsupported static appliesTo "play-cost"/.test(error.message)
  );
  const { appliesTo: _anchor, ...withoutAnchor } = ability.effect;
  assert.throws(
    () => binder.bindStatic({ ...ability, effect: withoutAnchor }, source),
    error => error.code === "judge-required" && /Unsupported static filter field isToken/.test(error.message)
  );
  assert.throws(
    () => binder.bindStatic(
      { kind: "static", effect: { kind: "cost.modify", value: { kind: "constant", value: { energy: -1 } } } },
      source
    ),
    error => error.code === "judge-required" && /no layer mapping/.test(error.message)
  );
});

test.todo(
  "sfd-213-221 Ornn's Forge: the first friendly non-token gear played each turn must cost 1 Energy less " +
    "(CR 356.4 / 356.4.f) - needs a CardProgram -> Finalize cost binding plus per-turn state and history-gated " +
    "expiry after the first qualifying play"
);
