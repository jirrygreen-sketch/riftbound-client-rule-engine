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
  assert.match(program.judgeReason, /814\.1\.d/);
  assert.match(program.judgeReason, /815\.1\.c/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /RIFT-91/);
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
  "unl-036-219 Mutated Mouser: expand the card's keywords through the KeywordDef registry into layer " +
    "registrations (contract 3.5/3.7) — no card keyword consumer is merged (RIFT-91)"
);
test.todo(
  "unl-036-219 Mutated Mouser: read the Defender designation in the arithmetic layer so Shield 2 applies " +
    "only while defending (CR 814.1.d/814.1.d.1) — contract 3.8 combatRole is not in HEAD (RIFT-105)"
);
test.todo(
  "unl-036-219 Mutated Mouser: honour [Tank] when assigning combat damage (CR 815.1.b/815.1.c.1/.c.2) — " +
    "combat/base-combat-allocation.ts records 'No Tank/Backline/other assignment-priority requirement is bound here'"
);
