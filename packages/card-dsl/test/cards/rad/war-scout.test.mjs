import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/war-scout.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const MIGHT_BODY = "war-scout.give-plus-2-might";
const MIGHT_TARGET = "war-scout.unit";

test("rad-008-167 War Scout: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.canonicalCardId,
    "card.hash-d81d427199a8fc8e3fb295ca97af6524da92927058f329c1bb53fd0c95837bfa"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
      "When you play me, give a unit +2 :rb_might: this turn."
  );
  assert.match(program.judgeReason, /Accelerate/);
  assert.match(program.judgeReason, /continuous\.might/);
});

test("rad-008-167: keyword declaration plus card-played trigger with a +2 Might effect", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, triggered] = program.abilities;
  assert.deepEqual(keyword, { kind: "keyword", keyword: "accelerate" });

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { self: true });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);

  const [instruction] = triggered.body;
  assert.equal(instruction.id, MIGHT_BODY);
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  // “a unit” 是任意单位的目标选择（352/355.9），min=max=1。
  assert.equal(instruction.targets.length, 1);
  const [spec] = instruction.targets;
  assert.equal(spec.id, MIGHT_TARGET);
  assert.deepEqual(spec.filter, { zone: "board", type: "unit" });
  assert.equal(spec.min, 1);
  assert.equal(spec.max, 1);
  assert.equal(spec.selection, "one");
});

test("rad-008-167: continuous.might is not a registered primitive (no approximation executed)", () => {
  // 真实执行卡牌 body 会抛“未注册 opcode”，而不是被改写成 Buff counter 之类近似物；
  // 这条负面证据把“缺口存在”固定下来，TODO 依赖落地后必须换成真实执行断言。
  const kernel = world().unit("war-scout", { might: 2 }).unit("other", { might: 3 }).build();
  kernel.setTargets(MIGHT_TARGET, [kernel.ref("other")]);
  assert.throws(
    () => resolveChainBody(program.abilities[1].body, kernel),
    /Unregistered instruction opcode: continuous\.might/
  );
  assert.equal(kernel.getObject("other").might, 3);
  assert.equal(kernel.getObject("other").buffs, 0);
});

test.todo(
  "rad-008-167 War Scout: 临时 Might 修正 “give a unit +2 :rb_might: this turn” 依赖已注册的" +
    "continuous.might 与图层/期限系统（RIFT-91 layers-continuous）；effect.buff 不覆盖临时 Might（702/703）"
);
test.todo(
  "rad-008-167 War Scout: [Accelerate] 展开（805.1.b 附加费 [1][Fury] 与 805.6 入场就绪替代）" +
    "依赖 cost.additional / cost.pay 与 replacement.enter 管线（RIFT-89~91）"
);
