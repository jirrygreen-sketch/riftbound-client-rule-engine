import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/vex-mocking.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { isTimingPointId } from "../../../../engine-core/dist/events/timing-points.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-6c81da534f503cae7bc5118d6be12f7c349fa24deecee1dad3aff06abb20eefd";
const SOURCE_TEXT =
  "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
  "[Tank] (I must be assigned combat damage first.)\n" +
  "When you [Stun] an enemy unit at a battlefield, you may move me to that battlefield.";

const [shield, tank, stunTrigger] = program.abilities;
const [moveMe] = stunTrigger.body;

test("unl-055-219 Vex, Mocking: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-055-219 Vex, Mocking: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /unit-stunned/);
  assert.match(program.judgeReason, /that battlefield/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("unl-055-219 Vex, Mocking: [Shield] and [Tank] are declared as unvalued keywords (814.1, 815.1)", () => {
  // README §5: the printed [Shield] carries no number, so `value` is omitted
  // (814.1.b.3's presumed X = 1 belongs to the keyword expansion); the card only
  // declares the keywords and never re-implements their expansions.
  assert.deepEqual(shield, { kind: "keyword", keyword: "shield" });
  assert.equal(shield.value, undefined);
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });
  assert.equal(tank.value, undefined);
});

test("unl-055-219 Vex, Mocking: 'When you [Stun] an enemy unit' subscribes to unit-stunned scoped to the enemy unit (412.4)", () => {
  assert.equal(stunTrigger.kind, "triggered");
  assert.equal(stunTrigger.trigger.at, "unit-stunned");
  assert.equal(isTimingPointId("unit-stunned"), true);
  // 412.4/412.5: the ability triggers on a Stun the controller is responsible
  // for; Vex is not the source of that Stun, so the filter names the event object
  // (the stunned unit) instead of scoping itself as the source.
  assert.deepEqual(stunTrigger.trigger.filter, {
    event: "unit-stunned",
    object: { type: "unit", zone: "board", controller: "opponent" }
  });
  assert.equal(stunTrigger.trigger.condition, undefined);
  assert.equal(stunTrigger.trigger.once, undefined);
  // 383.3.a: the leading "you may" is the trigger's own Finalize decision.
  assert.equal(stunTrigger.optional, true);
});

test("unl-055-219 Vex, Mocking: the may-move moves the source and keeps the event-location marker (421.1, 359.3.f.1)", () => {
  assert.deepEqual(stunTrigger.body.map(instruction => instruction.id), ["vex-mocking.move-me"]);
  assert.equal(moveMe.op, "effect.move");
  // "me": the ability host, written as the contract 3.6 symbolic selector.
  assert.deepEqual(moveMe.args.objects, {
    kind: "constant",
    value: "source"
  });
  assert.deepEqual(moveMe.args.amount, { kind: "constant", value: 1 });
  // "that battlefield" is the location of the stunned unit from the event; no
  // merged selector can name it, so the destination stays a descriptive marker
  // that effect.move's destination() rejects instead of guessing.
  assert.deepEqual(moveMe.args.to, {
    kind: "constant",
    value: { kind: "destination-selector", referent: "stunned-unit-battlefield" }
  });
  assert.equal(moveMe.targets, undefined);
  assert.equal(moveMe.picks, undefined);
  assert.equal(moveMe.linkedTo, undefined);
});

test("unl-055-219 Vex, Mocking golden: effect.move relocates the source unit to the stunned unit's battlefield", () => {
  const kernel = world()
    .unit("vex", {
      might: 5,
      location: { type: "battlefield", id: "battlefield-2" }
    })
    .unit("stunned-enemy", {
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  const scoped = kernel.clone({ source: kernel.ref("vex"), sourceSnapshot: kernel.getObject("vex") });

  // The event location is locked when the stun trigger is generated (359.3.f.1),
  // so the golden supplies it as the evaluated destination.
  const run = runInstruction(
    move,
    {
      objects: moveMe.args.objects,
      to: { kind: "constant", value: { type: "battlefield", id: "battlefield-1" } },
      amount: moveMe.args.amount
    },
    { world: scoped }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.moved.objects, [{ id: "vex", zoneEntryId: 1 }]);
  assert.deepEqual(scoped.getObject("vex").location, {
    type: "battlefield",
    id: "battlefield-1"
  });
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
});

test("unl-055-219 Vex, Mocking golden: moving to the battlefield she already occupies is a no-op (449.2)", () => {
  const kernel = world()
    .unit("vex", { might: 5, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const scoped = kernel.clone({ source: kernel.ref("vex"), sourceSnapshot: kernel.getObject("vex") });
  const run = runInstruction(
    move,
    {
      objects: moveMe.args.objects,
      to: { kind: "constant", value: { type: "battlefield", id: "battlefield-1" } },
      amount: moveMe.args.amount
    },
    { world: scoped }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.count, 0);
  assert.deepEqual(run.events, []);
});

test("unl-055-219 Vex, Mocking golden: the descriptive destination marker is rejected, never guessed", () => {
  const kernel = world()
    .unit("vex", { might: 5, location: { type: "battlefield", id: "battlefield-2" } })
    .build();
  const scoped = kernel.clone({ source: kernel.ref("vex"), sourceSnapshot: kernel.getObject("vex") });
  const before = scoped.snapshot();

  assert.throws(
    () => runInstruction(move, moveMe.args, { world: scoped }),
    /effect\.move to must be a location/
  );
  assert.deepEqual(scoped.snapshot(), before);
});

test.todo(
  "unl-055-219 Vex, Mocking: emit the unit-stunned timing point from the production chain (CR 424.1) and register " +
    "this card's trigger — the emitter lives only in the action-pipeline adapter, which ChainEngine does not install (RIFT-120)"
);

test.todo(
  "unl-055-219 Vex, Mocking: bind 'that battlefield' to the stunned unit's location (CR 359.3.f.1) — needs an " +
    "event-object/event-location selector and a location destination for effect.move"
);

test.todo(
  "unl-055-219 Vex, Mocking: apply [Shield]'s defender-gated +1 Might (CR 814.1.c/814.1.d.1) and [Tank]'s " +
    "damage-assignment priority (CR 815.1.c) — no layer or combat consumer for the expanded keywords (RIFT-91, combat batch)"
);
