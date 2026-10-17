// RIFT-662: execution evidence for this card lives in
// ../templates/activated-activated-continuous-grant-key-662.test.mjs.
// This file keeps the README §4.1 layer 1 (validation and identity) and layer 2
// (structure) checks; the card stays judge-required for the gap recorded in its
// judgeReason.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/eye-of-twilight.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";

const CANONICAL_ID =
  "card.hash-58b622a816049405488a25adae394668eeed8847e5a9ff884d3f09ce03886a4d";
const SOURCE_TEXT =
  "[Action][>] :rb_exhaust:: Give a friendly unit [Tank] this turn. " +
  "(It must be assigned combat damage first.)";

const [ability] = program.abilities;
const [grantTank] = ability.body;

test("ven-147-166 Eye of Twilight: validateCardProgram passes and identity is verbatim", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // 复核后的 judgeReason 只保留 815.1.b/815.1.c.2 的战斗伤害分配消费方。
  assert.match(program.judgeReason, /815\.1\.b/);
  assert.match(program.judgeReason, /continuous\.combat/);
  assert.match(program.judgeReason, /proven-none/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-147-166: [Action][>] with the printed Exhaust-only cost", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 806.1.d：[Action][>] 的许可按契约 3.1 记在 activated.timing。
  assert.equal(ability.timing, "action");
  // 204.1.b / 415.5：「:」前的 :rb_exhaust: 是 Exhaust 此来源的 Base Cost。
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
  // 本卡没有印刷 Energy / Power 费用：这两个字段不出现，绝不写成 0。
  assert.equal("energy" in ability.cost, false);
  assert.equal("power" in ability.cost, false);
});

test("ven-147-166: 'Give a friendly unit [Tank] this turn' is a duration-bounded keyword grant", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(grantTank.id, "eye-of-twilight.grant-tank");
  assert.equal(grantTank.op, "continuous.grant-keyword");
  assert.deepEqual(grantTank.args, {
    keyword: { kind: "constant", value: "Tank" },
    // “this turn” 是 end-of-turn 期限（317.1.a / 468.7.c）。
    duration: { kind: "constant", value: "this-turn" },
    // 契约 3.6 的符号选择器：continuous.grant-keyword 读 objects 里的 target 选择器。
    objects: { kind: "constant", value: { kind: "target", id: "eye-of-twilight.unit" } }
  });
  assert.equal(grantTank.linkedTo, undefined);
  assert.deepEqual(grantTank.targets, [
    {
      id: "eye-of-twilight.unit",
      // “a friendly unit”：单个由你控制的单位（355.9 / 355.10；359.3.e.7）。
      filter: { type: "unit", zone: "board", controller: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("ven-147-166: the Tank KeywordDef and grant primitive are registered", () => {
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), true);
  const tank = keywordDefinitionsById.get("Tank");
  assert.ok(tank, "the merged Tank KeywordDef must be registered");
  assert.equal(tank.valued, false);
  assert.equal(tank.stacking, "single");
  // 815.1.b/.c.2 的消费方仍是唯一剩余缺口；展开本身是 continuous.combat。
  const [expanded] = tank.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expanded.kind, "static");
  assert.equal(expanded.effect.kind, "continuous.combat");
  assert.equal(instructionDefinitionsById.has("continuous.combat"), true);
});

test.todo(
  "ven-147-166: [Tank] must be assigned combat damage first (CR 815.1.b / 815.1.c.2) — the Tank " +
    "KeywordDef expands to continuous.combat, but layers/engine.ts has no branch for it, " +
    "continuous.combat returns negated/impossible without a consumer, and combat/ only proves the " +
    "narrow path with keywordPriority: \"proven-none\""
);
