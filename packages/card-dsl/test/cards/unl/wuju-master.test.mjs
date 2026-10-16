import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/wuju-master.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-8b7f21bf0986b17b411aeaaeffd500931ea02096c94389c90265a214f7707ab4";
const SOURCE_TEXT =
  "[Level 6][>] Your units have +1 :rb_might:. (While you have 6+ XP, get the effect.)\n" +
  "[Level 11][>] Your units enter ready.";

const [levelSix, levelEleven] = program.abilities;
const enterReady = levelEleven.with[0];

test("unl-191-219 Wuju Master: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-191-219 Wuju Master: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /XP/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /replacement\.enter/);
});

test("unl-191-219 Wuju Master: [Level 6][>] is a static +1 Might layer scoped to your units", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(levelSix.kind, "static");
  // 824.1.b.1: functionally "while you have 6+ XP, this card gains '[Text]'".
  assert.equal(levelSix.effect.kind, "continuous.might");
  assert.equal(levelSix.effect.mode, "add");
  assert.equal(levelSix.effect.layer, "arithmetic");
  assert.deepEqual(levelSix.effect.amount, { kind: "constant", value: 1 });
  // "Your units": battlefield units controlled by the ability's controller.
  assert.deepEqual(levelSix.effect.filter, {
    zone: "board",
    type: "unit",
    controller: "controller"
  });
  // The XP gate: 824.1.c / 824.1.d; retained shape only (see judgeReason).
  assert.equal(levelSix.condition.kind, "compare");
  assert.equal(levelSix.condition.operator, "gte");
  assert.deepEqual(levelSix.condition.right, { kind: "constant", value: 6 });
  assert.equal(levelSix.condition.left.kind, "count");
  assert.equal(levelSix.condition.left.subject, "controller-xp");
});

test("unl-191-219 Wuju Master: [Level 11][>] is an enter-ready replacement gated on 11 XP", () => {
  assert.equal(levelEleven.kind, "replacement");
  // 143.4 / 359.2.c: units enter exhausted; this replaces that with ready entry
  // (as opposed to Accelerate 805.6, which is the same replacement shape).
  assert.deepEqual(levelEleven.replaces, {
    event: "object-enters-board",
    filter: { controller: "self", type: "unit", exhausted: true }
  });
  assert.equal(levelEleven.condition.kind, "compare");
  assert.equal(levelEleven.condition.operator, "gte");
  assert.deepEqual(levelEleven.condition.right, { kind: "constant", value: 11 });
  assert.equal(levelEleven.condition.left.subject, "controller-xp");
  assert.equal(levelEleven.with.length, 1);
  assert.equal(enterReady.id, "wuju-master.enter-ready");
  assert.equal(enterReady.op, "effect.ready");
  assert.deepEqual(enterReady.args.objects, {
    kind: "constant",
    value: { kind: "source" }
  });
});

test("unl-191-219 Wuju Master: the replacement body's effect.ready is merged and ready-resets an exhausted legend", () => {
  const kernel = world()
    .unit("yi", { zone: "board", types: ["legend"], controller: "A", exhausted: true })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("yi")) });
  const outcome = runAbilityBody([enterReady], ctx);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["wuju-master.enter-ready", "executed"]
  ]);
  assert.deepEqual(ctx.events.map(event => event.action), ["ready"]);
  assert.equal(ctx.object(ctx.ref("yi")).exhausted, false);

  // 416.1.b/416.1.c: an already-ready object is not readied again.
  // effect.ready's default selector is "source", so the kernel source is bound
  // to the legend through the clone used by runInstruction.
  const readyKernel = world()
    .unit("yi", { zone: "board", types: ["legend"], controller: "A", exhausted: false })
    .build();
  const readyCtx = readyKernel.clone({ sourceSnapshot: readyKernel.object(readyKernel.ref("yi")) });
  const noop = runInstruction(
    ready,
    { objects: { kind: "source" } },
    { world: readyCtx }
  );
  assert.equal(noop.result.status, "executed");
  assert.deepEqual(readyCtx.events, []);
  const direct = runInstruction(
    ready,
    { objects: { kind: "source" } },
    { world: readyCtx }
  );
  assert.equal(direct.result.status, "executed");
  assert.equal(direct.linked.readied.count, 0);
});

test("unl-191-219 Wuju Master: the 6-XP static gate cannot be evaluated with merged conditions", () => {
  // The retained condition reads a player-side XP value; the merged Condition
  // algebra and `count` expression only count queried objects, and
  // PlayerSnapshot.xp has no Expr path (see judgeReason). Asserting the shape
  // keeps the gap explicit without pretending it evaluates.
  assert.equal(levelSix.condition.left.filter.player, "controller");
  assert.equal(levelSix.effect.filter.controller, "controller");
});

test.todo(
  "unl-191-219 Wuju Master: expand [Level N][>] (CR 824.1.b.1: 'while you have N or more XP, this card gains [Text]') with dynamic Active/Inactive re-evaluation (824.1.c.1/.d) — no kw-level expansion is merged"
);
test.todo(
  "unl-191-219 Wuju Master: evaluate the 6+ XP predicate and apply +1 Might in the arithmetic layer for your units (RIFT-91 wiring + XP expression path)"
);
test.todo(
  "unl-191-219 Wuju Master: register the 'your units enter ready' board-entry replacement (replacement.enter family) — merged events only expose object-enters-board patterns and have no card ReplacementAbility consumer"
);
