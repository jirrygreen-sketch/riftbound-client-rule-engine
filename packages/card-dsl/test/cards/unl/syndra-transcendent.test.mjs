import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/syndra-transcendent.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-812a92a6459d7a30a0de5b9264ef8419c9504f128861e5de699812cd91d96ffc";
const SOURCE_TEXT =
  "While I'm in a showdown, your spells have [Repeat] :rb_energy_2::rb_rune_chaos:. " +
  "(You may pay the additional cost to repeat the spell's effect.)";

const [grant] = program.abilities;

test("unl-146-219 Syndra, Transcendent: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-146-219 Syndra, Transcendent: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /820\.1\.c/);
  assert.match(program.judgeReason, /Finalize/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /showdown/i);
});

test("unl-146-219 Syndra, Transcendent: one static keyword grant scoped to your spells", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  // 820.1.a：Repeat 出现在 Spells（与 Abilities）上；本卡把实例授予“你的咒语”。
  assert.equal(grant.effect.keyword, "repeat");
  assert.deepEqual(grant.effect.filter, {
    type: "spell",
    controller: "controller"
  });
});

test("unl-146-219 Syndra, Transcendent: the granted Repeat carries the printed cost (CR 820.1.c)", () => {
  // 820.1.c：格式为 “Repeat [Cost]”，费用是 2 Energy + 1 Chaos。承载通道应为
  // KeywordDef.expand 的 params.cost（契约 3.8.3），此处按 CostSpec 兼容形状记录意图。
  assert.deepEqual(grant.effect.cost, {
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: ["Chaos"] }
  });
});

test("unl-146-219 Syndra, Transcendent: 'while I'm in a showdown' stays an explicit predicate", () => {
  // 308 / 310.3 / 310.4 的 Showdown State 不是 ObjectSnapshot 特征；卡内以 expression 谓词记录，
  // 不写成恒真的 always 条件，也不省略（见 judgeReason）。
  assert.deepEqual(grant.condition, {
    kind: "expression",
    value: { kind: "constant", value: "in-showdown" }
  });
});

test.todo(
  "unl-146-219 Syndra, Transcendent: evaluate 'while I'm in a showdown' from the turn state " +
    "(CR 308 / 310.3 / 310.4) — no merged Condition can read the Showdown State"
);
test.todo(
  "unl-146-219 Syndra, Transcendent: grant [Repeat] to your spells through the ability layer " +
    "(CR 479.3) and feed the layer-granted keyword plus its printed cost into the spell's KeywordDef/Finalize path"
);
test.todo(
  "unl-146-219 Syndra, Transcendent: charge the granted Repeat's additional cost at play time and " +
    "repeat the spell's effect (CR 820.1.c.1 / 820.1.d.1 / 820.3) through the Repeat payment and paid-count consumer"
);
