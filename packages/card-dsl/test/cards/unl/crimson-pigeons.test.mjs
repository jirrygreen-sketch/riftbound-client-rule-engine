import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/crimson-pigeons.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-202a6a8d0996a1526ced8874bdc194188d33ba1a216fb691a29e5fd4a678afd7";
const SOURCE_TEXT = "I have +2 :rb_might: while I'm attacking with another unit.";

const [ability] = program.abilities;

test("unl-154-219 Crimson Pigeons: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-154-219 Crimson Pigeons: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /807\.1\.d|466\.2\.c\.3/);
  assert.match(program.judgeReason, /combat\/|designation|combatRole/);
  assert.match(program.judgeReason, /sameLocationAs/);
});

test("unl-154-219 Crimson Pigeons: one static +2 Might modifier scoped to itself", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // 143.2.a / 479.4：Might 的修正在算术层生效。
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 2 });
  assert.equal(ability.effect.appliesTo, "self");
});

test("unl-154-219 Crimson Pigeons: the 'attacking with another unit' clause is an explicit condition", () => {
  // 364.3 的条件式被动能力；807.1.d / 466.2.c.3 的攻击者身份与 740.2.c 的 in combat 定义。
  assert.equal(ability.condition.kind, "all");
  assert.equal(ability.condition.conditions.length, 2);
  const [, withAnotherAttacker] = ability.condition.conditions;
  assert.equal(withAnotherAttacker.kind, "compare");
  assert.equal(withAnotherAttacker.operator, "gte");
  assert.deepEqual(withAnotherAttacker.right, { kind: "constant", value: 1 });
  assert.equal(withAnotherAttacker.left.kind, "count");
  assert.equal(withAnotherAttacker.left.subject, "other-attacking-units");
  // “another unit”：同位置的另一个己方单位（355.9.c 的 another、740.1.a 的 friendly），
  // 且由战斗身份限定为攻击者；锚点只用契约 3.6 的符号选择器。
  assert.deepEqual(withAnotherAttacker.left.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    sameLocationAs: "self",
    exclude: "self",
    combatRole: "attacker"
  });
});

test("unl-154-219 Crimson Pigeons: the attack set is queried by location, not by targets", () => {
  // 355.10.d：这类按特征程序化选出的集合不取目标；卡内因此没有 targets/picks，
  // 条件只用契约 3.6 的符号锚点（sameLocationAs/exclude）与 combatRole 维度描述。
  assert.equal(ability.targets, undefined);
  assert.equal(ability.picks, undefined);
  assert.equal(ability.effect.appliesTo, "self");
  // 同一位置上的“另一个单位”必须在判定时排除宿主自身（355.9.c 的 another 惯例）。
  const [, withAnotherAttacker] = ability.condition.conditions;
  assert.equal(withAnotherAttacker.left.filter.exclude, "self");
  assert.equal(withAnotherAttacker.left.filter.sameLocationAs, "self");
  // judgeReason 记录 CardProgram 快照与图层查询仍缺的接线。
  assert.match(program.judgeReason, /layers\/filter\.ts/);
});

test.todo(
  "unl-154-219 Crimson Pigeons: apply +2 Might in the arithmetic layer only while I am an attacker " +
    "with another unit at my location (CR 143.2.a / 479.4, 807.1.d / 466.2.c.3, 740.2.c, 355.9.c) — " +
  "the combat designation producer and the combatRole filter consumer still need to be wired"
);
test.todo(
  "unl-154-219 Crimson Pigeons: evaluate the sameLocationAs/exclude/other anchors and the controller " +
  "placeholder inside the layer filter (CR 355.9.c / 359.3.f) — sameLocationAs/exclude query anchors " +
  "are present, but combatRole and controller-relative static filtering still need complete consumption"
);

test("unl-154-219 Crimson Pigeons golden: the printed self-attack gate rejects a defender or an undesignated host", () => {
  assert.equal(ability.condition.kind, "all");
  const [selfAttacking] = ability.condition.conditions;
  assert.deepEqual(selfAttacking, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "combatRole" },
    operator: "eq",
    right: { kind: "constant", value: "attacker" }
  });
  for (const combatRole of ["attacker", "defender", null]) {
    const initial = world().unit("pigeons", { might: 3, combatRole }).build();
    const kernel = initial.clone({ sourceSnapshot: initial.getObject("pigeons") });
    const outcome = resolveChainBody([{
      id: "check-self-attacking",
      op: "condition.predicate",
      args: { condition: { kind: "constant", value: selfAttacking } }
    }], kernel);
    assert.equal(outcome.status, "executed");
    assert.equal(outcome.linkedValues["check-self-attacking.value"], combatRole === "attacker");
    assert.equal(kernel.getObject("pigeons").might, 3);
    assert.deepEqual(outcome.events, []);
  }
});
