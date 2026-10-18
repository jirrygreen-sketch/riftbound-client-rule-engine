// Golden test for Cleave (ogn-004-298) — layers 1 and 2 of cards/README §4
// (validation/identity and structure).
//
// Execution evidence (the real play through the generic card scenario harness:
// 1 Energy payment, locked board-unit target, ability-layer Assault 3 result and
// the empty-Board boundary) lives in the RIFT-681 parameterized template golden:
// test/cards/templates/keyword-play-continuous-grant-keyword-681.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/cleave.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL = "card.hash-e946abd159c3e001431a6266172cc524d41158117457180e81e85ef7690a4354";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Give a unit [Assault 3] this turn. (+3 :rb_might: while it's an attacker.)";

const [speed, play] = program.abilities;
const grantInstruction = play.body[0];
const targetSpec = grantInstruction.targets[0];

/** Registrations as the layer engine consumes them. */
const registrations = kernel => kernel.continuousEffects.map((entry, index) => ({
  ...entry,
  timestamp: index + 1
}));

test("ogn-004-298 Cleave: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  // The grant registers (executed below), but the granted Assault's functional
  // text still lacks re-expansion and designation-to-combatRole consumption.
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /二次展开|KeywordDef\.expand/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /combatRole/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ogn-004-298 Cleave structure: [Action] plus a duration-bounded Assault 3 grant to one unit", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map(instruction => [instruction.id, instruction.op]),
    [["cleave.grant-assault-3", "continuous.grant-keyword"]]
  );

  // The printed cost is 1 Energy; this printing has no Power value (null in the
  // catalog), so no Power component is declared — null is not rewritten as 0.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 }
  });
  assert.equal(Object.hasOwn(play.cost, "power"), false);

  // The grant names the printed keyword and value and the end-of-turn duration
  // (317.2.c); the keyword expansion itself belongs to the Assault KeywordDef.
  assert.deepEqual(grantInstruction.args.keyword, { kind: "constant", value: "Assault" });
  assert.deepEqual(grantInstruction.args.value, { kind: "constant", value: 3 });
  assert.deepEqual(grantInstruction.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grantInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "cleave.unit" }
  });
  assert.equal(grantInstruction.linkedTo, undefined);
  assert.equal(grantInstruction.picks, undefined);

  // "a unit" is a Choice of a specific Board game object (355.5/355.7/355.9.a.1).
  assert.equal(grantInstruction.targets.length, 1);
  assert.deepEqual(targetSpec, {
    id: "cleave.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ogn-004-298 Cleave golden: the grant registers Assault 3 on the chosen unit for this turn", () => {
  const kernel = world().unit("friendly-unit", { might: 2, buffs: 0 }).build();
  kernel.setTargets("cleave.unit", [kernel.ref("friendly-unit")]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["cleave.grant-assault-3", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  // 契约 3.4：关键词授予落在 ability 图层；317.1.a/468.7.c：this turn = end-of-turn 期限。
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.filter.objectId, "friendly-unit");
  assert.equal(registration.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registration.effect.effect.keyword, "Assault");
  assert.equal(registration.effect.effect.keywordValue, 3);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.deepEqual(outcome.linkedValues["cleave.grant-assault-3.granted"], {
    count: 1,
    objects: [kernel.ref("friendly-unit")]
  });
  // 非近似实现：没有 Buff 计数、没有直接 Might 修改。
  assert.equal(kernel.getObject("friendly-unit").buffs, 0);
  assert.equal(kernel.getObject("friendly-unit").might, 2);
});

test("ogn-004-298 Cleave golden: the granted Assault is a real layer keyword that expires at end of turn", () => {
  const kernel = world().unit("friendly-unit", { might: 2 }).build();
  kernel.setTargets("cleave.unit", [kernel.ref("friendly-unit")]);
  resolveChainBody(play.body, kernel);

  const engine = createLayerEngine([kernel.getObject("friendly-unit")], registrations(kernel));
  // 807.1/807.2：Assault 3 是接收者上的可读关键词特征，数值为 3。
  assert.deepEqual(engine.evaluate(kernel.ref("friendly-unit")).keywords, [
    { id: "Assault", value: 3 }
  ]);

  // 317.2.c：所有 "this turn" 效果在回合清理时同时到期。
  const expired = engine.expireAt("turn-end");
  assert.equal(expired.length, 1);
  assert.deepEqual(engine.evaluate(kernel.ref("friendly-unit")).keywords, []);
});

test("ogn-004-298 Cleave golden: a unit that already has Assault keeps it and the grant adds a valued instance", () => {
  // 807.2：多个来源授予的 Assault 相加；原语在已有带数值关键词时额外注册一条
  // arithmetic 伴随效果（continuous.keyword），而不是把旧值覆盖掉。
  const kernel = world().unit("friendly-unit", { might: 2, keywords: [{ id: "Assault", value: 1 }] }).build();
  kernel.setTargets("cleave.unit", [kernel.ref("friendly-unit")]);

  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  const engine = createLayerEngine([kernel.getObject("friendly-unit")], registrations(kernel));
  assert.deepEqual(engine.evaluate(kernel.ref("friendly-unit")).keywords, [
    { id: "Assault", value: 4 }
  ]);
});

test("ogn-004-298 Cleave golden: a target that left the Board is ignored, never rebound", () => {
  const kernel = world().unit("friendly-unit", { might: 2 }).build();
  const stale = kernel.ref("friendly-unit");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("cleave.unit", [stale]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.deepEqual(outcome.results.map(result => result.result), [
    { status: "ignored", reason: "mistargeted" }
  ]);
  assert.equal(kernel.continuousEffects.length, 0);
});

test.todo(
  "ogn-004-298 Cleave: [Action] admission on the controller's turn or in a Showdown " +
    "(CR 806.1.b/806.1.c) is chain-owned and exercised by the chain test suite"
);
test.todo(
  "ogn-004-298 Cleave: the granted Assault's +3 Might is computed by the merged Assault " +
    "KeywordDef (effects/keywords/Assault.ts) once the merged KeywordGrantLayerEngine re-expansion (which " +
    "aliases designation to combatRole) is attached to production assembly instead of the plain LayerEngine " +
    "(CR 807.1.c/807.1.d.1, combat flow)"
);
