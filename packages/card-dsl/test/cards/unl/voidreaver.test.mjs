import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/voidreaver.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import xp from "../../../../engine-core/dist/effects/instructions/effect.xp.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { TriggerSpecValidationError, EVENT_PATTERN_TYPES } from "../../../../engine-core/dist/events/trigger-spec.js";
import { isTimingPointId } from "../../../../engine-core/dist/events/timing-points.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-26b216537a1ea75534e8ac12dce51fb874287be073f54ce04f788aa43ab7c64e";
const SOURCE_TEXT =
  "When you win a combat, gain 1 XP.\n" +
  "Spend 1 XP, :rb_exhaust:: [Buff] a unit.\n" +
  "Spend 2 XP, :rb_exhaust:: Move an exhausted friendly unit from a battlefield to its base.";

const [combatWin, buffAbility, moveAbility] = program.abilities;
const [gainXp] = combatWin.body;
const [buffUnit] = buffAbility.body;
const [moveUnit] = moveAbility.body;

test("unl-201-219 Voidreaver: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-201-219 Voidreaver: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /combat-result/);
  assert.match(program.judgeReason, /468\.3\.a/);
  assert.match(program.judgeReason, /107\.4/);
  // The refreshed reason names the observed rejection surface instead of the
  // batch number of a finished task.
  assert.match(program.judgeReason, /invalid-event-type/);
  assert.doesNotMatch(program.judgeReason, /RIFT-/);
});

