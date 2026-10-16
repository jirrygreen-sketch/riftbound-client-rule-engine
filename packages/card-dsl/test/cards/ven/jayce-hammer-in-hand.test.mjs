import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/jayce-hammer-in-hand.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import ganking from "../../../../engine-core/dist/effects/keywords/Ganking.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL =
  "card.hash-cb3b4ba5c7faf7ff8048c29675e218c4b9fa878972899ec9a88ecfb730c74cf2";
const SOURCE_TEXT =
  "When I become ready, choose one to give me this turn \u2014\n" +
  "[Assault 2] (+2 :rb_might: while I'm an attacker.)" +
  "[Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or ability.)" +
  "[Ganking] (I can move from battlefield to battlefield.)";

const [ability] = program.abilities;
const [modeChoice] = ability.body;
const modes = modeChoice.args.modes.value;
const [assault2, deflect2, gankingMode] = modes;

test("ven-088-166 Jayce, Hammer in Hand: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-088-166 Jayce: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /object-readied/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-088-166 Jayce: 'When I become ready' is a self-scoped object-readied trigger (416.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-readied");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-readied",
    filter: { source: "self" }
  });
  // 印文没有 “you may”：触发是强制的；模式选择属 355.3 的常规选择。
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
});

test("ven-088-166 Jayce: 'choose one' is a frozen choice.mode with three keyword-grant modes (355.3, 3.9)", () => {
  assert.equal(modeChoice.id, "jayce-hammer-in-hand.choose-one");
  assert.equal(modeChoice.op, "choice.mode");
  assert.deepEqual(modeChoice.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(modeChoice.args.different, { kind: "constant", value: true });
  assert.deepEqual(modes.map((entry) => entry.id), ["assault-2", "deflect-2", "ganking"]);
});

test("ven-088-166 Jayce: each mode grants exactly its printed keyword for this turn", () => {
  const grants = modes.map((entry) => entry.body[0]);
  assert.deepEqual(grants.map((instruction) => instruction.op), [
    "continuous.grant-keyword",
    "continuous.grant-keyword",
    "continuous.grant-keyword"
  ]);
  // 807.1.b / 809.1.b.2：Assault 与 Deflect 带印刷数值；810：Ganking 无数值。
  assert.deepEqual(grants.map((instruction) => instruction.args.keyword.value), [
    "Assault",
    "Deflect",
    "Ganking"
  ]);
  assert.deepEqual(grants.map((instruction) => instruction.args.value?.value), [2, 2, undefined]);
  // “this turn” 的到期期限（315.4 / 317.2.c 的回合结束清理）。
  for (const grant of grants) {
    assert.deepEqual(grant.args.duration, { kind: "constant", value: "this-turn" });
    // “give me”：自我指代不是目标选择（355.10.d/g），用符号选择器 source。
    assert.deepEqual(grant.args.object, {
      kind: "constant",
      value: { kind: "source" }
    });
    assert.equal(grant.targets, undefined);
    assert.equal(grant.picks, undefined);
  }
  // 关键词 id 必须对齐已注册的 KeywordDef（契约 3.7 / README 第 5 节）。
  assert.equal(keywordDefinitionsById.get("Assault"), assault);
  assert.equal(keywordDefinitionsById.get("Deflect"), deflect);
  assert.equal(keywordDefinitionsById.get("Ganking"), ganking);
  assert.deepEqual(assault2.body[0].args.keyword, { kind: "constant", value: "Assault" });
  assert.deepEqual(deflect2.body[0].args.keyword, { kind: "constant", value: "Deflect" });
  assert.deepEqual(gankingMode.body[0].args.keyword, { kind: "constant", value: "Ganking" });
});

test.todo(
  "ven-088-166 Jayce: the three timed keyword grants need the card-side continuous.grant-keyword instruction " +
    "(RIFT-91 layers entry point) — effects/instructions/ contains no such op"
);

test.todo(
  "ven-088-166 Jayce: the 'When I become ready' trigger runs end to end — needs a CardProgram → " +
    "TriggerRegistration subscriber so object-readied triggers enter the chain (RIFT-120)"
);

test.todo(
  "ven-088-166 Jayce: the granted keywords cannot take effect until their consumers exist — Assault's " +
    "continuous.might with the attacker designation (807.1.d.1), Deflect's target tax (809.1.c.1, RIFT-90) and " +
    "Ganking's continuous.movement permission (810.1.c, RIFT-91)"
);
