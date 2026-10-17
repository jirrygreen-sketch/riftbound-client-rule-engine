import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/nami-headstrong.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import stun from "../../../../engine-core/dist/effects/instructions/effect.stun.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-a9a744726a85225a5f09812cc8545795d64c7f24f2a06e46af7895230c6deeb2";
const SOURCE_TEXT =
  "You may pay :rb_rune_calm: as an additional cost to play me.\n" +
  "When you play me, if you paid the additional cost, [Stun] an enemy unit. (It doesn't deal combat damage this turn.)\n" +
  "When I hold, the next time you play a unit this turn, ready it and [Buff] it.";

const [additionalCost, playTrigger, holdTrigger] = program.abilities;
const [stunEnemy] = playTrigger.body;
const [enemySpec] = stunEnemy.targets;
const [delayedNextUnit] = holdTrigger.body;
const [readyPlayedUnit, buffPlayedUnit] = delayedNextUnit.args.body.value;

test("unl-052-219 Nami, Headstrong: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-052-219 Nami, Headstrong: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /356\.2\.b/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
});

test("unl-052-219 Nami, Headstrong: the optional additional cost is declared with 1 Calm Power (356.2.b.1)", () => {
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal(additionalCost.effect.optional, true);
  assert.equal(additionalCost.effect.appliesTo, "self");
  assert.equal(additionalCost.effect.stage, "optional-additional");
  assert.deepEqual(additionalCost.effect.payments, [
    {
      kind: "power",
      amount: { kind: "constant", value: 1 },
      allowedDomains: ["Calm"]
    }
  ]);
  assert.equal(additionalCost.condition, undefined);
});

test("unl-052-219 Nami, Headstrong: 'if you paid the additional cost' is retained as a trigger condition (383.2.a.1)", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  // The receipt of an optional additional cost (356.4.f.1) has no merged
  // Condition form; the retained count shape cannot evaluate it, so the merged
  // kernel never runs the Stun unconditionally.
  assert.equal(playTrigger.trigger.condition.kind, "compare");
  assert.equal(playTrigger.trigger.condition.operator, "gte");
  assert.equal(playTrigger.trigger.condition.left.kind, "count");
  assert.equal(playTrigger.trigger.condition.left.subject, "paid-additional-cost");
  assert.deepEqual(playTrigger.trigger.condition.left.filter, { player: "controller" });
  assert.deepEqual(playTrigger.trigger.condition.right, { kind: "constant", value: 1 });
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.once, undefined);
});

