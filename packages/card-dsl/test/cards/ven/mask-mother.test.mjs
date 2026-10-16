import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/mask-mother.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-bc75b317e045e4c201028fa2d365ec6ef8a8596d9d4883079758a7044f143bcf";
const SOURCE_TEXT =
  "When you discard me, you may pay :rb_energy_1: to give a friendly unit +2 :rb_might: this turn.";

const [ability] = program.abilities;
const [optional] = ability.body;
const [payEnergy, mightModify] = optional.args.body.value;
const OPTIONAL_ID = "mask-mother.may-pay-and-grant/optional";

const maskMotherWorld = () => {
  const base = world()
    .player("A", { energy: 2 })
    .unit("ally", { might: 2, location: { type: "base", player: "A" } })
    .build();
  return base.clone({
    controller: "A",
    sourceSnapshot: base.getObject("ally")
  });
};

test("ven-094-166 Mask Mother: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-094-166 Mask Mother: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /continuous\.might|临时 Might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
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
  // cost.pay 没有已合入的原语文件（RIFT-89），形状如实记录。
  assert.deepEqual(payEnergy.args, { energy: { kind: "constant", value: 1 } });
  assert.equal(payEnergy.linkedTo, undefined);
  assert.equal(payEnergy.targets, undefined);

  // 479.4.e.1 的临时 Might 修正；op 未注册（见 judgeReason 第 2 条）。
  assert.equal(mightModify.linkedTo, "mask-mother.pay-energy");
  assert.deepEqual(mightModify.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(mightModify.args.duration, { kind: "constant", value: "this-turn" });
  // 355.7 / 355.9.a.1 / 740.1.a：“a friendly unit” 是同一控制者下的单位目标。
  assert.deepEqual(mightModify.args.target, {
    kind: "constant",
    value: "mask-mother.friendly-unit"
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

test.todo(
  "ven-094-166 Mask Mother: pay the printed :rb_energy_1: inside the may-body at Finalize (740.4.a.2) — " +
    "effects/instructions/ has no cost.pay primitive and card-program cost-plan wiring is RIFT-89"
);

test.todo(
  "ven-094-166 Mask Mother: 'give a friendly unit +2 :rb_might: this turn' needs a registered temporary Might " +
    "modification (479.4.e.1 with the 315.4 / 317.2.c end-of-turn expiry) — no continuous.might instruction exists " +
    "(RIFT-91)"
);
