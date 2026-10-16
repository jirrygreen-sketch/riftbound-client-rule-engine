import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/nasus-ascended.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

test("nasus-ascended: passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(
    program.canonicalCardId,
    "card.hash-2df5544ffea6f698095320fc6fa4ee6de200fc1053c9c5737ca847fc57e18b35"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or ability.)\n" +
      "[Empower] :rb_energy_8: (:rb_energy_8:: Empower me. Use only if not Empowered.)\n" +
      "[Empowered][>] When I conquer, you score 1 point."
  );
});

test("nasus-ascended: judgeReason names the missing keyword expansions and layers", () => {
  assert.match(program.judgeReason, /empower/i);
  assert.match(program.judgeReason, /empowered/i);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /828\.1\.c/);
  assert.match(program.judgeReason, /Deflect/);
  assert.match(program.judgeReason, /RIFT-83\/84/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("nasus-ascended: Deflect 2 and Empower 8 are declared as keywords, not expanded", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "deflect", value: 2 });
  assert.deepEqual(program.abilities[1], { kind: "keyword", keyword: "empower", value: 8 });
});

test("nasus-ascended: the Empowered dependent ability is a self-scoped conquer trigger", () => {
  const ability = program.abilities[2];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, {
    event: "conquer",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  // 383.4.c.2.c：征服得分被替代时触发仍然发生，所以不把得分成功写成触发条件。
  assert.equal(ability.trigger.once, undefined);
});

test("nasus-ascended: the body scores exactly 1 with a single unlinked instruction", () => {
  const ability = program.abilities[2];
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "nasus-ascended.score");
  assert.equal(instruction.op, "effect.score");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("nasus-ascended: the conquer body really scores 1 for the ability controller", () => {
  const ability = program.abilities[2];
  const kernel = world().player("A").build();
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").score, 1);
  assert.equal(kernel.player("B").score, 0);
  assert.deepEqual(outcome.linkedValues["nasus-ascended.score.scored"], [
    { player: "A", amount: 1 }
  ]);
});

test("nasus-ascended: the same body does not score for a non-controller", () => {
  const ability = program.abilities[2];
  const kernel = world().player("A").player("B").build();
  // 把控制者换成 B 后，"you score" 的隐含指向随之改变（190.6.d），
  // 仍然只有能力控制者得点。
  Object.defineProperty(kernel, "controller", { value: "B" });
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("B").score, 1);
  assert.equal(kernel.player("A").score, 0);
});

test.todo(
  "nasus-ascended: [Deflect 2] expansion through keywords/Deflect.ts plus the target.tax layer " +
    "consumer appending 2 Power of any Domain to an opposing spell that chooses this unit " +
    "(809.1.c/809.1.c.1/809.1.d; RIFT-90 + keyword registry)"
);
test.todo(
  "nasus-ascended: [Empower] 8 activation (827.1.c.1 cost.activated + effect.empower, " +
    "'play only if not Empowered' 827.1.c.5) and the Empowered-state gate on the dependent " +
    "ability (828.1.c; RIFT-83/84 keyword expansions + RIFT-91 layers)"
);
