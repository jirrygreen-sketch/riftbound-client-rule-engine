import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/baron-nashor.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-f38d5cb54f004209cfc8fd9489817ccc83394ce2f7125972d8538d18c193cc6d";
const SOURCE_TEXT =
  "As you play me, add the Baron Pit battlefield token to the board if it's not there already. " +
  'If you do, I enter there. (It has "Units can move here from anywhere.")\n' +
  "I can't be chosen by enemy spells and abilities.\n" +
  "Other friendly units have +2 :rb_might:.";

const [play, enterThere, untargetable, otherUnits] = program.abilities;
const [addBaronPit] = play.body;
const [enterBaronPit] = enterThere.with;

test("unl-147-219 Baron Nashor: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-147-219 Baron Nashor: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /187\.9/);
  assert.match(program.judgeReason, /369\.3/);
  assert.match(program.judgeReason, /757/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-357/);
  assert.match(program.judgeReason, /exclude:source/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-147-219 Baron Nashor: 'as you play me' adds the Baron Pit token once", () => {
  // 355.1 / 355.1.a：“As you play me, …” 是打出本牌时作出的动作，按契约 3.1 的 play 能力书写。
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);
  assert.equal(addBaronPit.id, "baron-nashor.add-baron-pit");
  assert.equal(addBaronPit.op, "effect.token");
  // 187.9 的 Baron Pit 战场 token 定义缺席（见 judgeReason）。
  assert.deepEqual(addBaronPit.args.token, { kind: "constant", value: "baron-pit" });
  assert.deepEqual(addBaronPit.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(addBaronPit.args.mode, { kind: "constant", value: "create" });
  assert.deepEqual(addBaronPit.args.linkKey, { kind: "constant", value: "baronPit" });
  assert.equal(addBaronPit.linkedTo, undefined);
});

test("unl-147-219 Baron Nashor: 'if it's not there already' is an explicit existence gate", () => {
  // “add … if it's not there already”：已存在 Baron Pit 战场 token 时不再创建。
  const condition = addBaronPit.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "eq");
  assert.deepEqual(condition.right, { kind: "constant", value: 0 });
  assert.equal(condition.left.kind, "count");
  assert.deepEqual(condition.left.filter, {
    zone: "board",
    type: "battlefield",
    // tokenName 是描述性占位键（与 reksai-breacher 的 playedFromZoneNot 同一处理）：
    // 已合入的过滤器词汇没有“按 token 名称查战场”的维度。
    tokenName: "Baron Pit"
  });
});

test("unl-147-219 Baron Nashor: 'if you do, I enter there' is an entry replacement (CR 369.3)", () => {
  // 369.3 以本卡为“替代单位进场方式”的官方例子；契约 3.5 把替代建模为 replacement 能力。
  assert.equal(enterThere.kind, "replacement");
  assert.deepEqual(enterThere.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  assert.equal(enterThere.with.length, 1);
  assert.equal(enterBaronPit.id, "baron-nashor.enter-baron-pit");
  // replacement.enter 已有状态替代；location/ifCreated 仍待接入（369.3）。
  assert.equal(enterBaronPit.op, "replacement.enter");
  assert.deepEqual(enterBaronPit.args.location, {
    kind: "constant",
    value: { type: "battlefield", id: "baron-pit" }
  });
  assert.deepEqual(enterBaronPit.args.ifCreated, {
    kind: "constant",
    value: "baron-pit-created-this-play"
  });
  assert.equal(enterBaronPit.linkedTo, undefined);
});

test("unl-147-219 Baron Nashor: 'I can't be chosen by enemy spells and abilities' is a continuous restriction", () => {
  // 757 / 757.1 / 758：Untargetable 是被动能力，不是一个被选择的目标或一次性的状态改变。
  assert.equal(untargetable.kind, "static");
  assert.equal(untargetable.effect.kind, "continuous.restrict");
  assert.equal(untargetable.effect.operation, "target");
  assert.equal(untargetable.effect.forbidden, true);
  assert.equal(untargetable.effect.appliesTo, "self");
  assert.equal(untargetable.effect.chooser, "opponent");
  assert.equal(untargetable.condition, undefined);
});

test("unl-147-219 Baron Nashor: the team bonus is an arithmetic-layer +2 Might for other friendly units", () => {
  // 479.4 算术层；“other friendly units” 是程序化选出的集合（355.10.d），不取目标。
  assert.equal(otherUnits.kind, "static");
  assert.equal(otherUnits.effect.kind, "continuous.might");
  assert.equal(otherUnits.effect.mode, "add");
  assert.equal(otherUnits.effect.layer, "arithmetic");
  assert.deepEqual(otherUnits.effect.amount, { kind: "constant", value: 2 });
  assert.deepEqual(otherUnits.effect.filter, {
    zone: "board",
    type: "unit",
    controller: "controller",
    exclude: "source"
  });
  assert.equal(otherUnits.condition, undefined);
});

test.todo("baron-nashor: create one Baron Pit battlefield Location during As you play and bind its receipt to the entry destination (CR 187.9/355.1/369.3; RIFT-357)");

test.todo("baron-nashor: enforce target prohibition for enemy spells/abilities while preserving friendly targeting (CR 757.1/758.1)");

test.todo("baron-nashor: bind the live other-friendly-unit Might aura while excluding its own source (CR 479.4/355.10.d)");
