import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/monch.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-f6fc6f5dbe6ceebe1e128bfe16a67f81a7cc149370db212b7fbda2bbd71599e4";
const SOURCE_TEXT =
  "If an opponent controls a stunned unit, I cost :rb_energy_2: less and enter ready.";

const [costModification, enterReady] = program.abilities;
const [readySource] = enterReady.with;

test("unl-035-219 Monch: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-035-219 Monch: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /356\.4/);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /369\.3/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("unl-035-219 Monch: the -2 energy discount is declared as a gated cost modification (CR 356.4)", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(costModification.kind, "static");
  assert.equal(costModification.effect.kind, "continuous.cost-modification");
  assert.equal(costModification.effect.resource, "energy");
  assert.deepEqual(costModification.effect.amount, { kind: "constant", value: -2 });
  assert.equal(costModification.effect.appliesTo, "self-play-cost");
  assert.equal(costModification.effect.filter, undefined);
});

test("unl-035-219 Monch: 'I enter ready' is a board-entry replacement, not a later effect.ready (143.4 / 369.3)", () => {
  assert.equal(enterReady.kind, "replacement");
  assert.deepEqual(enterReady.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  // 369.3：入场替代由「描述单位如何入场」识别；effect.ready 只是 body 的形状，
  // 真正的替代执行由 events 管线的 replacement 消费者在换区前完成（见 judgeReason）。
  assert.deepEqual(enterReady.with.map((instruction) => [instruction.id, instruction.op]), [
    ["monch.enter-ready", "effect.ready"]
  ]);
  assert.deepEqual(readySource.args, { objects: { kind: "constant", value: { kind: "source" } } });
  assert.equal(readySource.targets, undefined);
  assert.equal(readySource.linkedTo, undefined);
});

test("unl-035-219 Monch: the shared 'opponent controls a stunned unit' condition is an opponent-scoped count", () => {
  // 424.1.a：Stunned 是二元状态；740.1.b：“对手”是能力控制者以外的玩家。
  for (const ability of [costModification, enterReady]) {
    const condition = ability.condition;
    assert.equal(condition.kind, "compare");
    assert.equal(condition.operator, "gte");
    assert.deepEqual(condition.right, { kind: "constant", value: 1 });
    assert.equal(condition.left.kind, "count");
    assert.equal(condition.left.subject, "units");
    assert.deepEqual(condition.left.filter, {
      type: "unit",
      zone: "board",
      controller: "opponent",
      states: "stunned"
    });
  }
});

test("unl-035-219 Monch golden: the declared replacement body readies the entering exhausted source", () => {
  const kernel = world().unit("monch", { zone: "board", exhausted: true, might: 6 }).build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("monch")) });
  const outcome = resolveChainBody([readySource], ctx);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["monch.enter-ready", "executed"]
  ]);
  assert.deepEqual(ctx.events.map((event) => event.action), ["ready"]);
  assert.equal(ctx.object(ctx.ref("monch")).exhausted, false);
});

test("unl-035-219 Monch golden: a source that already entered ready is not readied again (416.1.b/c)", () => {
  const kernel = world().unit("monch", { zone: "board", exhausted: false, might: 6 }).build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("monch")) });
  const run = runInstruction(ready, readySource.args, { world: ctx });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 0);
  assert.deepEqual(run.events, []);
});

test.todo(
  "unl-035-219 Monch: install the printed -2 energy discount into the play's finalized cost plan " +
    "(CR 356.4/356.4.a) — cost/cost-plan.ts only applies caller-supplied CostPlanInput.discounts and no " +
    "cost.modify instruction exists (RIFT-89)"
);
test.todo(
  "unl-035-219 Monch: register the 'I enter ready' board-entry replacement before the zone change " +
    "(CR 143.4/359.2.c/369.3) — no card ReplacementAbility consumer is merged (RIFT-9/RIFT-120); a " +
    "post-entry effect.ready must not be substituted"
);
test.todo(
  "unl-035-219 Monch: evaluate 'if an opponent controls a stunned unit' in the layer/trigger condition " +
    "path — layers/engine.ts conditionMatches treats unrecognised compare conditions as true (RIFT-91)"
);
test.todo(
  "unl-035-219 Monch: fire the play-time cost modification and entry replacement from the real play flow " +
    "(CR 349/356; RIFT-89/RIFT-120)"
);
