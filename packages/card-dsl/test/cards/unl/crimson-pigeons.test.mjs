import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/crimson-pigeons.js";
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
  assert.equal(ability.condition.kind, "compare");
  assert.equal(ability.condition.operator, "gte");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: 1 });
  assert.equal(ability.condition.left.kind, "count");
  assert.equal(ability.condition.left.subject, "other-attacking-units");
  // “another unit”：同位置的另一个己方单位（355.9.c 的 another、740.1.a 的 friendly），
  // 且由战斗身份限定为攻击者；锚点只用契约 3.6 的符号选择器。
  assert.deepEqual(ability.condition.left.filter, {
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
  assert.equal(ability.condition.left.filter.exclude, "self");
  assert.equal(ability.condition.left.filter.sameLocationAs, "self");
  // judgeReason 记录该条件不可诚实求值的原因（combatRole 缺席 + 图层条件未接线）。
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
