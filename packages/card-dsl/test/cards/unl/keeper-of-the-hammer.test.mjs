import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/keeper-of-the-hammer.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
// The chain adapter preserves primitive argument Exprs, the same way the merged
// chain engine invokes card-program bodies.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import xp from "../../../../engine-core/dist/effects/instructions/effect.xp.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-ae6f9827f6711f04a1ffb33df0b1a0152eef3c94d5b476705d8d3bdabc6e8453";
const SOURCE_TEXT = "When you hold, gain 1 XP.\nSpend 3 XP, :rb_exhaust:: Draw 1.";

const [holdGainXp, drawAbility] = program.abilities;
const [gainXp] = holdGainXp.body;
const [drawOne] = drawAbility.body;

test("unl-203-219 Keeper of the Hammer: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-203-219 Keeper of the Hammer: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /legend-zone/);
  assert.match(program.judgeReason, /107\.4/);
  assert.match(program.judgeReason, /cost\/payment\.ts/);
  // The merged halves are named as executable; the live gap is the Legend
  // object's zone in the exhaust payment.
  assert.match(program.judgeReason, /held 拼写/);
  assert.match(program.judgeReason, /cannot-pay-cost/);
  assert.equal(/待实现|需要裁定/.test(program.judgeReason), false);
});

test("unl-203-219 Keeper of the Hammer: 'When you hold, gain 1 XP' is one mandatory Hold Effect", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(holdGainXp.kind, "triggered");
  // 383.4.d.2.b: a Hold Effect that references the player holding (timing point
  // "hold", emitted by turn/flow.ts's Beginning scoring wave).
  assert.equal(holdGainXp.trigger.at, "hold");
  assert.deepEqual(holdGainXp.trigger.filter, { event: "held", player: "self" });
  assert.equal(holdGainXp.trigger.condition, undefined);
  assert.equal(holdGainXp.trigger.once, undefined);
  // The printed text has no "may", so the gain is forced.
  assert.equal(holdGainXp.optional, false);

  // 728 / 730.1 / 733: 1 XP to the ability controller (190.6.d).
  assert.equal(gainXp.id, "keeper-of-the-hammer.gain-xp");
  assert.equal(gainXp.op, "effect.xp");
  assert.deepEqual(gainXp.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(gainXp.targets, undefined);
  assert.equal(gainXp.picks, undefined);
});

test("unl-203-219 Keeper of the Hammer: 'Spend 3 XP, :rb_exhaust:' plus one Draw 1", () => {
  assert.equal(drawAbility.kind, "activated");
  assert.equal(drawAbility.timing, "action");
  // 404.1.a / 415.5: the printed cost is "Spend 3 XP, :rb_exhaust:".
  assert.deepEqual(drawAbility.cost, {
    kind: "activated",
    payments: [
      { kind: "xp", amount: { kind: "constant", value: 3 } },
      { kind: "exhaust", object: "self" }
    ]
  });
  assert.equal(drawAbility.restriction, undefined);

  // 414.3 / 414.1.a: "Draw 1" draws for the ability controller from the top of
  // their Main Deck.
  assert.equal(drawAbility.body.length, 1);
  assert.equal(drawOne.id, "keeper-of-the-hammer.draw");
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawOne.picks, undefined);
  assert.equal(drawOne.linkedTo, undefined);
});

test("unl-203-219 Keeper of the Hammer golden: the hold half gains exactly 1 XP", () => {
  const kernel = world().build();
  const run = runInstruction(xp, gainXp.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").xp, 1);
  assert.equal(kernel.player("B").xp, 0);
  assert.equal(run.linked.gained, 1);
  assert.equal(run.linked.gainedTo, "A");
  assert.deepEqual(run.events.map(event => event.action), ["gain-xp"]);
});

test("unl-203-219 Keeper of the Hammer golden: 'Spend 3 XP, exhaust me' pays through the merged cost pipeline", () => {
  const kernel = world()
    .player("A", { xp: 4 })
    .unit("poppy", {
      zone: "board",
      types: ["legend"],
      controller: "A",
      exhausted: false
    })
    .deck(["top-card", "bottom-card"])
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("poppy")) });
  const plan = buildCostPlan(ctx, { id: "keeper-of-the-hammer", cost: drawAbility.cost });
  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.xp, 3);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust", "spend-xp"]);
  assert.equal(ctx.player("A").xp, 1);
  assert.equal(ctx.object(ctx.ref("poppy")).exhausted, true);

  // The Draw 1 body runs through the merged interpreter with the program's own
  // data (effect.draw requires a raw Expr, so the primitive runner carries it —
  // the same split the merged goldens record).
  const run = runInstruction(draw, drawOne.args, { world: ctx });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.deepEqual(ctx.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(run.events.map(event => event.action), ["draw"]);
});

