import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/pyke-returned.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-409271324918d19e0c793fcbe4bce41cb7805a7f78155c1a3a115ce79c2140c2";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Backline] (I must be assigned combat damage last.)\n" +
  "Once each turn, when an enemy unit dies while I'm at a battlefield, play a Gold gear token exhausted. " +
  '(It has "[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.")';

const [hidden, backline, diesTrigger] = program.abilities;
const [playGold] = diesTrigger.body;

test("unl-145-219 Pyke, Returned: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-145-219 Pyke, Returned: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Gold gear token/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /184\.1|185\.2\.d/);
  assert.match(program.judgeReason, /RIFT-62/);
  assert.match(program.judgeReason, /host\.testTrigger/);
  assert.match(program.judgeReason, /captured last-known|LKI/);
  assert.doesNotMatch(program.judgeReason, /触发注册生产方|没有生产方|RIFT-120/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("unl-145-219 Pyke, Returned: [Hidden] and [Backline] are declared, not re-implemented", () => {
  // 契约 3.7 / README 第 5 节：关键词只声明；811 的 cost.hidden 与 826 的伤害分配顺序由
  // effects/keywords/Hidden.ts、effects/keywords/Backline.ts 展开。
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.equal(hidden.value, undefined);
  assert.deepEqual(backline, { kind: "keyword", keyword: "backline" });
  assert.equal(backline.value, undefined);
});

test("unl-145-219 Pyke, Returned: 'once each turn' death trigger on an enemy unit", () => {
  assert.equal(diesTrigger.kind, "triggered");
  assert.equal(diesTrigger.optional, false);
  // 808.1.d / 429.1：死亡时点用封闭枚举的 object-killed。
  assert.equal(diesTrigger.trigger.at, "object-killed");
  assert.deepEqual(diesTrigger.trigger.filter, {
    event: "object-killed",
    // “an enemy unit dies”：事件对象是刚被消灭的单位，由本能力的对手控制（740.1.b）。
    object: { type: "unit", controller: "opponent" }
  });
  // 383.3.e.1：“Once each turn” 的每回合一次寿命（契约 3.5 的 TriggerSpec.once）。
  assert.equal(diesTrigger.trigger.once, "per-turn");
});

test("unl-145-219 Pyke, Returned: 'while I'm at a battlefield' is a pre-chain trigger condition", () => {
  // 383.2.a.1：紧跟触发条件的附加从句属于触发条件，不是效果的一部分。
  const condition = diesTrigger.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "objects");
  // 只用契约 3.6 的符号选择器（"self"）与位置拼写，不含运行时 ObjectRef。
  assert.deepEqual(condition.left.filter, {
    object: "self",
    location: "battlefield"
  });
});

test("unl-145-219 Pyke, Returned: the effect is one Gold-token play, with no target or pick", () => {
  assert.equal(diesTrigger.body.length, 1);
  assert.equal(playGold.id, "pyke-returned.play-gold-token");
  assert.equal(playGold.op, "effect.token");
  // 187.5 的 Gold 定义缺席（judgeReason）；440.2.c / 185.2.a 的“链上创建 + 打出”流程用 mode "play"。
  assert.deepEqual(playGold.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(playGold.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(playGold.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playGold.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.deepEqual(playGold.args.linkKey, { kind: "constant", value: "goldToken" });
  // “exhausted” 是入场状态规定（184.1 / 185.2.d），没有被写成事后 effect.exhaust 或额外 IR 键。
  assert.deepEqual(Object.keys(playGold.args).sort(), [
    "amount",
    "linkKey",
    "location",
    "mode",
    "token"
  ]);
  assert.equal(playGold.targets, undefined);
  assert.equal(playGold.picks, undefined);
  assert.equal(playGold.linkedTo, undefined);
});

test.todo(
  "unl-145-219 Pyke, Returned: Gold gear token definition with its printed ability (CR 187.5) — " +
    "effect.token's frozen table has no gold entry, so mode \"play\" has no executable path"
);
test.todo(
  "unl-145-219 Pyke, Returned: chain creation plus the cost-waived play handoff " +
    "(CR 440.2.c / 185.2.a / 350.2 / 354) — RIFT-62 follow-up"
);
test.todo(
  "unl-145-219 Pyke, Returned: exhausted entry stipulation on the created token " +
    "(CR 184.1 / 185.2.d / 143.4) — create-token supports no entry-state override"
);
test.todo(
  "unl-145-219 Pyke, Returned: register the 'once each turn' death trigger and evaluate the " +
    "'while I'm at a battlefield' condition against the source's last-known location before the " +
    "trigger is queued (CR 383.2.a.1 / 383.3.e.1, 808.1.d.3) — host.testTrigger and the " +
    "CardProgram -> TriggerRegistration/lifecycle path are merged; the remaining gap is binding " +
    "the captured last-known source location into the condition ResolveContext"
);