test("unl-201-219 Voidreaver: 'When you win a combat' subscribes to combat-result as the winner", () => {
  assert.equal(program.abilities.length, 3);
  assert.equal(combatWin.kind, "triggered");
  // 468.3.a / 468.3.b: winning a combat is the combat-result step's winner;
  // EventPattern.player "self" is the ability controller / winner.
  assert.equal(combatWin.trigger.at, "combat-result");
  assert.deepEqual(combatWin.trigger.filter, {
    event: "combat-result",
    player: "self"
  });
  assert.equal(combatWin.optional, false);
  assert.equal(combatWin.trigger.condition, undefined);

  // 728 / 730.1 / 733: gain 1 XP; the gainer defaults to the ability controller.
  assert.equal(gainXp.id, "voidreaver.gain-xp");
  assert.equal(gainXp.op, "effect.xp");
  assert.deepEqual(gainXp.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(gainXp.targets, undefined);
  assert.equal(gainXp.picks, undefined);
});

test("unl-201-219 Voidreaver: the two XP activations declare 'Spend N XP' plus Exhaust me", () => {
  assert.equal(buffAbility.kind, "activated");
  assert.equal(buffAbility.timing, "action");
  // 404.1.a: the printed cost is "Spend 1 XP, :rb_exhaust:".
  assert.deepEqual(buffAbility.cost, {
    kind: "activated",
    payments: [
      { kind: "xp", amount: { kind: "constant", value: 1 } },
      { kind: "exhaust", object: "self" }
    ]
  });
  assert.equal(buffAbility.restriction, undefined);

  assert.equal(moveAbility.kind, "activated");
  assert.equal(moveAbility.timing, "action");
  assert.deepEqual(moveAbility.cost, {
    kind: "activated",
    payments: [
      { kind: "xp", amount: { kind: "constant", value: 2 } },
      { kind: "exhaust", object: "self" }
    ]
  });
  assert.equal(moveAbility.restriction, undefined);
});

test("unl-201-219 Voidreaver: '[Buff] a unit' is one single chosen unit", () => {
  assert.equal(buffUnit.id, "voidreaver-1.buff-unit");
  assert.equal(buffUnit.op, "effect.buff");
  assert.deepEqual(buffUnit.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "voidreaver-1.unit" }
  });
  // 355.9 / 355.10: "a unit" is one unit chosen from the Board, so it targets.
  assert.deepEqual(buffUnit.targets, [
    {
      id: "voidreaver-1.unit",
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(buffUnit.picks, undefined);
  assert.equal(buffUnit.linkedTo, undefined);
});

test("unl-201-219 Voidreaver: the Move target keeps the exhausted / battlefield / friendly restrictions", () => {
  assert.equal(moveUnit.id, "voidreaver-2.move-unit");
  assert.equal(moveUnit.op, "effect.move");
  assert.deepEqual(moveUnit.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(moveUnit.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(moveUnit.args.objects, {
    kind: "constant",
    value: { target: "voidreaver-2.exhausted-friendly-unit" }
  });
  // 355.9 / 355.10: "an exhausted friendly unit" is one chosen target;
  // "from a battlefield" is a location restriction (355.9.b) and "exhausted"
  // is the state restriction (415.2).
  assert.deepEqual(moveUnit.targets, [
    {
      id: "voidreaver-2.exhausted-friendly-unit",
      filter: {
        type: "unit",
        zone: "board",
        controller: "controller",
        location: "battlefield",
        states: "exhausted"
      },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(moveUnit.picks, undefined);
  assert.equal(moveUnit.linkedTo, undefined);
});

test("unl-201-219 Voidreaver golden: the combat-win trigger's 1 XP instruction resolves", () => {
  const kernel = world().build();
  const run = runInstruction(xp, gainXp.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").xp, 1);
  assert.equal(kernel.player("B").xp, 0);
  assert.equal(run.linked.gained, 1);
  assert.equal(run.linked.gainedTo, "A");
  assert.deepEqual(run.events.map(event => event.action), ["gain-xp"]);
});

test("unl-201-219 Voidreaver golden: 'Spend 1 XP, exhaust me' pays through the merged cost pipeline", () => {
  const kernel = world()
    .player("A", { xp: 3 })
    .unit("khazix", {
      zone: "board",
      types: ["legend"],
      controller: "A",
      exhausted: false
    })
    .unit("ally", { might: 2, buffs: 0 })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("khazix")) });
  const plan = buildCostPlan(ctx, { id: "voidreaver-buff", cost: buffAbility.cost });
  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.xp, 1);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust", "spend-xp"]);
  assert.equal(ctx.player("A").xp, 2);
  assert.equal(ctx.object(ctx.ref("khazix")).exhausted, true);

  // The Buff half resolves on the locked unit after the payment.
  const buffRun = runInstruction(
    buff,
    { mode: buffUnit.args.mode.value, target: buffUnit.targets[0].id },
    { world: ctx, targets: { [buffUnit.targets[0].id]: [ctx.ref("ally")] } }
  );
  assert.equal(buffRun.result.status, "executed");
  assert.equal(ctx.object(ctx.ref("ally")).buffs, 1);
  assert.deepEqual(buffRun.events.map(event => event.action), ["buff"]);
});

test("unl-201-219 Voidreaver golden: 'Spend 2 XP, exhaust me' pays and the Move goes to the unit's base", () => {
  const kernel = world()
    .player("A", { xp: 2 })
    .unit("khazix", {
      zone: "board",
      types: ["legend"],
      controller: "A",
      exhausted: false
    })
    .unit("exhausted-ally", {
      zone: "board",
      controller: "A",
      exhausted: true,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("khazix")) });
  const plan = buildCostPlan(ctx, { id: "voidreaver-move", cost: moveAbility.cost });
  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.xp, 2);
  assert.equal(ctx.player("A").xp, 0);
  assert.equal(ctx.object(ctx.ref("khazix")).exhausted, true);

  const targetSpec = moveUnit.targets[0];
  const run = runInstruction(move, moveUnit.args, {
    world: ctx,
    targets: { [targetSpec.id]: [ctx.ref("exhausted-ally")] }
  });
  assert.equal(run.result.status, "executed");
  // 107.1.c / 448.1: the destination "its base" is the unit's controller's Base.
  assert.deepEqual(ctx.object(ctx.ref("exhausted-ally")).location, {
    type: "base",
    player: "A"
  });
  assert.deepEqual(run.linked.moved, {
    count: 1,
    objects: [{ id: "exhausted-ally", zoneEntryId: 1 }],
    movements: [
      {
        object: { id: "exhausted-ally", zoneEntryId: 1 },
        from: { type: "battlefield", id: "battlefield-1" },
        to: { type: "base", player: "A" }
      }
    ]
  });
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
});

test("unl-201-219 Voidreaver golden: insufficient XP fails the whole cost before any exhaust", () => {
  const kernel = world()
    .player("A", { xp: 1 })
    .unit("khazix", {
      zone: "board",
      types: ["legend"],
      controller: "A",
      exhausted: false
    })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("khazix")) });
  assert.throws(
    () => payCostPlan(ctx, buildCostPlan(ctx, { id: "voidreaver-move", cost: moveAbility.cost })),
    error => error?.reason === "cannot-pay-cost"
  );
  // 405 / 204.2.a: costs are all-or-nothing; the failed plan paid nothing.
  assert.equal(ctx.player("A").xp, 1);
  assert.equal(ctx.object(ctx.ref("khazix")).exhausted, false);
});