test("unl-052-219 Nami, Headstrong: '[Stun] an enemy unit' targets one enemy unit on the board (424.1)", () => {
  assert.deepEqual(playTrigger.body.map(instruction => instruction.id), [
    "nami-headstrong.stun-enemy-unit"
  ]);
  assert.equal(stunEnemy.op, "effect.stun");
  assert.deepEqual(stunEnemy.args, {
    target: { kind: "constant", value: "nami-headstrong.enemy-unit" }
  });
  assert.deepEqual(enemySpec, {
    id: "nami-headstrong.enemy-unit",
    filter: { type: "unit", zone: "board", controller: "opponent" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(stunEnemy.picks, undefined);
  assert.equal(stunEnemy.linkedTo, undefined);
  assert.equal(stunEnemy.condition, undefined);
});

test("unl-052-219 Nami, Headstrong: 'When I hold' registers the next-unit delayed ready-and-Buff (383.4.d)", () => {
  assert.equal(holdTrigger.kind, "triggered");
  assert.equal(holdTrigger.trigger.at, "hold");
  assert.deepEqual(holdTrigger.trigger.filter, { event: "hold", filter: { source: "self" } });
  assert.equal(holdTrigger.optional, false);

  assert.equal(delayedNextUnit.id, "nami-headstrong.delayed-next-unit");
  assert.equal(delayedNextUnit.op, "trigger.delayed");
  assert.deepEqual(delayedNextUnit.args.at, { kind: "constant", value: "card-played" });
  assert.deepEqual(delayedNextUnit.args.filter, {
    kind: "constant",
    value: { type: "unit", controller: "controller" }
  });
  // 391.3: "the next time … this turn" is the window of the delayed ability.
  assert.deepEqual(delayedNextUnit.args.window, {
    kind: "constant",
    value: "next-time-this-turn"
  });
  assert.deepEqual(delayedNextUnit.args.body.value.map(instruction => instruction.id), [
    "nami-headstrong.ready-played-unit",
    "nami-headstrong.buff-played-unit"
  ]);
});

test("unl-052-219 Nami, Headstrong: the delayed body readies then Buffs the played unit (416.1, 702.2.a)", () => {
  assert.equal(readyPlayedUnit.op, "effect.ready");
  assert.deepEqual(readyPlayedUnit.args.objects, {
    kind: "constant",
    value: { target: "nami-headstrong.played-unit" }
  });
  assert.deepEqual(readyPlayedUnit.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(readyPlayedUnit.targets, [
    {
      id: "nami-headstrong.played-unit",
      filter: { type: "unit", zone: "board", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  assert.equal(buffPlayedUnit.op, "effect.buff");
  assert.deepEqual(buffPlayedUnit.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "nami-headstrong.played-unit" }
  });
  assert.equal(buffPlayedUnit.linkedTo, undefined);
});

test("unl-052-219 Nami, Headstrong golden: effect.stun really stuns the locked enemy unit (424.1)", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", controller: "B", might: 3 })
    .build();
  const run = runInstruction(
    stun,
    { target: "nami-headstrong.enemy-unit" },
    { world: kernel, targets: { "nami-headstrong.enemy-unit": [kernel.ref("enemy")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy").stunned, true);
  assert.deepEqual(run.events.map(event => event.action), ["stun"]);
});

test("unl-052-219 Nami, Headstrong golden: an already-Stunned enemy is a legal no-op, not a second Stun (424.1.a.1)", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", controller: "B", might: 3, stunned: true })
    .build();
  const run = runInstruction(
    stun,
    { target: "nami-headstrong.enemy-unit" },
    { world: kernel, targets: { "nami-headstrong.enemy-unit": [kernel.ref("enemy")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.stunned.count, 0);
  assert.equal(run.linked.stunned.alreadyStunned, 1);
  assert.deepEqual(run.events, []);
});

test("unl-052-219 Nami, Headstrong golden: the delayed body's ready and Buff run on the played unit", () => {
  const kernel = world().unit("played-unit", { exhausted: true }).build();
  // effect.ready takes a selection descriptor as { kind: "target", id } (a bare
  // id string is the documented shorthand); the card's selector value carries the
  // bare-target spelling, so it is expanded here to the descriptor the primitive
  // parses.
  const selection = readyPlayedUnit.args.objects.value;
  const readyRun = runInstruction(ready, {
    objects: { kind: "target", id: selection.target },
    amount: { kind: "constant", value: 1 }
  }, {
    world: kernel,
    targets: { "nami-headstrong.played-unit": [kernel.ref("played-unit")] }
  });
  assert.equal(readyRun.result.status, "executed");
  assert.equal(kernel.getObject("played-unit").exhausted, false);

  const buffRun = runInstruction(buff, { mode: "buff", target: "nami-headstrong.played-unit" }, {
    world: kernel,
    targets: { "nami-headstrong.played-unit": [kernel.ref("played-unit")] }
  });
  assert.equal(buffRun.result.status, "executed");
  assert.equal(kernel.getObject("played-unit").buffs, 1);
  assert.deepEqual(buffRun.events.map(event => event.action), ["buff"]);
});

test("unl-052-219 Nami, Headstrong golden: a unit that already has a Buff is not Buffed twice (702.3.a)", () => {
  const kernel = world().unit("played-unit", { exhausted: true, buffs: 1 }).build();
  const run = runInstruction(buff, { mode: "buff", target: "nami-headstrong.played-unit" }, {
    world: kernel,
    targets: { "nami-headstrong.played-unit": [kernel.ref("played-unit")] }
  });

  assert.deepEqual(run.result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(kernel.getObject("played-unit").buffs, 1);
  assert.deepEqual(run.events, []);
});

test.todo(
  "unl-052-219 Nami, Headstrong: feed the declared Calm additional cost into Finalize's optionalAdditional plan " +
    "(CR 204.2/356.2.b.1) through the CardProgram cost translation"
);

test.todo(
  "unl-052-219 Nami, Headstrong: evaluate 'if you paid the additional cost' from the paid receipt " +
    "(CR 356.4.f.1) by exposing the payment decision to trigger conditions"
);

test.todo(
  "unl-052-219 Nami, Headstrong: register the 'the next time you play a unit this turn' delayed trigger " +
    "(CR 391.2/391.3) with a trigger.delayed InstructionDef and next-time window"
);

test.todo(
  "unl-052-219 Nami, Headstrong: bind 'it' to the unit just played (the delayed trigger's event object) — " +
    "add an event-object selector to the delayed trigger binding"
);
