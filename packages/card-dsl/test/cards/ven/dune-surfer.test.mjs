// Scenario execution evidence: ../templates/static-644.test.mjs (one parameterized row per card).
// This card stays judge-required; the template row pins the exact fail-closed binder error
// (relative opponent filter) behind the ignore-ability gap.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/dune-surfer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID =
  "card.hash-572dcb865d6640670e3cbdd7514ab6e44f7696e56a23583ebf73ce45d2a69cb0";
const SOURCE_TEXT = "You ignore [Tank] while assigning combat damage here.";

const [ability] = program.abilities;

test("ven-004-166 Dune Surfer: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-004-166 Dune Surfer: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // judgeReason 必须点名 764–767 的忽略语义缺口与真正的实现依赖。
  assert.match(program.judgeReason, /766\/767/);
  assert.match(program.judgeReason, /base-combat-allocation/);
  assert.match(program.judgeReason, /815\.1\.b/);
  assert.match(program.judgeReason, /layerFor/);
  // Re-checked against merged source: staticFilter rejects the relative
  // opponent filter before the missing layer mapping is even reached.
  assert.match(program.judgeReason, /staticFilter|relative-player/);
  assert.doesNotMatch(program.judgeReason, /RIFT-9\d/);
  assert.doesNotMatch(program.judgeReason, /RIFT-120/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-004-166 Dune Surfer: one static ignore effect scoped to combat damage assignment (765/766)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  const effect = ability.effect;
  // 766 的官方单位例子（"You ignore Backline while assigning combat damage here."）
  // 正是这一形状：唯一被描述的流程是战斗伤害分配。
  assert.equal(effect.kind, "continuous.ignore-ability");
  assert.equal(effect.operation, "combat-damage-assignment");
  assert.deepEqual(effect.ignores, ["Tank"]);
  // 767：只对能力指定的玩家（本卡控制者）生效。
  assert.equal(effect.players, "controller");
  // 053.3/766："here" 是来源当前所在地点，被忽略的是同一地点上的敌方 [Tank] 实例。
  assert.deepEqual(effect.filter, {
    type: "unit",
    controller: "opponent",
    zone: "board",
    sameLocationAs: "self"
  });
  // 本卡不是触发或启动能力；条件不属于本形状。
  assert.equal(ability.condition, undefined);
});

test.todo(
  "ven-004-166 Dune Surfer: ignore [Tank] while assigning combat damage at this unit's location " +
    "— no merged primitive registers an ignore-abilities continuous effect and combat/ never " +
    "consults an ignore set (CR 764-767; base-combat-allocation.ts records 'No Tank/Backline/other " +
    "assignment-priority requirement is bound here')"
);
test.todo(
  "ven-004-166 Dune Surfer: the ignored [Tank] assignment requirement itself (815.1.b/815.1.c.1/.c.2) " +
    "must be enforced by combat damage assignment — keywords/Tank.ts states the continuous.combat " +
    "consumer is not merged (Tank.ts records RIFT-258/259), so there is nothing to ignore yet"
);
test.todo(
  "ven-004-166 Dune Surfer: register the card-program static effect into the layers engine — " +
    "bindStaticToLayers exists but continuous.ignore-ability has no layerFor mapping, so binding " +
    "fails closed via attachLifecycle's swallowed ProgramBindingError"
);
