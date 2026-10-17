import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/mutated-mouser.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL_ID =
  "card.hash-772d03e9b0b696718afe836a8028877765e2a10ff2fd39781dc7d52e3b05e8b8";
const SOURCE_TEXT =
  "[Shield 2] (+2 :rb_might: while I'm a defender.)\n" +
  "[Tank] (I must be assigned combat damage first.)";

const [shield, tank] = program.abilities;

test("unl-036-219 Mutated Mouser: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-036-219 Mutated Mouser: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The reason names the designation condition and combat allocation consumers.
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /conditionMatches/);
  assert.match(program.judgeReason, /814\.1\.d/);
  assert.match(program.judgeReason, /815\.1\.c/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+|未进 HEAD/);
});

test("unl-036-219 Mutated Mouser: the card only declares Shield 2 and Tank (contract 3.7)", () => {
  assert.equal(program.abilities.length, 2);
  // 814.1.b.2：印刷的 Shield Value 是 2。
  assert.deepEqual(shield, { kind: "keyword", keyword: "shield", value: 2 });
  // 815.1.b / 815.2：Tank 无数值，多实例冗余。
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });
  assert.equal(tank.value, undefined);
  // 卡文件不重写关键词展开：没有手写的 static / replacement 能力。
  assert.equal(program.abilities.some((ability) => ability.kind === "static"), false);
  assert.equal(program.abilities.some((ability) => ability.kind === "replacement"), false);
});

test("unl-036-219 Mutated Mouser: the merged Shield and Tank expansions match the printed reminder text", () => {
  const shieldDef = keywordDefinitionsById.get("Shield");
  const tankDef = keywordDefinitionsById.get("Tank");
  assert.ok(shieldDef, "the merged Shield KeywordDef is registered (CR 814)");
  assert.ok(tankDef, "the merged Tank KeywordDef is registered (CR 815)");
  assert.equal(shieldDef.stacking, "sum");
  assert.equal(tankDef.stacking, "single");

  // 814.1.c：Shield 2 展开成“当我是防守方时 +2 [M]”的条件图层修正。
  const [shieldExpansion] = shieldDef.expand({ value: 2, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(shieldExpansion.kind, "static");
  assert.equal(shieldExpansion.effect.kind, "continuous.might");
  assert.deepEqual(shieldExpansion.effect.amount, { kind: "constant", value: 2 });
  // 814.1.d：条件读 Defender designation（契约 3.8 的 combatRole，未进 HEAD）。
  assert.equal(shieldExpansion.condition.left.property, "designation");
  assert.deepEqual(shieldExpansion.condition.right, { kind: "constant", value: "defender" });

  // 815.1.c：Tank 展开成战斗伤害分配优先级要求（continuous.combat），无层/战斗消费方。
  const [tankExpansion] = tankDef.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(tankExpansion.kind, "static");
  assert.equal(tankExpansion.effect.kind, "continuous.combat");
  assert.equal(tankExpansion.effect.priority, "first");
});

test.todo(
  "unl-036-219 Mutated Mouser: evaluate the Defender designation in the arithmetic layer so Shield 2 applies " +
    "only while defending (CR 814.1.d/814.1.d.1) by wiring combatRole reads and designation transactions"
);
test.todo(
  "unl-036-219 Mutated Mouser: consume [Tank]'s lethal-first priority while assigning combat damage " +
    "(CR 815.1.b/815.1.c.1/.c.2) in the combat allocation workflow"
);

test("unl-036-219 Mutated Mouser: every declared keyword resolves to a merged KeywordDef (contract 3.5/3.7)", () => {
  // The card only declares keywords; programs/keywords.ts's expandProgram is the
  // merged consumer that resolves each declaration through the registry. A
  // declaration with no KeywordDef throws ProgramBindingError there, so this
  // pins the card's contract-3.7 surface against the merged registry.
  for (const ability of program.abilities) {
    assert.equal(ability.kind, "keyword");
    const definition = [...keywordDefinitionsById.entries()]
      .find(([id, def]) => id.toLowerCase() === ability.keyword.toLowerCase()
        || def.keyword.toLowerCase() === ability.keyword.toLowerCase());
    assert.ok(definition, `the merged registry must define ${ability.keyword}`);
  }
  // 814.1.b.2: the printed Shield Value is 2, carried by the card declaration.
  assert.equal(shield.value, 2);
  // 815.1.b / 815.2: Tank carries no value and is redundant in multiples.
  assert.equal(tank.value, undefined);
});
