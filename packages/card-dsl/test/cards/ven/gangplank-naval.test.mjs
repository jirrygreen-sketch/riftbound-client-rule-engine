import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/gangplank-naval.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL =
  "card.hash-b5e0e99c33e99ceb92c979c2c0f321e1350559022b999c6941a10dfd1d0d8508";
const SOURCE_TEXT =
  "[Empower] :rb_rune_body::rb_rune_body: (:rb_rune_body::rb_rune_body:: Empower me. " +
  "Use only if not Empowered.)\n" +
  "[Empowered][>] If a spell or ability that chooses me would stun me, give me -:rb_might:, " +
  "or return me to hand, give me +3 :rb_might: instead.";

const [empower, replacement] = program.abilities;
const [mightRider] = replacement.with;

test("ven-086-166 Gangplank, Naval: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-086-166 Gangplank: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /369/);
  assert.match(program.judgeReason, /return-to-hand|Return to Hand|return me to hand/);
  assert.match(program.judgeReason, /ACTION_KINDS/);
  assert.match(program.judgeReason, /BlockedReplacementError/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-086-166 Gangplank: [Empower] 2 Body Power stays a keyword declaration", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  // 827.1.c.1 的费用与“仅当未 Empowered 时”限制属于 KeywordDef 的展开
  //（README 第 5 节：卡文件只声明关键词身份，不自己重写展开）；展开依赖见 judgeReason。
});

test("ven-086-166 Gangplank: the Empowered clause is a would/instead replacement (369.1)", () => {
  assert.equal(replacement.kind, "replacement");
  // 被替代的事件是“一个选择我为目标的法术或能力把我 Stun”（424 的 stun 动作）。
  assert.deepEqual(replacement.replaces, {
    event: "stun",
    filter: { object: "self", chosenBy: "spell-or-ability" }
  });
  // 828.1.b.1 的依赖门槛：442.1.a 的二元状态不可求值，empoweredCount 只是描述性记录。
  assert.equal(replacement.condition.kind, "compare");
  assert.equal(replacement.condition.operator, "gte");
  assert.deepEqual(replacement.condition.right, { kind: "constant", value: 1 });
});

test("ven-086-166 Gangplank: the replacing instruction gives the source +3 Might", () => {
  assert.equal(replacement.with.length, 1);
  assert.equal(mightRider.id, "gangplank.give-plus-3-might");
  // 479.4.e.1 的算术层增加（“instead” 的替换结果）；op 未注册（见 judgeReason 第 3 条）。
  assert.equal(mightRider.op, "continuous.might");
  assert.deepEqual(mightRider.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(mightRider.args.duration, { kind: "constant", value: "this-turn" });
  // “me” 是能力宿主：契约 3.6 的符号选择器，不是 TargetSpec（355.10.d/g）。
  assert.deepEqual(mightRider.args.object, {
    kind: "constant",
    value: { kind: "source" }
  });
  assert.equal(mightRider.targets, undefined);
});

test.todo(
  "ven-086-166 Gangplank: [Empower] 2 Body Power activation (827.1.c.1 cost.activated + effect.empower, " +
    "'Use only if not Empowered') needs an Empower KeywordDef — none is merged"
);

test.todo(
  "ven-086-166 Gangplank: the three replaced outcomes ('would stun me, give me -:rb_might:, or return me to hand') " +
    "need pattern support: 'stun' is missing from replacement/pattern.ts ACTION_KINDS, chosenBy is not a discriminator, " +
    "and return-to-hand / Might-decrease have no EventPattern form, plus an Empowered status predicate for the " +
    "dependent gate (442.1.a, in-progress RIFT-359)"
);

test.todo(
  "ven-086-166 Gangplank: the '+3 :rb_might: instead' rider needs the replacement planner to accept the merged " +
    "continuous.might instruction as replacement body (currently BlockedReplacementError)"
);
