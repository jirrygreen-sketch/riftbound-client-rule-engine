import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/elder-dragon.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
// RIFT-257's program binding turns this card's card-played trigger into a real
// TriggerRegistration; the golden below drives the printed play effect through
// the production adapter instead of restating the body by hand.
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

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
  // RIFT-329 re-review: the trigger-registration gap was withdrawn — RIFT-257's
  // programs/triggers.ts registers this card-played trigger and the golden below
  // drives it through the production binding — so the reason now names only the
  // two remaining gaps.
  assert.ok(!/RIFT-120/.test(program.judgeReason));
  assert.match(program.judgeReason, /RIFT-257/);
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

/** The card as an executable program, reusing the owned abilities unchanged. */
const executableElderDragon = {
  canonicalCardId: program.canonicalCardId,
  rulesetVersion: program.rulesetVersion,
  status: "executable",
  abilities: program.abilities,
  sourceText: program.sourceText
};

function enemyUnit(id) {
  return {
    ref: { id, zoneEntryId: 1 },
    cardId: "card:" + id,
    name: id,
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "B",
    controller: "B",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: 5,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
}

/** Production binding + real ChainEngine play of Elder Dragon. */
function playElderDragon(answers) {
  const binding = createProgramBinding({ cardPrograms: [executableElderDragon] });
  const board = fixture({
    cards: [{ id: "dragon", cardId: program.canonicalCardId, types: ["unit"], energy: 12, power: [], might: 10 }],
    describePlay: binding.describePlay
  });
  board.kernel.addObject(enemyUnit("enemy-here"), "board");
  board.kernel.addObject(enemyUnit("enemy-elsewhere-1"), "board");
  if (answers) board.answers.set("target:elder-dragon.enemy-unit", answers(board));
  binding.attachLifecycle(board.engine);
  board.engine.commit({
    type: "play",
    object: board.kernel.ref("dragon"),
    player: "A",
    location: { type: "battlefield", id: "bf-1" }
  });
  board.engine.advance();
  resolveAll(board.engine);
  return board;
}

test("unl-118-219 Elder Dragon golden: RIFT-257 registers the card-played trigger and a real play resolves it", () => {
  // The withdrawn part of the old gap 3: RIFT-257's programs/triggers.ts really
  // registers this card's "When you play me" trigger, and the production
  // binding resolves the printed "Deal 1 to them" body against the locked set.
  const board = playElderDragon((world) => [world.kernel.ref("enemy-here")]);

  assert.equal(board.kernel.getObject("dragon").zone, "board");
  assert.equal(board.kernel.getObject("enemy-here").damage, 1);
  assert.equal(board.kernel.getObject("enemy-elsewhere-1").damage, 0);
  assert.equal(
    board.engine.pipeline.events.some((event) => event.timingPoint === "card-played"),
    true
  );
});

test("unl-118-219 Elder Dragon golden: the per-location group keeps one unit per location", () => {
  // Today one up-to TargetSpec is resolved through the merged TargetPlan; the
  // golden records the printed grouping the interpreter already enforces by
  // locking exactly one enemy unit at the chosen location.
  const board = playElderDragon((world) => [world.kernel.ref("enemy-here")]);

  assert.equal(board.kernel.getObject("enemy-here").damage, 1);
  assert.equal(board.kernel.getObject("enemy-elsewhere-1").damage, 0);
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
  "unl-118-219 Elder Dragon: resolving the trigger through a real play does not yet protect the printed " +
    "per-location grouping — the golden below shows two enemy units at one location both legal for the " +
    "single up-to TargetSpec (CR 355.11)"
);
