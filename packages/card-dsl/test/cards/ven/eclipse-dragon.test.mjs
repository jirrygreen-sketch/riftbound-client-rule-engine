import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/eclipse-dragon.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-1a78fcad592f4e6d0e197bc02ef40776f6c9174cfecb04adf5557fd446492ab9";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
  "When I move, if you control 4 or fewer runes, draw 1.";

const [accelerate, moved] = program.abilities;
const [draw] = moved.body;

/** 参考内核按字面值比较 filter；把契约 3.6 的玩家选择符绑定到真实玩家 id。 */
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

function runeZoneWorld({ aRuneDeck, aChanneled }) {
  const kernel = world()
    .rune(Array.from({ length: aRuneDeck }, (_, index) => `A-rune-${index + 1}`), { owner: "A" })
    .build();
  if (aChanneled > 0) {
    assert.equal(kernel.perform({ type: "channel-rune", player: "A", amount: aChanneled }).status, "done");
  }
  return kernel;
}

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

test("ven-016-166 Eclipse Dragon: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-016-166 Eclipse Dragon: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Accelerate/);
  assert.match(program.judgeReason, /805\.1\.b/);
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /optionalAdditional/);
  // Refreshed 2026-10-18: stale task citations (RIFT-120/RIFT-359) were replaced
  // with the technical gaps they stood for: the move-location payload and the
  // relative controller selector.
  assert.match(program.judgeReason, /move-location/);
  assert.match(program.judgeReason, /相对控制者选择符/);
  assert.match(program.judgeReason, /2026-10-18 复核/);
  assert.doesNotMatch(program.judgeReason, /RIFT-89/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-016-166 Eclipse Dragon: [Accelerate] is declared as a keyword ability, expansion not rewritten", () => {
  // 805.1.b：费用固定为 1 Energy + 1 Power，因此 keyword 不带 value；
  // 展开（accelerate.cost + 805.6 的入场就绪替代）归 effects/keywords/Accelerate.ts。
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
});

test("ven-016-166 Eclipse Dragon: the move trigger carries the 'four or fewer runes' trigger condition", () => {
  assert.equal(moved.kind, "triggered");
  // 421.1 / 449.1 / 449.2：成功完成的 Move 对应 object-moved。
  assert.equal(moved.trigger.at, "object-moved");
  assert.deepEqual(moved.trigger.filter, { event: "object-moved", filter: { source: "self" } });
  assert.equal(moved.trigger.once, undefined);
  assert.equal(moved.optional, false);

  // 383.2.a.1：紧跟触发条件的 "if you control 4 or fewer runes" 属触发条件（不是效果内条件）。
  const condition = moved.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "lte");
  assert.deepEqual(condition.right, { kind: "constant", value: 4 });
  assert.deepEqual(condition.left, {
    kind: "count",
    subject: "runes",
    filter: { type: "rune", controller: "self", zone: "rune-zone" }
  });
});

test("ven-016-166 Eclipse Dragon: the trigger body draws 1 from the controller's Main Deck (414.3)", () => {
  assert.equal(moved.body.length, 1);
  assert.equal(draw.id, "eclipse-dragon.draw-1");
  assert.equal(draw.op, "effect.draw");
  assert.deepEqual(draw.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(draw.targets, undefined);
  assert.equal(draw.picks, undefined);
  assert.equal(draw.linkedTo, undefined);
  assert.equal(draw.condition, undefined);
});

test("ven-016-166 Eclipse Dragon golden: the rune-count trigger condition really evaluates (383.2.a.1)", () => {
  const condition = substitutePlayers(moved.trigger.condition, "A", "B");

  const four = runeZoneWorld({ aRuneDeck: 4, aChanneled: 4 });
  assert.equal(evaluateCondition(condition, four), true);

  const five = runeZoneWorld({ aRuneDeck: 5, aChanneled: 5 });
  assert.equal(evaluateCondition(condition, five), false);

  // 未被 channel 的符文不算「控制」（431.1）。
  const unchanneled = runeZoneWorld({ aRuneDeck: 4, aChanneled: 0 });
  assert.equal(evaluateCondition(condition, unchanneled), true);
  assert.equal(unchanneled.query({ type: "rune", controller: "A", zone: "rune-zone" }).length, 0);
});

test("ven-016-166 Eclipse Dragon golden: the trigger body draws 1 through the real interpreter", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();
  const outcome = resolveChainBody(moved.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["eclipse-dragon.draw-1", "executed"]
  ]);
  // 414.1.a：从控制者主牌库顶抽 1。
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second-card"]);
  assert.equal(outcome.linkedValues["eclipse-dragon.draw-1.drawn"], 1);
  assert.deepEqual(outcome.events.map(event => event.action), ["draw"]);
});

test.todo(
  "ven-016-166 Eclipse Dragon: pay the 805.1.b Accelerate cost (1 Energy + 1 Fury Power) during " +
    "finalization and let the unit enter ready — keywords/Accelerate.ts expands the structure, but " +
    "no producer wires accelerate.cost into Finalize optionalAdditional (cost-plan itself supports the accelerate kind)"
);
test.todo(
  "ven-016-166 Eclipse Dragon: fire 'When I move' — program trigger translation already binds the source object ID, " +
    "but EVENT_PATTERN_TYPES excludes object-moved, so assertTriggerSpec rejects registration; the move-location " +
    "emission also lacks location payload, and the rune-count controller selector needs the relative controller selector"
);
