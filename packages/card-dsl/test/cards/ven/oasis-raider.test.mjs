import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/oasis-raider.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-53cec70ec57166a99b31590256f5edbab3c1ad0c9a311a661db2a5672c4ac0e9";
const SOURCE_TEXT =
  "If you control fewer runes than an opponent at the start of your Beginning Phase, give me " +
  "+2 :rb_might: and [Ganking] this turn. (I can move from battlefield to battlefield.)";

const [ability] = program.abilities;
const [mightGrant, keywordGrant] = ability.body;

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

function runeZoneWorld({ aRuneDeck, aChanneled, bRuneDeck, bChanneled }) {
  const kernel = world()
    .rune(Array.from({ length: aRuneDeck }, (_, index) => `A-rune-${index + 1}`), { owner: "A" })
    .rune(Array.from({ length: bRuneDeck }, (_, index) => `B-rune-${index + 1}`), { owner: "B" })
    .build();
  for (const [player, amount] of [["A", aChanneled], ["B", bChanneled]]) {
    if (amount > 0) {
      assert.equal(kernel.perform({ type: "channel-rune", player, amount }).status, "done");
    }
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

test("ven-006-166 Oasis Raider: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-006-166 Oasis Raider: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /beginning-start/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-006-166 Oasis Raider: beginning-start trigger with the rune-count condition (383.2.a.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "beginning-start");
  assert.deepEqual(ability.trigger.filter, { event: "beginning-start", player: "self" });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);

  const condition = ability.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "lt");
  assert.deepEqual(condition.left, {
    kind: "count",
    subject: "runes",
    filter: { type: "rune", controller: "self", zone: "rune-zone" }
  });
  assert.deepEqual(condition.right, {
    kind: "count",
    subject: "runes",
    filter: { type: "rune", controller: "opponent", zone: "rune-zone" }
  });
});

test("ven-006-166 Oasis Raider: the effect is +2 Might and Ganking for this turn, both on the host", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.op), [
    "continuous.might",
    "continuous.grant-keyword"
  ]);

  // 143.2.a / 475–477：+2 Might 是算术图层的临时修正（不是 Buff 计数）。
  assert.deepEqual(mightGrant.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(mightGrant.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(mightGrant.args.objects, { kind: "constant", value: { kind: "source" } });
  assert.equal(mightGrant.linkedTo, undefined);

  // 810：Ganking 的授予；053.1 的 "me" 是宿主，不是目标。
  assert.deepEqual(keywordGrant.args.keyword, { kind: "constant", value: "Ganking" });
  assert.deepEqual(keywordGrant.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(keywordGrant.args.objects, { kind: "constant", value: { kind: "source" } });
  assert.equal(keywordGrant.targets, undefined);
  // 两条指令作用于同一宿主、彼此没有结果依赖，因此不写 linkedTo（契约 3.2）。
  assert.equal(keywordGrant.linkedTo, undefined);
});

test("ven-006-166 Oasis Raider golden: the fewer-runes condition really evaluates (133.5.a.1 / 431.1)", () => {
  const condition = substitutePlayers(ability.trigger.condition, "A", "B");

  const behind = runeZoneWorld({ aRuneDeck: 2, aChanneled: 2, bRuneDeck: 4, bChanneled: 4 });
  assert.equal(evaluateCondition(condition, behind), true);
  assert.equal(behind.query({ type: "rune", controller: "A", zone: "rune-zone" }).length, 2);
  assert.equal(behind.query({ type: "rune", controller: "B", zone: "rune-zone" }).length, 4);

  const ahead = runeZoneWorld({ aRuneDeck: 4, aChanneled: 4, bRuneDeck: 2, bChanneled: 2 });
  assert.equal(evaluateCondition(condition, ahead), false);

  const tied = runeZoneWorld({ aRuneDeck: 3, aChanneled: 3, bRuneDeck: 3, bChanneled: 3 });
  assert.equal(evaluateCondition(condition, tied), false);
});

test.todo(
  "ven-006-166 Oasis Raider: fire at the start of the controller's Beginning Phase — no merged " +
    "module emits beginning-start into the single event pipeline and no subscriber registers the " +
    "CardProgram triggered ability as a TriggerRegistration (RIFT-120)"
);
test.todo(
  "ven-006-166 Oasis Raider: give +2 Might this turn — needs the card-side continuous.might " +
    "primitive (RIFT-9 inventory; RIFT-91 merged only the layer evaluator); never a Buff counter"
);
test.todo(
  "ven-006-166 Oasis Raider: grant [Ganking] for this turn — needs a duration-bounded " +
    "continuous.grant-keyword instruction (RIFT-91); the Ganking expansion exists but nothing " +
    "consumes the grant"
);
