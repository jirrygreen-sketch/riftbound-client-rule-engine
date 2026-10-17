import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/mask-mother.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-bc75b317e045e4c201028fa2d365ec6ef8a8596d9d4883079758a7044f143bcf";
const SOURCE_TEXT =
  "When you discard me, you may pay :rb_energy_1: to give a friendly unit +2 :rb_might: this turn.";

const [ability] = program.abilities;
const [optional] = ability.body;
const [payEnergy, mightModify] = optional.args.body.value;
const OPTIONAL_ID = "mask-mother.may-pay-and-grant/optional";

// The reference TestWorld stores symbolic filters in card IR, while its query
// matcher compares values literally. Bind the contract's source-relative
// `controller: "self"` selector at the test-context boundary and execute the
// original instruction body, including its finalized TargetSpec.
function bindSelfController(kernel) {
  const query = kernel.query.bind(kernel);
  kernel.query = filter => query(
    Object.fromEntries(Object.entries(filter).map(([key, value]) => [
      key,
      value === "self" ? kernel.controller : value
    ]))
  );
  return kernel;
}

const maskMotherWorld = () => {
  const base = world()
    .player("A", { energy: 2 })
    .unit("ally", { might: 2, location: { type: "base", player: "A" } })
    .build();
  return bindSelfController(base.clone({
    controller: "A",
    sourceSnapshot: base.getObject("ally")
  }));
};

test("ven-094-166 Mask Mother: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-094-166 Mask Mother: identity, ruleset, executable status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-094-166: 'When you discard me' is a self-scoped discard trigger (423.1.b)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-discarded");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-discarded",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  // 403.1 / 契约 3.9：“you may pay … to …” 的首段是触发能力自身的可选执行。
  assert.equal(ability.optional, true);
  assert.equal(optional.id, "mask-mother.may-pay-and-grant");
  assert.equal(optional.op, "choice.optional");
  assert.equal(optional.linkedTo, undefined);
});

test("ven-094-166: the payment is a Finalize cost and the rider a friendly-unit Might modification", () => {
  assert.deepEqual(optional.args.body.value.map((instruction) => [instruction.id, instruction.op]), [
    ["mask-mother.pay-energy", "cost.pay"],
    ["mask-mother.give-plus-2-might", "continuous.might"]
  ]);
  // 740.4.a.2：“pay :rb_energy_1:” 是效果首段在 Finalization 支付的费用；
  // 740.4.a.2：cost.pay consumes a finalized payment plan shape.
  assert.deepEqual(payEnergy.args, {
    payments: { kind: "constant", value: { energy: 1 } }
  });
  assert.equal(payEnergy.linkedTo, undefined);
  assert.equal(payEnergy.targets, undefined);

  // 479.4.e.1 的临时 Might 修正；通过已注册的 continuous.might 建立算术层效果。
  assert.equal(mightModify.linkedTo, "mask-mother.pay-energy");
  assert.deepEqual(mightModify.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(mightModify.args.duration, { kind: "constant", value: "this-turn" });
  // 355.7 / 355.9.a.1 / 740.1.a：“a friendly unit” 是同一控制者下的单位目标。
  assert.deepEqual(mightModify.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "mask-mother.friendly-unit" }
  });
  assert.deepEqual(mightModify.targets, [
    {
      id: "mask-mother.friendly-unit",
      filter: { type: "unit", zone: "board", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(mightModify.picks, undefined);
  assert.equal(instructionDefinitionsById.has("cost.pay"), true);
  assert.equal(instructionDefinitionsById.has("continuous.might"), true);
});

test("ven-094-166 golden: declining the may-body pays nothing and grants nothing (403.1)", () => {
  const kernel = maskMotherWorld();
  kernel.setAnswers({ [OPTIONAL_ID]: false });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [["mask-mother.may-pay-and-grant", "negated", "skipped"]]
  );
  assert.equal(kernel.player("A").energy, 2);
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(kernel.events, []);
});

test("ven-094-166 golden: accepting the may-body pays 1 Energy and registers +2 Might until end of turn", () => {
  const kernel = maskMotherWorld();
  kernel.setTargets("mask-mother.friendly-unit", [kernel.ref("ally")]);
  kernel.setAnswers({ [OPTIONAL_ID]: true });

  const outcome = resolveChainBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["mask-mother.pay-energy", "executed"],
      ["mask-mother.give-plus-2-might", "executed"],
      ["mask-mother.may-pay-and-grant", "executed"]
    ]
  );
  assert.equal(kernel.player("A").energy, 1);
  const [registered] = kernel.snapshot().continuous;
  assert.equal(registered.effect.effect.kind, "continuous.might");
  assert.deepEqual(registered.duration, { type: "end-of-turn" });

  const layers = createLayerEngine(
    kernel.query({}),
    kernel.snapshot().continuous.map((entry) => ({ effect: entry.effect, duration: entry.duration }))
  );
  assert.equal(layers.evaluate(kernel.ref("ally")).might, 4);
});

test("ven-094-166 golden: insufficient Energy aborts the accepted may-body without a Might grant", () => {
  const base = world()
    .player("A", { energy: 0 })
    .unit("ally", { owner: "A", controller: "A", might: 2, location: { type: "base", player: "A" } })
    .build();
  const kernel = bindSelfController(base.clone({ controller: "A", sourceSnapshot: base.getObject("ally") }));
  kernel.setTargets("mask-mother.friendly-unit", [kernel.ref("ally")]);
  kernel.setAnswers({ [OPTIONAL_ID]: true });

  assert.throws(() => resolveChainBody(ability.body, kernel), /cannot-pay-cost|insufficient/i);
  assert.equal(kernel.player("A").energy, 0);
  assert.deepEqual(kernel.snapshot().continuous, []);
});
