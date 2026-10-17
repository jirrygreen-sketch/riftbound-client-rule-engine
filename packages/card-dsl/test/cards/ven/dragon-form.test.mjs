import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/dragon-form.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CARD_ID = "card.hash-ace1c75d6848b5ce9e834068a2b6255d8f82c7ccf918d3063e5a31698ccdacb6";
const SOURCE_TEXT =
  "Choose a unit. Its base Might becomes 5 this turn.\n" +
  "[Flow] :rb_energy_3: (You may play this from your trash for its Flow cost. Then banish it.)";

const [flowKeyword, play] = program.abilities;
const [setBaseMight] = play.body;

test("ven-116-166 Dragon Form: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-116-166 Dragon Form: judgeReason names the trait layer setting, the duration and Flow", () => {
  // 143.2.a trait-altering set and the remaining Flow parameter/receipt/matching integration.
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /continuous\.base-might/);
  assert.match(program.judgeReason, /set-might/);
  assert.doesNotMatch(program.judgeReason, /RIFT-9\d/);
  assert.doesNotMatch(program.judgeReason, /RIFT-120/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /829\.1\.b/);
  assert.match(program.judgeReason, /KeywordDef\.expand\.params\.cost/);
  assert.match(program.judgeReason, /实付实例回执/);
  assert.match(program.judgeReason, /object-leaves-chain/);
  // 143.2.c.1: the actual Might value is not clamped, so no printed floor is invented.
  assert.match(program.judgeReason, /143\.2\.c\.1/);
  assert.match(program.judgeReason, /set-trait/);
  assert.match(program.judgeReason, /programs\/statics/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("Dragon Form layer dependency: the generic trait layer sets Might before arithmetic and expires", () => {
  // The layer consumer exists; continuous.base-might still has no registered card instruction.
  const kernel = world().unit("unit", { might: 2, power: null }).build();
  const object = kernel.getObject("unit");
  const layers = createLayerEngine([object], [
    { effect: { id: "base", layer: "trait", source: object.ref, filter: { objectId: "unit" },
        effect: { kind: "set-trait", property: "might", value: setBaseMight.args.value.value } },
      duration: { type: "end-of-turn" }, timestamp: 1, sequence: 1 },
    { effect: { id: "bonus", layer: "arithmetic", source: object.ref, filter: { objectId: "unit" },
        effect: { kind: "continuous.might", amount: 2 } },
      duration: { type: "permanent" }, timestamp: 2, sequence: 2 }
  ]);
  assert.equal(layers.evaluate(object.ref).might, 7);
  assert.equal(kernel.getObject("unit").might, 2);
  assert.equal(kernel.getObject("unit").power, null);
  layers.advance({ id: "turn-end", player: "A" });
  assert.equal(layers.evaluate(object.ref).might, 4);
});

test("ven-116-166 Dragon Form: [Flow] keyword plus one trait-layer base-Might set", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(flowKeyword, { kind: "keyword", keyword: "flow" });
  assert.equal(flowKeyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);
  assert.equal(setBaseMight.id, "dragon-form.set-base-might");
  assert.equal(setBaseMight.op, "continuous.base-might");
  // 143.2.a: the setting is the trait-altering layer value 5 for this turn; the
  // value is exactly the printed 5 and no minimum is written.
  assert.deepEqual(setBaseMight.args, {
    value: { kind: "constant", value: 5 },
    duration: { kind: "constant", value: "this-turn" }
  });
  // "Choose a unit": one chosen Board unit (355.7/355.9.a.1/355.10).
  assert.deepEqual(setBaseMight.targets, [
    {
      id: "dragon-form.unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(setBaseMight.args.minimum, undefined);
  assert.equal(setBaseMight.linkedTo, undefined);
  assert.equal(setBaseMight.picks, undefined);
});

test("ven-116-166 Dragon Form: the [Flow] keyword the card declares is a registered definition", () => {
  // Positive-only check: the card's keyword declaration names a real registry entry
  // (remaining parameter/receipt/matching integration is recorded in judgeReason and the todos).
  assert.equal(keywordDefinitionsById.has("Flow"), true);
  assert.equal(keywordDefinitionsById.get("Flow").valued, false);
  assert.equal(keywordDefinitionsById.get("Flow").stacking, "separate");
});

test("ven-116-166 Dragon Form golden: an explicitly supplied Flow parameter expands and plans the printed 3 Energy alternate cost", () => {
  // Tests the merged keyword/planner APIs; expandProgram still needs to pass this printed parameter.
  const cost = { energy: { kind: "constant", value: 3 } };
  const expanded = keywordDefinitionsById.get("Flow").expand({
    host: { canonicalCardId: CARD_ID },
    params: { cost }
  });
  const flowCost = expanded.find(ability => ability.kind === "static").effect;
  assert.equal(flowCost.kind, "flow.cost");
  assert.equal(flowCost.sourceZone, "trash");
  assert.deepEqual(flowCost.cost, cost);
  const kernel = world()
    .player("A", { energy: 4 })
    .card("dragon-form", { zone: "trash", types: ["spell"], energy: 3, power: null })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("dragon-form") });
  const plan = buildCostPlan(context, {
    id: "dragon-form.flow",
    cost: { kind: "printed" },
    baseModifications: [{ kind: "flow", id: "dragon-form.flow-instance", cost: flowCost.cost }]
  });
  assert.equal(plan.total.energy, 3);
  assert.deepEqual(plan.total.power, []);
  assert.equal(payCostPlan(context, plan).paid, true);
  assert.equal(context.player("A").energy, 1);
});

test.todo(
  "ven-116-166 Dragon Form: execute 'Its base Might becomes 5 this turn' in the trait-altering " +
    "layer (143.2.a) with an end-of-turn expiry (317.2.c/318) — needs the continuous.base-might " +
    "instruction to bind the existing trait layer (continuous.might's set is the arithmetic layer, not the trait layer)"
);

test.todo(
  "ven-116-166 Dragon Form: play from Trash for the printed Flow cost and banish the spell when it " +
    "leaves the Chain by 829.1.b (not by its own execution, 829.1.b.1) — needs printed Flow-cost parameter " +
    "passing, a selected-instance receipt, Trash play permission and object-leaves-chain replacement matching"
);
