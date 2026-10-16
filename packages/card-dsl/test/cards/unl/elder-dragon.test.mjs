import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/elder-dragon.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-f61b6c198fa8246d56a2b3ef18175df62f2d19dcbbfe1b90bd2cd61fa150304b";
const SOURCE_TEXT =
  "Any amount of your damage is enough to kill enemy units.\n" +
  "When you play me, choose up to one enemy unit at each location. Deal 1 to them.";

const [lethalThreshold, playTrigger] = program.abilities;
const [dealOne] = playTrigger.body;
const [enemyUnitSpec] = dealOne.targets;

test("unl-118-219 Elder Dragon: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-118-219 Elder Dragon: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /continuous\.lethal-threshold/);
  assert.match(program.judgeReason, /142\.4\.c/);
  assert.match(program.judgeReason, /perLocation/);
  assert.match(program.judgeReason, /355\.11/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("unl-118-219 Elder Dragon: the lethal-damage rewrite is a layer effect, not a trigger (142.4.c)", () => {
  assert.equal(lethalThreshold.kind, "static");
  assert.equal(lethalThreshold.effect.kind, "continuous.lethal-threshold");
  // 142.4.c refers to “the amount of damage needed to kill a unit”; the rule text
  // uses this very card as its example.
  assert.deepEqual(lethalThreshold.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(lethalThreshold.effect.appliesTo, {
    kind: "constant",
    value: { damageController: "controller", target: "enemy-units" }
  });
  assert.equal(lethalThreshold.condition, undefined);
});

test("unl-118-219 Elder Dragon: 'When you play me' is a mandatory card-played trigger on the source", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(playTrigger.optional, false);
  assert.equal(playTrigger.trigger.condition, undefined);
  assert.equal(playTrigger.trigger.once, undefined);
});

test("unl-118-219 Elder Dragon: 'up to one enemy unit at each location' stays a per-location group (355.11)", () => {
  assert.equal(playTrigger.body.length, 1);
  assert.equal(dealOne.id, "elder-dragon.deal-1");
  assert.equal(dealOne.op, "effect.damage");
  // 418.1 / 418.6.a: “Deal 1 to them” is a Deal action whose unspecified source
  // is the effect itself, so effect.damage's default source is used.
  assert.deepEqual(dealOne.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(dealOne.args.target, {
    kind: "constant",
    value: "elder-dragon.enemy-unit"
  });
  assert.equal(dealOne.args.source, undefined);
  assert.equal(dealOne.args.divide, undefined);
  assert.equal(dealOne.linkedTo, undefined);
  assert.equal(dealOne.condition, undefined);

  // The printed “up to one … at each location” is a targeting requirement met by
  // a group of targets (355.11), not a flat global “up to N”: the perLocation
  // placeholder records the missing quantifier instead of widening the scope.
  assert.deepEqual(enemyUnitSpec, {
    id: "elder-dragon.enemy-unit",
    filter: { type: "unit", controller: "opponent", zone: "board" },
    min: 0,
    max: null,
    selection: "up-to",
    perLocation: 1
  });
});

test("unl-118-219 Elder Dragon golden: the damage instruction deals exactly 1 to the locked enemy unit", () => {
  const base = world()
    .unit("dragon", { owner: "A", might: 10 })
    .unit("here", { owner: "B", controller: "B", might: 5, location: { type: "battlefield", id: "bf-1" } })
    .unit("elsewhere", { owner: "B", controller: "B", might: 5, location: { type: "battlefield", id: "bf-2" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("dragon") });

  const run = runInstruction(
    damage,
    { amount: { kind: "constant", value: 1 }, target: "elder-dragon.enemy-unit" },
    { world: kernel, targets: { "elder-dragon.enemy-unit": [kernel.ref("here")] } }
  );

  assert.equal(run.result.status, "executed");
  // “Deal 1 to them”: exactly 1 damage is marked, and only on the chosen unit.
  assert.equal(kernel.getObject("here").damage, 1);
  assert.equal(kernel.getObject("elsewhere").damage, 0);
  assert.equal(run.linked.dealt, 1);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
});

test("unl-118-219 Elder Dragon golden: an all-invalid target group is ignored, not replaced (359.3.e.7)", () => {
  const base = world().unit("dragon", { owner: "A", might: 10 }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("dragon") });

  const run = runInstruction(
    damage,
    { amount: { kind: "constant", value: 1 }, target: "elder-dragon.enemy-unit" },
    { world: kernel, targets: { "elder-dragon.enemy-unit": [] } }
  );

  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.deepEqual(run.events, []);
});

test("unl-118-219 Elder Dragon golden: “any amount” still means a positive amount of damage (142.4.b, 418.1.e.1)", () => {
  // 142.4.c changes the threshold for lethal damage; it does not make zero or
  // negative damage into dealt damage (418.1.e/418.1.e.1). The printed "Deal 1"
  // clause is always 1 here, so the guard is asserted through the primitive.
  const base = world()
    .unit("dragon", { owner: "A", might: 10 })
    .unit("here", { owner: "B", controller: "B", might: 5 })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("dragon") });

  const run = runInstruction(
    damage,
    { amount: { kind: "constant", value: 0 }, target: "elder-dragon.enemy-unit" },
    { world: kernel, targets: { "elder-dragon.enemy-unit": [kernel.ref("here")] } }
  );

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.getObject("here").damage, 0);
});

test.todo(
  "unl-118-219 Elder Dragon: “Any amount of your damage is enough to kill enemy units” sets the lethal threshold " +
    "for damage marked by this card's controller (CR 142.4.a-142.4.c) — no continuous.lethal-threshold primitive or " +
    "layer consumer is merged (RIFT-9 newPrimitive for this card)"
);
test.todo(
  "unl-118-219 Elder Dragon: “choose up to one enemy unit at each location” resolves per-location groups " +
    "(CR 355.11 Targeting Requirements) — TargetSpec has no per-location quantifier and a flat up-to group would " +
    "allow two units at one location (target.many / TargetPlan work)"
);
test.todo(
  "unl-118-219 Elder Dragon: register the card-played trigger as a TriggerRegistration (RIFT-120 follow-up)"
);