test("unl-203-219 Keeper of the Hammer golden: the printed body runs through the chain interpreter adapter", () => {
  // The gain-XP half executes the program's own instruction array through the
  // chain adapter, which keeps the primitive argument Exprs intact (the plain
  // interpreter evaluates args first, which effect.xp's schema does not accept —
  // the same convention split the merged goldens record).
  const kernel = world().build();
  const outcome = resolveChainBody(holdGainXp.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["keeper-of-the-hammer.gain-xp", "executed"]
  ]);
  assert.equal(kernel.player("A").xp, 1);
  assert.deepEqual(outcome.events.map(event => event.action), ["gain-xp"]);
});

test("unl-203-219 Keeper of the Hammer golden: the held subscription registers and the hold emission gains 1 XP through the chain", () => {
  // 383.4.d.2.b / 473.2.b: the closed `held` spelling registers against the
  // runtime `hold` point, so turn/flow.ts's Beginning Score wave reaches this
  // ability and the merged effect.xp body resolves through the real ChainEngine.
  return Promise.all([
    import("../../../../engine-core/dist/programs/index.js"),
    import("../../../../engine-core/dist/programs/triggers.js"),
    import("../../../../engine-core/dist/effects/testing/index.js"),
    import("../../../../engine-core/dist/events/action-adapter.js"),
    import("../../../../engine-core/dist/chain/engine.js")
  ]).then(([{ createProgramBinding }, { registerProgramTriggers, triggerRegistrations }, { world }, { createActionPipelineHost, bindResolveContext }, { ChainEngine }]) => {
    const binding = createProgramBinding({ cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }] });
    const kernel = world().unit("poppy", { cardId: CANONICAL_ID, types: ["legend"], might: null }).build();
    const source = kernel.getObject("poppy");
    const [registration] = triggerRegistrations(binding.registry, source);
    assert.equal(registration.spec.at, "hold");
    assert.deepEqual(registration.spec.filter, { event: "held", player: "self" });

    const host = createActionPipelineHost({
      checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
      restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
      objects: () => kernel.objects,
      perform: action => kernel.perform(action),
      choose: request => { throw new Error(`Unexpected choice ${request.id}`); },
      context: (snapshot, controller, timingPoint) => bindResolveContext(kernel, { source: snapshot, controller, timingPoint })
    });
    const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "beginning", host, cleanup: () => false });
    assert.deepEqual(registerProgramTriggers(binding.registry, engine, source), [`program:poppy:${source.ref.zoneEntryId}:0`]);

    engine.emit({ timingPoint: "hold", player: "A", details: { battlefieldId: "battlefield-1" } });
    assert.equal(engine.items.length, 1);
    engine.advance();
    let guard = 0;
    while (engine.items.length && guard++ < 20) engine.pass(engine.priority);
    assert.equal(kernel.player("A").xp, 1);
    assert.equal(kernel.player("B").xp, 0);
    assert.equal(engine.pipeline.events.filter(event => event.timingPoint === "xp-gained").length, 1);
  });
});

test("unl-203-219 Keeper of the Hammer gap: the same exhaust plan is unpayable while the legend sits in the Chain", () => {
  // CR 107.4.a/107.4.c: the legend is a Legend Zone object and must be able to
  // pay an exhaust cost. game/lifecycle.ts creates it in the Chain and only
  // records report.legendZone, so the merged payer rejects it.
  const kernel = world()
    .player("A", { xp: 4 })
    .unit("poppy", { zone: "board", types: ["legend"], controller: "A", exhausted: false })
    .build();
  kernel.perform({ type: "move-zone", object: kernel.ref("poppy"), to: "chain" });
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("poppy")) });
  assert.equal(ctx.object(ctx.ref("poppy")).zone, "chain");
  assert.throws(
    () => payCostPlan(ctx, buildCostPlan(ctx, { id: "keeper-of-the-hammer", cost: drawAbility.cost })),
    error => error?.reason === "cannot-pay-cost"
  );
  assert.equal(ctx.player("A").xp, 4);
  assert.equal(ctx.object(ctx.ref("poppy")).exhausted, false);
});

test("unl-203-219 Keeper of the Hammer golden: fewer than 3 XP fails the cost before any exhaust", () => {
  const kernel = world()
    .player("A", { xp: 2 })
    .unit("poppy", {
      zone: "board",
      types: ["legend"],
      controller: "A",
      exhausted: false
    })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("poppy")) });
  assert.throws(
    () => payCostPlan(ctx, buildCostPlan(ctx, { id: "keeper-of-the-hammer", cost: drawAbility.cost })),
    error => error?.reason === "cannot-pay-cost"
  );
  // 405 / 204.2.a: the failed plan paid nothing at all.
  assert.equal(ctx.player("A").xp, 2);
  assert.equal(ctx.object(ctx.ref("poppy")).exhausted, false);
});

test.todo(
  "unl-203-219 Keeper of the Hammer: pay the exhaust cost using the Legend in its Legend Zone and preserve " +
    "the same object identity (CR 107.4.a/107.4.c; ZoneId and exhaust-cost legality contract)"
);
test.todo(
  "unl-203-219 Keeper of the Hammer: the activated CardProgram body reaches the ChainDraft adapter once the " +
    "Legend object has a Legend Zone membership"
);
