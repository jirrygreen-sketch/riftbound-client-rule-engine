// Template execution evidence: ../templates/static-645.test.mjs.
// This card remains judge-required; the template covers the registered Assault
// grant while the dynamic value and attacker consumer remain pending.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/repair-specialist.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-210dea8c8d67186f11b18e71dd84b78b75323c6b47d01f2b60448fa17bf2ae8a";
const SOURCE_TEXT =
  "I have [Assault] equal to the number of gear you control. (+1 :rb_might: while I'm an " +
  "attacker for each instance of Assault.)";

const [grant] = program.abilities;
const gearCount = grant.effect.value;

/** 与程序相同的表达式，只把契约层的控制器占位符换成参考内核里真实存在的值。 */
const gearCountForKernel = () => ({ ...gearCount, filter: { ...gearCount.filter, controller: "A" } });

const evaluateGearCount = kernel =>
  resolveChainBody(
    [
      {
        id: "repair-specialist.gear-count",
        op: "condition.value",
        args: { value: gearCountForKernel(), key: { kind: "constant", value: "count" } }
      }
    ],
    kernel
  );

test("ven-076-166 Repair Specialist: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-076-166 Repair Specialist: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /combatRole/);
  assert.doesNotMatch(program.judgeReason, /RIFT-91|RIFT-81/);
});

test("ven-076-166 Repair Specialist: the grant is a static Assault declaration with a dynamic value", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  // 807.1.b.2 的 Assault Value；“I”（053.1）用 appliesTo: "self"。
  assert.equal(grant.effect.keyword, "Assault");
  assert.equal(grant.effect.appliesTo, "self");
  assert.deepEqual(grant.condition, { kind: "always" });
});

test("ven-076-166 Repair Specialist: the Assault value is the number of gear you control", () => {
  assert.equal(gearCount.kind, "count");
  assert.equal(gearCount.subject, "gear-you-control");
  // 355.9.a.1：“gear” 指 Board 上的 gear；“you control” 用控制器占位符。
  assert.deepEqual(gearCount.filter, { type: "gear", controller: "self", zone: "board" });
  // 807.1.c 的 “while I'm an attacker” 由已合入的关键词展开负责，不写在数值表达式里。
  assert.equal("sameLocationAs" in gearCount.filter, false);
});

test("ven-076-166 golden: the Assault value tracks the number of controlled gear", () => {
  for (const [gears, expected] of [[0, 0], [1, 1], [4, 4]]) {
    const builder = world().player("A");
    for (let index = 0; index < gears; index++) {
      builder.unit(`gear-${index}`, { types: ["gear"], controller: "A", zone: "board" });
    }
    const outcome = evaluateGearCount(builder.build());
    assert.equal(outcome.status, "executed", `gears=${gears}`);
    assert.equal(outcome.linkedValues["repair-specialist.gear-count.count"], expected, `gears=${gears}`);
  }
});

test("ven-076-166 golden: gear controlled by the opponent or outside the board is not counted", () => {
  const outcome = evaluateGearCount(
    world()
      .player("A")
      .unit("own-gear", { types: ["gear"], controller: "A" })
      .unit("enemy-gear", { types: ["gear"], owner: "B", controller: "B" })
      .hand("held-gear", { types: ["gear"], controller: "A" })
      .unit("yours-truly", { controller: "A", type: "unit" })
      .build()
  );
  assert.equal(outcome.linkedValues["repair-specialist.gear-count.count"], 1);
});

test.todo(
  "ven-076-166 Repair Specialist: granting the dynamic Assault value needs the layers engine to evaluate the " +
    "grant-keyword count expression and a consumer that turns granted Assault instances into +X Might arithmetic layers"
);
test.todo(
  "ven-076-166 Repair Specialist: Assault's attacker gate reads property \"designation\", but object snapshots only " +
    "carry combatRole (null by default in the test kernel), so the granted +X Might while attacking stays false"
);
