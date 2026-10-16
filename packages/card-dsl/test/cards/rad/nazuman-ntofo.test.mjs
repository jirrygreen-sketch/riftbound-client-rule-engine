import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/nazuman-ntofo.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { buildCostPlan } = await import(new URL("cost/cost-plan.js", ENGINE));
const { CostPlanError } = await import(new URL("cost/plan-types.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));

const CARD_ID = "card.hash-bbba13a99fc64b76e1aea5bf99acad154b4526f0661f19a3ac11162fced5801a";
const EXPECTED_SOURCE =
  "Equip :rb_energy_1: (:rb_energy_1:: Attach this to a unit you control.)";

test("rad-071-167 Nazuman Ntofo: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /equip/);
  assert.match(program.judgeReason, /CostPlanError|费用管线/);
});

test("rad-071-167 Nazuman Ntofo: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.judgeReason.length > 0, true);
  assert.equal(program.sourceText, EXPECTED_SOURCE);
});

test("rad-071-167 Nazuman Ntofo: single non-valued-free Equip declaration carrying the printed 1 energy symbol", () => {
  assert.equal(program.abilities.length, 1);
  const [equip] = program.abilities;
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // 818.1.c 的印刷费用只有 1 个能量符号，没有 Power：不写 costDomain。
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, undefined);
});

test("rad-071-167 Nazuman Ntofo: the merged Equip expansion is valid EffectIR for this card", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "separate");

  // 818.1.c.2：展开功能上等于「[费用]: Attach this to a unit you control.」
  const expansion = definition.expand({
    value: program.abilities[0].value,
    host: { canonicalCardId: CARD_ID }
  });
  const expanded = validateCardProgram({
    canonicalCardId: CARD_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: expansion,
    sourceText: EXPECTED_SOURCE
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);

  const [ability] = expansion;
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost.payments.map((payment) => payment.kind), ["equip"]);
  assert.deepEqual(ability.body.map((step) => [step.id, step.op]), [["equip-attach", "effect.attach"]]);
  // 818.1.b.1 / 818.1.c.2：选择的单位是 Target，且限你控制的单位。
  assert.deepEqual(ability.body[0].targets, [{
    id: "equip-target",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  }]);
});

test("rad-071-167 Nazuman Ntofo: the Equip activation cost is rejected by the merged cost plan", () => {
  // 费用管线对未知支付种类直接 blocked：这条真实的失败就是 judgeReason 的证据。
  const kernel = world()
    .unit("nazuman-ntofo", {
      types: ["gear"],
      might: null,
      energy: 1,
      power: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("ally", { might: 2 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("nazuman-ntofo") });
  const definition = keywordDefinitionsById.get("Equip");
  const [activation] = definition.expand({ value: 1, host: { canonicalCardId: CARD_ID } });

  assert.throws(
    () => buildCostPlan(context, { id: "nazuman-ntofo:equip", cost: activation.cost }),
    (error) =>
      error instanceof CostPlanError &&
      error.reason === "judge-required" &&
      /Unsupported payment kind: equip/.test(error.message)
  );
});

test.todo("rad-071-167 Nazuman Ntofo: paying the printed Equip cost (1 energy, 818.1.c / 818.1.c.3) needs the \"equip\" cost payment kind in cost/plan-values.ts (RIFT-89 follow-up) plus the program -> keyword expansion -> chain wiring (contract 3.5).");
test.todo("rad-071-167 Nazuman Ntofo: the merged Equip body (effect.attach to a controlled unit, 818.1.b.2 top-most) can only be exercised end-to-end once the activation cost above can be finalized.");
