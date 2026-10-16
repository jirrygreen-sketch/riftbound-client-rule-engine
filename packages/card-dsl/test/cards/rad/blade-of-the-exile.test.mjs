import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/blade-of-the-exile.js";

const CARD_ID = "card.hash-d127ec787d0c328ab80a9aa29a656cd77a9dda6050627ec1bad17db1942c9853";
const SOURCE_TEXT =
  "[Equip] — :rb_rune_rainbow: or exhaust a friendly unit. (Pay the cost: Attach this to a unit you control.)";

test("rad-150-167 Blade of the Exile: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /cost\.exhaust/);
  assert.match(program.judgeReason, /RIFT-87/);
});

test("rad-150-167 Blade of the Exile: a single Equip keyword whose printed cost is a two-way choice", () => {
  assert.equal(program.abilities.length, 1);
  const [equip] = program.abilities;
  assert.equal(equip.kind, "keyword");
  // 与已合入 sfd Equip 卡同一小写 keyword id 约定。
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 1);
  // rainbow 符号 = 任意领域的一个 Power（135.2.e.5 / 135.2.e.5.a）。
  assert.equal(equip.costDomain, "rainbow");
  assert.deepEqual(equip.costAlternatives, [
    { kind: "power", domain: "rainbow", amount: 1 },
    { kind: "exhaust", target: "friendly-unit" }
  ]);
});

test("rad-150-167 Blade of the Exile: source text keeps the rainbow symbol and the reminder wording", () => {
  // “Pay the cost: Attach this to a unit you control.” 是提示文本（135.2.d.3 无游戏功能），
  // 原文逐字保留以便审查；程序不为提示文本生成任何能力。
  assert.equal(program.sourceText.includes(":rb_rune_rainbow:"), true);
  assert.equal(program.sourceText.includes("or exhaust a friendly unit"), true);
  assert.equal(program.abilities.length, 1);
});

test.todo(
  "rad-150-167 Blade of the Exile: Equip 展开无法表达印刷费用的二选一——Equip.ts 只展开单一 payments 费用，" +
    "“:rb_rune_rainbow: or exhaust a friendly unit” 需要费用层面的选择与 cost.exhaust 非标准费用" +
    "（RIFT-9 cost 组），依赖 RIFT-87 的 cost.activated / cost.pay 落地"
);
test.todo(
  "rad-150-167 Blade of the Exile: 非资源费用“exhaust a friendly unit”的候选单位是费用里的选择而非目标" +
    "（355.10.c / 355.10.c.1），需要费用侧对象选择（cost.exhaust + 选择收据）后才能执行"
);
test.todo(
  "rad-150-167 Blade of the Exile: Attach 到所选单位的实际附着（818.1.b / 818.1.b.2 / effect.attach）" +
    "与 818.1.c.4 的费用改写依赖 Equip 关键词展开与图层/费用管线"
);
