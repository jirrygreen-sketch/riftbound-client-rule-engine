// The entry replacement and the cost collector each have real execution
// evidence below; the production joins that remain unavailable stay TODO.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/monch.js";
import { finalizeCostPlan } from "../../../../engine-core/dist/cost/discounts/index.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

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
  assert.match(program.judgeReason, /continuous\.cost-modification/);
  assert.match(program.judgeReason, /replacement\/bind\.ts/);
  assert.match(program.judgeReason, /369\.3/);
  // Replacement binding and its filter shape are merged; the remaining reason
  // is the conditional entry interception and the cost pipeline.
  assert.match(program.judgeReason, /Finalize/);
  assert.match(program.judgeReason, /entry interception/);
});

test("unl-035-219 Monch: the -2 energy discount is declared as a gated cost modification (CR 356.4)", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(costModification.kind, "static");
  assert.equal(costModification.effect.kind, "continuous.cost-modification");
  assert.equal(costModification.effect.resource, "energy");
  assert.deepEqual(costModification.effect.amount, { kind: "constant", value: -2 });
  // "self" is the current self-scope spelling; the remaining gap is the
  // missing CardProgram-to-Finalize production join, not the scope spelling.
  assert.equal(costModification.effect.appliesTo, "self");
  assert.equal(costModification.effect.filter, undefined);
});

test("unl-035-219 Monch: 'I enter ready' is a board-entry replacement, not a later effect.ready (143.4 / 369.3)", () => {
  assert.equal(enterReady.kind, "replacement");
  assert.deepEqual(enterReady.replaces, {
    event: "object-enters-board",
    filter: { self: true, exhausted: true }
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

test("unl-035-219 Monch golden: the merged replacement layer binds the declared entry replacement", () => {
  // The merged bindReplacement path accepts this card's { replaces, with } shape and
  // intercepts the board-entry move, correcting the orientation before the
  // permanent lands (CR 369.3 / 805.6). The binding is created with the real
  // chain fixture; the card's own declared body drives it.
  const f = fixture({ cards: [{ id: "monch", types: ["unit"], energy: 1, power: [], might: 6 }] });
  const bound = bindReplacement(
    { replaces: enterReady.replaces, with: enterReady.with },
    f.kernel.ref("monch"),
    {
      host: {
        object: ref => f.kernel.object(ref),
        objects: () => f.kernel.objects,
        context: (source, controller) => f.kernel.clone({ sourceSnapshot: source, controller })
      },
      pipeline: f.engine.pipeline
    }
  );
  assert.equal(bound.registration.id, "replacement:monch:1");

  f.engine.execute(f.card("monch", { kind: "unit", body: [] }));
  resolveAll(f.engine);
  const entered = f.kernel.getObject("monch");
  assert.equal(entered.zone, "board");
  assert.equal(entered.exhausted, false);
  // 805.6.a: the substitution never becomes a "becomes ready" event.
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-readied"), false);
});

test("unl-035-219 Monch: the printed condition is an opponent-scoped stunned-unit count", () => {
  const condition = enterReady.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.left.kind, "count");
  assert.deepEqual(condition.left.filter, {
    type: "unit",
    zone: "board",
    controller: "opponent",
    states: "stunned"
  });
  // The replacement binder's enter-action matcher uses self to identify the
  // object entering the board.
  assert.deepEqual(enterReady.replaces.filter, { self: true, exhausted: true });
});

test("unl-035-219 Monch: the two printed effects share the one passive condition (364.3.a)", () => {
  // Both halves are gated by the same lead-in clause, which the card states once
  // and reuses; the golden pins that they cannot drift apart.
  assert.equal(costModification.kind, "static");
  assert.equal(enterReady.kind, "replacement");
  assert.deepEqual(costModification.condition, enterReady.condition);
  // The production static binder wraps evaluateCondition; the remaining
  // consumers are Finalize discounts and conditional entry replacement.
  assert.equal(costModification.condition.kind, "compare");
  assert.deepEqual(costModification.condition.right, { kind: "constant", value: 1 });
});

test("unl-035-219 Monch golden: the merged cost collector applies the conditional -2 Energy discount and pays it", () => {
  const kernel = world()
    .player("A", { energy: 10 })
    .player("B")
    .hand("monch", { owner: "A", controller: "A", types: ["unit"], energy: 6, power: [] })
    .unit("stunned-enemy", { owner: "B", controller: "B", zone: "board", stunned: true })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("monch"), controller: "A" });
  const statics = [{ id: "monch:discount", source: context.ref("monch"), ability: costModification }];
  const plan = finalizeCostPlan(context, { id: "monch:play", cost: { kind: "printed" } }, { statics, purpose: "play" });

  assert.equal(plan.total.energy, 4);
  assert.equal(plan.printed.energy, 6);
  assert.equal(plan.discounts.length, 1);
  assert.equal(payCostPlan(context, plan).paid, true);
  assert.equal(context.player("A").energy, 6);

  context.perform({ type: "move-zone", object: context.ref("stunned-enemy"), to: "trash" });
  assert.equal(
    finalizeCostPlan(context, { id: "monch:play-again", cost: { kind: "printed" } }, { statics, purpose: "play" }).total.energy,
    6,
    "the condition is re-evaluated against the current board"
  );
});

test.todo(
  "unl-035-219 Monch: register the 'I enter ready' board-entry replacement before the zone change " +
    "(CR 143.4/359.2.c/369.3) — replacement/bind.ts binds this shape, but entry interception " +
    "does not evaluate the ability condition before applying the replacement; a post-entry effect.ready must not be substituted"
);
test.todo(
  "unl-035-219 Monch: evaluate 'if an opponent controls a stunned unit' on the entry replacement — replacement/bind.ts intercepts the chain entry before testCondition"
);
test.todo(
  "unl-035-219 Monch: fire the play-time cost modification and entry replacement from the real play flow " +
    "(CR 349/356)"
);
