import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/butcher-of-the-sands.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-fd135b06be83d09c3f8ab5d01c8c2625b0ae9ea0392ea903d7ac2fae20d61237";
const SOURCE_TEXT =
  "[Reaction][>] :rb_rune_rainbow::rb_rune_rainbow:, :rb_exhaust:: [Add] :rb_energy_2:. " +
  "Spend this Energy only to play units or activated abilities of units.";

const [ability] = program.abilities;

test("ven-141-166 Butcher of the Sands: validateCardProgram passes and identity is verbatim", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /rainbow/);
  assert.match(program.judgeReason, /only to play units or activated abilities of units/);
});

test("ven-141-166: [Reaction][>] Add ability with the printed two-part cost", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 813.1.c / 813.1.d：[Reaction][>] 的许可按契约 3.1 记在 activated.timing。
  assert.equal(ability.timing, "reaction");
  // 204.1.b / 415.5：「:」前的两个 :rb_rune_rainbow: 与 :rb_exhaust: 组成 Base Cost。
  // 135.2.e.5.a / 163.2.b 的 [A] 无法用六域封闭集合表达，保留描述性记号。
  assert.deepEqual(ability.cost, {
    kind: "activated",
    power: { kind: "constant", value: ["rainbow", "rainbow"] },
    payments: [{ kind: "exhaust", object: "self" }]
  });
  // 本卡没有印刷 Energy 费用；energy 字段缺省，绝不写成 0。
  assert.equal("energy" in ability.cost, false);
});

test("ven-141-166: body is the single [Add] :rb_energy_2: instruction", () => {
  assert.equal(ability.body.length, 1);
  const [addEnergy] = ability.body;
  assert.equal(addEnergy.id, "butcher-of-the-sands.add-energy");
  assert.equal(addEnergy.op, "effect.resources");
  // 430.1 / 430.5 / 168：Add 2 Energy 到控制者 Rune Pool。
  assert.deepEqual(addEnergy.args, { energy: { kind: "constant", value: 2 } });
  assert.equal(addEnergy.targets, undefined);
  assert.equal(addEnergy.picks, undefined);
  assert.equal(addEnergy.linkedTo, undefined);
  // 「Spend this Energy only to …」的用途限制没有可表达的 IR 形状，
  // 因此不写伪造的 restriction（见 judgeReason 第 2 条）。
  assert.equal("restriction" in ability, false);
});

test("ven-141-166 golden: [Add] :rb_energy_2: adds two Energy to the controller", () => {
  const kernel = world()
    .unit("butcher", { types: ["legend"], zone: "board" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("butcher") });

  const outcome = resolveChainBody(ability.body, context);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["butcher-of-the-sands.add-energy", "executed"]
  ]);
  assert.equal(context.player("A").energy, 2);
  assert.deepEqual(context.events.map(event => event.action), ["gain-energy"]);
  assert.deepEqual(outcome.linkedValues["butcher-of-the-sands.add-energy.resources"], {
    player: "A",
    energy: 2,
    power: []
  });
});

test("ven-141-166: the printed [A] Power cost has no executable cost plan", () => {
  const kernel = world()
    .unit("butcher", { types: ["legend"], zone: "board" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("butcher") });

  // 163.2.b：[A] 无法用六域封闭集合表达，因此印刷费用没有可执行计划（见 judgeReason 第 1 条）。
  assert.throws(
    () => buildCostPlan(context, { id: "cost", cost: ability.cost }),
    error => error instanceof CostPlanError && error.reason === "invalid-cost-plan"
  );
});

test.todo(
  "ven-141-166: two [A] Universal Power — Domain is a closed six-domain union and " +
    "effect.resources documents that [A] must never be approximated by a chosen domain (CR 163.2.b)"
);
test.todo(
  "ven-141-166: 'Spend this Energy only to play units or activated abilities of units' — the " +
    "closed GameAction set has an untagged gain-energy only; no restricted-resource shape exists"
);
test.todo(
  "ven-141-166: ActivatedAbility -> Chain Finalize wiring and the 430.3 Reaction Add payment " +
    "window are unmerged (RIFT-89)"
);
