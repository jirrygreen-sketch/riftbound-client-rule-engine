import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/arena-kingpin.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan, prepareCostPayment } from "../../../../engine-core/dist/cost/payment.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-42a7a3191d0a9e6cd6ac270c7dc6e9f36ee510fbfccf82e3b005ffd797864187";
const SOURCE_TEXT = "I enter ready.\n:rb_exhaust:: Give a unit +3 :rb_might: this turn.";

const [enterReady, activated] = program.abilities;
const [grantMight] = activated.body;
const targetSpec = grantMight.targets[0];

test("unl-001-219 Arena Kingpin: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-001-219 Arena Kingpin: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /369\.3/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /415\.5/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("unl-001-219 Arena Kingpin: 'I enter ready' is an entry replacement, not a post-entry ready", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(enterReady.kind, "replacement");
  // 143.4 / 359.2.c: units enter the Board exhausted; 369.3 describes the
  // replacement by how the unit enters, filtered to this card's own entry.
  assert.deepEqual(enterReady.replaces, {
    event: "object-enters-board",
    filter: { self: true, exhausted: true }
  });
  assert.equal(enterReady.condition, undefined);
  assert.equal(enterReady.with.length, 1);
  assert.equal(enterReady.with[0].id, "arena-kingpin.enter-ready");
  assert.equal(enterReady.with[0].op, "effect.ready");
  assert.deepEqual(enterReady.with[0].args.objects, {
    kind: "constant",
    value: { kind: "source" }
  });
});

test("unl-001-219 Arena Kingpin: the printed cost is 'Exhaust me' at Action speed", () => {
  assert.equal(activated.kind, "activated");
  // 145.2 / 377.1: a colon after the cost introduces the activated ability; no
  // [Reaction] is printed, so it uses the default Action timing.
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
  // 415.5: [E] is the "Exhaust this" cost; there is no printed Energy cost and
  // the omitted Energy is never written as 0.
  assert.equal(activated.cost.energy, undefined);
  assert.equal(activated.restriction, undefined);
});

test("unl-001-219 Arena Kingpin: 'Give a unit +3 Might this turn' targets one unit on the Board", () => {
  assert.deepEqual(activated.body.map(instruction => instruction.id), ["arena-kingpin.grant-might"]);
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.mode, { kind: "constant", value: "add" });
  assert.deepEqual(grantMight.args.layer, { kind: "constant", value: "arithmetic" });
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  // 355.9 / 355.10: "a unit" is chosen by the controller, so it is a target and
  // not a pick; no controller restriction is printed.
  assert.deepEqual(targetSpec, {
    id: "arena-kingpin.unit",
    filter: { zone: "board", type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(grantMight.picks, undefined);
  assert.equal(grantMight.linkedTo, undefined);
});

test("unl-001-219 Arena Kingpin: the printed 'Exhaust me' cost is payable through the merged cost pipeline", () => {
  const kernel = world()
    .player("A", { energy: 3 })
    .unit("kingpin", { zone: "board", types: ["unit"], controller: "A", exhausted: false })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("kingpin")) });
  const plan = buildCostPlan(ctx, { id: "arena-kingpin", cost: activated.cost });
  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.energy, 0);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
  assert.equal(ctx.object(ctx.ref("kingpin")).exhausted, true);
  assert.equal(ctx.player("A").energy, 3);
});

test("unl-001-219 Arena Kingpin: an already-exhausted source cannot pay the cost (CR 415.4)", () => {
  const kernel = world()
    .unit("kingpin", { zone: "board", types: ["unit"], controller: "A", exhausted: true })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("kingpin")) });
  const plan = buildCostPlan(ctx, { id: "arena-kingpin", cost: activated.cost });
  assert.throws(() => prepareCostPayment(ctx, plan), CostPlanError);
  assert.equal(ctx.object(ctx.ref("kingpin")).exhausted, true);
});

test("unl-001-219 Arena Kingpin: effect.ready in the replacement body readies the source", () => {
  // The replacement body's instruction uses a registered primitive and the
  // contract 3.6 symbolic selector; the entry-replacement pipeline that would
  // register and run it during board entry is still missing (judgeReason).
  const kernel = world()
    .unit("kingpin", { zone: "board", controller: "A", exhausted: true })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("kingpin")) });
  const outcome = runAbilityBody(enterReady.with, ctx);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["arena-kingpin.enter-ready", "executed"]
  ]);
  assert.deepEqual(ctx.events.map(event => event.action), ["ready"]);
  assert.equal(ctx.object(ctx.ref("kingpin")).exhausted, false);

  // 416.1.b/416.1.c: an already-ready object is not readied again.
  const readyKernel = world()
    .unit("kingpin", { zone: "board", controller: "A", exhausted: false })
    .build();
  const readyRun = runInstruction(
    ready,
    { objects: { kind: "source" } },
    { world: readyKernel.clone({ sourceSnapshot: readyKernel.object(readyKernel.ref("kingpin")) }) }
  );
  assert.equal(readyRun.result.status, "executed");
  assert.equal(readyRun.linked.readied.count, 0);
  assert.deepEqual(readyRun.events, []);
});

test("unl-001-219 Arena Kingpin: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test.todo(
  "unl-001-219 Arena Kingpin: unique effect.ready +3 Might until end of turn through the arithmetic layer " +
    "(CR 143.2.a / 475) and every merged instruction of the body through runAbilityBody"
);

test.todo(
  "unl-001-219 Arena Kingpin: register 'I enter ready' as a board-entry replacement (CR 143.4 / 359.2.c / 369.3) — " +
    "no merged consumer turns a card's ReplacementAbility into a pipeline replacement (RIFT-89~91)"
);

test.todo(
  "unl-001-219 Arena Kingpin: resolve 'Give a unit +3 Might this turn' through continuous.might with an end-of-turn " +
    "duration (CR 143.2.a / 475) — no merged primitive or layer consumer accepts the card body's continuous effect (RIFT-91)"
);
