import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/forsaken-baccai.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-6f947454591d22ba8b13d37e0096d52966b2aa026047f0a31cb9dd1d80addb64";
const SOURCE_TEXT =
  "If you control fewer runes than an opponent at the start of your Beginning Phase, give me " +
  "+1 :rb_might: this turn.";

const [ability] = program.abilities;
const [grant] = ability.body;

/**
 * 参考内核按字面值比较 filter，而 IR 里的 "self"/"opponent" 是契约 3.6 的符号选择符；
 * 执行用例把这一处符号绑定到真实玩家 id；仅证明比较原语，生产 testTrigger 接线仍见 RIFT-359。
 */
function substitutePlayers(value, playerId, opponentId) {
  if (Array.isArray(value)) return value.map(item => substitutePlayers(item, playerId, opponentId));
  if (value === null || typeof value !== "object") {
    if (value === "self") return playerId;
    if (value === "opponent") return opponentId;
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substitutePlayers(item, playerId, opponentId)])
  );
}

/** 133.5.a.1 / 431.1：符文区里的 rune 才是「你控制的符文」。 */
function runeDeck(player, total) {
  return Array.from({ length: total }, (_, index) => `${player}-rune-${index + 1}`);
}

/** 给每名玩家建一个符文牌库，再按其 channeled 张数 channel（431.1）。 */
function runeZoneWorld({ aRuneDeck, aChanneled, bRuneDeck, bChanneled }) {
  const kernel = world()
    .rune(runeDeck("A", aRuneDeck), { owner: "A" })
    .rune(runeDeck("B", bRuneDeck), { owner: "B" })
    .build();
  for (const [player, amount] of [["A", aChanneled], ["B", bChanneled]]) {
    if (amount > 0) {
      assert.equal(kernel.perform({ type: "channel-rune", player, amount }).status, "done");
    }
  }
  return kernel;
}

/** 用真实解释器求值触发条件。 */
function evaluateCondition(condition, kernel) {
  const outcome = resolveChainBody(
    [
      {
        id: "gate",
        op: "condition.predicate",
        args: { condition: { kind: "constant", value: condition } }
      }
    ],
    kernel
  );
  assert.equal(outcome.status, "executed");
  return outcome.results[0].result.linkedValues.value;
}

test("ven-005-166 Forsaken Baccai: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-005-166 Forsaken Baccai: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /exists|存在/);
  assert.match(program.judgeReason, /beginning-start/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-005-166 Forsaken Baccai: beginning-start trigger with the rune-count condition (383.2.a.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 315.2.a.1：Beginning Step 开始时结算游戏效果；"your" 是控制者的回合。
  assert.equal(ability.trigger.at, "beginning-start");
  assert.deepEqual(ability.trigger.filter, { event: "beginning-start", player: "self" });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);

  // 383.2.a.1：紧跟触发条件的 "If you control fewer runes than an opponent" 属触发条件。
  const condition = ability.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "lt");
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "runes");
  assert.deepEqual(condition.left.filter, { type: "rune", controller: "self", zone: "rune-zone" });
  assert.equal(condition.right.kind, "count");
  assert.deepEqual(condition.right.filter, {
    type: "rune",
    controller: "opponent",
    zone: "rune-zone"
  });
});

test("ven-005-166 Forsaken Baccai: '+1 Might this turn' is a temporary arithmetic-layer modification", () => {
  assert.equal(grant.op, "continuous.might");
  // 143.2.a / 475–477：Might 修正在算术图层结算，期限是本回合（end-of-turn）。
  assert.deepEqual(grant.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "end-of-turn" });
  // 053.1 / 355.10.g："me" 是能力宿主，不是目标。
  assert.deepEqual(grant.args.objects, { kind: "constant", value: { kind: "source" } });
  assert.equal(grant.targets, undefined);
  assert.equal(grant.picks, undefined);
  assert.equal(grant.linkedTo, undefined);
  // 702/703：绝不写成 Buff 计数。
  assert.notEqual(grant.op, "effect.buff");
});

test("ven-005-166 Forsaken Baccai golden: the fewer-runes condition really evaluates (133.5.a.1 / 431.1)", () => {
  const condition = substitutePlayers(ability.trigger.condition, "A", "B");

  // 我方 2 个符文、对手 3 个："fewer runes than an opponent" 成立。
  const behind = runeZoneWorld({ aRuneDeck: 2, aChanneled: 2, bRuneDeck: 3, bChanneled: 3 });
  assert.equal(evaluateCondition(condition, behind), true);
  assert.equal(behind.query({ type: "rune", controller: "A", zone: "rune-zone" }).length, 2);
  assert.equal(behind.query({ type: "rune", controller: "B", zone: "rune-zone" }).length, 3);

  // 双方各 2 个：数量相等也不算「更少」。
  const tied = runeZoneWorld({ aRuneDeck: 2, aChanneled: 2, bRuneDeck: 2, bChanneled: 2 });
  assert.equal(evaluateCondition(condition, tied), false);
});

test("ven-005-166 Forsaken Baccai golden: runes still in the Rune Deck are not 'controlled' (431.1)", () => {
  const condition = substitutePlayers(ability.trigger.condition, "A", "B");
  // 我方 3 张符文留在符文牌库（一张都没 channel）：符文区为空、对手有 1 个，条件仍成立。
  const unchanneled = runeZoneWorld({ aRuneDeck: 3, aChanneled: 0, bRuneDeck: 1, bChanneled: 1 });
  assert.equal(unchanneled.query({ type: "rune", controller: "A", zone: "rune-zone" }).length, 0);
  assert.equal(evaluateCondition(condition, unchanneled), true);
});

test("ven-005-166 Forsaken Baccai golden: the body registers +1 Might on its host until turn end", () => {
  // The reference kernel uses the source snapshot to anchor { kind: source }.
  const sourceWorld = world().unit("baccai", { controller: "A", owner: "A", might: 2 }).build();
  const context = sourceWorld.clone({ sourceSnapshot: sourceWorld.getObject("baccai") });
  const outcome = resolveChainBody([grant], context);
  assert.equal(outcome.status, "executed");
  assert.equal(context.continuousEffects.length, 1);
  assert.equal(context.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(context.continuousEffects[0].effect.effect.amount, 1);
  assert.deepEqual(context.continuousEffects[0].duration, { type: "end-of-turn" });
});

test.todo(
  "ven-005-166 Forsaken Baccai: 'fewer runes than an opponent' in modes with three or more players " +
    "needs an existential quantifier over opponents; Condition/Expr can only compare two count " +
    "expressions, so the program records the two-player comparison (contract change request)"
);


test.todo(
  "ven-005-166 Forsaken Baccai: beginning-start trigger needs the production testTrigger condition " +
    "adapter and source-relative self/opponent rune count binding (RIFT-359; 383.2.a.1)"
);