test("unl-201-219 Voidreaver gap: the combat-result trigger cannot be registered (closed event vocabulary)", () => {
  // EventPattern's closed vocabulary has no combat-result, so the production
  // pipeline rejects the card's subscription before any combat can occur. This is
  // the first observed half of the trigger gap in judgeReason.
  const { judgeReason: _reason, ...rest } = program;
  const binding = createProgramBinding({ cardPrograms: [{ ...rest, status: "executable" }] });
  const f = fixture({ describePlay: binding.describePlay });
  const source = { ...f.kernel.getObject("source"), cardId: CANONICAL_ID, name: "Voidreaver" };
  assert.throws(
    () => binding.registerProgramTriggers(f.engine, source),
    error => error instanceof TriggerSpecValidationError &&
      error.issues.some(issue => issue.path === "trigger.filter.event" && issue.code === "invalid-event-type")
  );
});

test("unl-201-219 Voidreaver gap: the timing point exists but is absent from the event vocabulary and has no producer", () => {
  // 468.3.a/468.3.b: winning is decided at the combat-result step. The timing
  // point is declared in timing-points.ts, yet EventPattern's closed vocabulary
  // omits it, and the merged combat flow emits only control/contested timings
  // while combat start and damage assignment stay blocked. Both halves are
  // asserted against the merged implementation here.
  assert.equal(isTimingPointId("combat-result"), true);
  assert.equal(EVENT_PATTERN_TYPES.includes("combat-result"), false);
  const f = fixture();
  const emitted = f.engine.pipeline.events.map(event => event.timingPoint);
  assert.deepEqual(emitted.filter(point => point === "combat-result"), []);
});

test.todo(
  "unl-201-219 Voidreaver: emit the combat-result timing point from the combat flow so 'When you win a combat' " +
    "can trigger (CR 468.3.a-468.4) — EventPattern's closed vocabulary still rejects combat-result, and the merged " +
    "combat/flow.ts emits only control/contested timings while start-combat plus damage assignment stay TurnCombatBlockedError"
);
test.todo(
  "unl-201-219 Voidreaver: represent the Legend itself as an exhaust-cost object — the frozen ZoneId has no " +
    "legend-zone and cost/payment.ts only accepts board / rune-zone payers (CR 107.4.a/107.4.c)"
);

test("unl-201-219 Voidreaver gap: the exhaust payment cannot be satisfied by the Legend's real zone", () => {
  // CR 107.4.a / 107.4.c: "Spend N XP, :rb_exhaust:" exhausts the Legend itself,
  // which lives in the Legend Zone. game/lifecycle.ts creates it on the Chain
  // because the frozen ZoneId (effects/contract.ts) has no legend-zone member,
  // and cost/payment.ts accepts only ready controlled board / rune-zone payers.
  // The golden runs the merged pipeline against that real zone and shows the
  // whole plan failing with cannot-pay-cost, while the XP half is untouched.
  const kernel = world()
    .player("A", { xp: 2 })
    .unit("legend", { zone: "chain", types: ["legend"], controller: "A", exhausted: false })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("legend")) });
  assert.equal(ctx.object(ctx.ref("legend")).zone, "chain");
  assert.throws(
    () => payCostPlan(ctx, buildCostPlan(ctx, { id: "voidreaver-legend", cost: buffAbility.cost })),
    error => error?.reason === "cannot-pay-cost"
  );
  // 405 / 204.2.a: the failed plan paid nothing, so the XP is still there and the
  // Legend was never exhausted.
  assert.equal(ctx.player("A").xp, 2);
  assert.equal(ctx.object(ctx.ref("legend")).exhausted, false);
});
