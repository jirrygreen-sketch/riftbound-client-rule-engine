import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/dame-the-despoiler.js";

const CANONICAL_ID =
  "card.hash-e48e6f95280cf803b6c17421f260f0c2e1b9e75ab27c4786c880d741b26084c9";
const SOURCE_TEXT =
  "[Empower] :rb_energy_5::rb_rune_body: (:rb_energy_5::rb_rune_body:: Empower me. Use only if not " +
  "Empowered.)\n" +
  "[Empowered][>] When I attack or defend, choose a unit here. Increase my Might to its Might " +
  "this turn, then give me +1 :rb_might: this turn.";

const [empower, attackTrigger, defendTrigger] = program.abilities;
const attackBody = attackTrigger.body;
const defendBody = defendTrigger.body;
const [setMight, plusOneMight] = attackBody;
const [defendSetMight, defendPlusOneMight] = defendBody;

test("ven-079-166 Dame the Despoiler: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-079-166 Dame the Despoiler: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /143\.2\.a\.1/);
  assert.match(program.judgeReason, /479\.4\.b/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("ven-079-166 Dame the Despoiler: [Empower] is declared without faking its printed cost", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(empower.value, undefined);
  // 827.1.c.1 的印刷费 5 Energy + 1 Body Power 无承载字段，不伪造启动能力。
  assert.equal(program.abilities.filter(ability => ability.kind === "activated").length, 0);
});

test("ven-079-166 Dame the Despoiler: 'When I attack or defend' is two independent combat triggers", () => {
  // 383.4.e 的 Attack Trigger 与 383.4.f 的 Defend Trigger 并列。
  assert.equal(attackTrigger.kind, "triggered");
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(attackTrigger.optional, false);
  assert.equal(attackTrigger.trigger.once, undefined);

  assert.equal(defendTrigger.kind, "triggered");
  assert.equal(defendTrigger.trigger.at, "defense-declared");
  assert.deepEqual(defendTrigger.trigger.filter, {
    event: "defense-declared",
    filter: { source: "self" }
  });
  assert.equal(defendTrigger.optional, false);
  assert.equal(defendTrigger.trigger.once, undefined);
});

test("ven-079-166 Dame the Despoiler: 'choose a unit here' is a real target spec (355.7/355.9)", () => {
  for (const [label, instruction] of [["attack", setMight], ["defend", defendSetMight]]) {
    assert.equal(instruction.op, "continuous.might", label);
    assert.equal(instruction.targets.length, 1, label);
    const [spec] = instruction.targets;
    assert.equal(spec.id, "dame-the-despoiler.unit-here", label);
    // “a unit here”：Board 上的单位，位置与来源相同。
    assert.deepEqual(spec.filter, { type: "unit", zone: "board", sameLocationAs: "self" }, label);
    assert.equal(spec.min, 1, label);
    assert.equal(spec.max, 1, label);
    assert.equal(spec.selection, "one", label);
    assert.equal(instruction.picks, undefined, label);
  }
});

test("ven-079-166 Dame the Despoiler: the set-to-its-Might then +1 sequence keeps both instructions independent", () => {
  for (const [label, set, plus] of [
    ["attack", setMight, plusOneMight],
    ["defend", defendSetMight, defendPlusOneMight]
  ]) {
    // 143.2.a.1 / 479.4.b：“Increase my Might to its Might this turn” 是算术图层的 set 修正。
    assert.deepEqual(set.args.mode, { kind: "constant", value: "set" }, label);
    assert.deepEqual(set.args.value, {
      kind: "object-property",
      object: { target: "dame-the-despoiler.unit-here" },
      property: "might"
    }, label);
    assert.deepEqual(set.args.duration, { kind: "constant", value: "this-turn" }, label);
    assert.deepEqual(set.args.object, { kind: "constant", value: { kind: "source" } }, label);

    // “then give me +1 :rb_might: this turn”：同层加值修正，与上一条独立
    // （359.3.e.14.b：前一条被否定不自动否定后续指令）。
    assert.deepEqual(plus.args.mode, { kind: "constant", value: "add" }, label);
    assert.deepEqual(plus.args.amount, { kind: "constant", value: 1 }, label);
    assert.deepEqual(plus.args.duration, { kind: "constant", value: "this-turn" }, label);
    assert.deepEqual(plus.args.object, { kind: "constant", value: { kind: "source" } }, label);
    assert.equal(plus.linkedTo, undefined, label);
    assert.equal(plus.targets, undefined, label);
  }
});

test("ven-079-166 Dame the Despoiler: both combat triggers share the same printed effect shape", () => {
  assert.deepEqual(
    attackBody.map(instruction => instruction.args),
    defendBody.map(instruction => instruction.args)
  );
  assert.deepEqual(
    attackBody.map(instruction => instruction.targets),
    defendBody.map(instruction => instruction.targets)
  );
  // 指令 id 在卡内唯一：两条触发不得复用同一批 id。
  assert.equal(
    attackBody.some(instruction => defendBody.some(other => other.id === instruction.id)),
    false
  );
});

test.todo(
  "ven-079-166 Dame the Despoiler: [Empower] expansion (827.1.c.1: 5 Energy + 1 Body Power, 'use only if not Empowered') and " +
    "the [Empowered][>] dependent ability (828.1.b.1) need an Empower/Empowered KeywordDef — none is merged"
);
test.todo(
  "ven-079-166 Dame the Despoiler: 'Increase my Might to its Might this turn' plus 'give me +1 :rb_might: this turn' " +
    "(143.2.a.1 / 479.4.b) need a card-side continuous.might registration with set mode — no such primitive is merged (RIFT-91)"
);
test.todo(
  "ven-079-166 Dame the Despoiler: the attack-declared / defense-declared subscriptions (383.4.e/383.4.f) need the " +
    "CardProgram → TriggerRegistration adapter and the combat emission path (RIFT-120)"
);
