import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/battlefield-armorer.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [triggered] = program.abilities;
const [optIn] = triggered.body;
const [pay, returnGear] = optIn.args.body.value;

const bodyWithoutTargets = triggered.body.map(({ targets, ...rest }) => rest);

const answerFor = (refs) => ({ [returnGear.picks[0].id]: refs });

test("rad-130-167 Battlefield Armorer: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(
    program.canonicalCardId,
    "card.hash-5ded292f5616ea4fbb22076ef9ee2421ef6458f0ce8eda2335e14bb61716771c"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When a friendly gear at a battlefield dies, you may pay :rb_energy_1: to return it to its owner's hand."
  );
});

test("rad-130-167 Battlefield Armorer: judgeReason names the remaining payment, event-object and binding gaps", () => {
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /事件对象|event object/i);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("rad-130-167 Battlefield Armorer: structure — gear-death trigger, optional 1-energy payment, return to hand", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-killed");
  assert.deepEqual(triggered.trigger.filter, {
    event: "object-killed",
    object: { type: "gear", controller: "self", zone: "battlefield" }
  });
  assert.equal(triggered.optional, false);

  // "you may pay :rb_energy_1: to return it" — contract 3.9: the chosen
  // instructions live inside choice.optional.body, never beside it.
  assert.deepEqual(triggered.body.map(instruction => instruction.id), ["battlefield-armorer.opt-in"]);
  assert.equal(optIn.op, "choice.optional");
  assert.equal(optIn.args.body.kind, "constant");
  assert.deepEqual(optIn.args.body.value.map(instruction => instruction.id), [
    "battlefield-armorer.pay",
    "battlefield-armorer.return"
  ]);

  assert.equal(pay.op, "cost.pay");
  assert.deepEqual(pay.args.energy, { kind: "constant", value: 1 });
  assert.equal(pay.linkedTo, undefined);

  assert.equal(returnGear.op, "effect.zone");
  assert.equal(returnGear.linkedTo, "battlefield-armorer.pay");
  assert.deepEqual(returnGear.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(returnGear.args.pick, {
    kind: "constant",
    value: "battlefield-armorer.dying-gear"
  });
  assert.equal(returnGear.picks.length, 1);
  assert.deepEqual(returnGear.picks[0].options, ["dynamic:dying-gear"]);
  assert.equal(returnGear.picks[0].min, 1);
  assert.equal(returnGear.picks[0].max, 1);
  assert.equal(returnGear.picks[0].selection, "one");
});

test("rad-130-167 Battlefield Armorer: the printed 'may' is a contract 3.9 optional wrapper, not a bare choice", () => {
  assert.equal(optIn.op, "choice.optional");
  assert.equal(
    optIn.args.body.value.some(instruction => instruction.id === "battlefield-armorer.pay"),
    true
  );
  // The pay instruction must not sit beside the choice with a linkedTo back
  // into it (contract 3.9 forbids the choice + linkedTo shape).
  assert.equal(program.abilities[0].body.length, 1);
});

test("rad-130-167 Battlefield Armorer: returning a gear card from the trash to hand works (056 hand destination)", () => {
  const kernel = world()
    .player("A", { energy: 1 })
    .unit("gear-1", { types: ["gear"], zone: "trash" })
    .build();
  const run = runInstruction(
    zone,
    { pick: returnGear.args.pick.value, to: returnGear.args.to },
    { world: kernel, picks: answerFor([kernel.ref("gear-1")]) }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("gear-1").zone, "hand");
  assert.equal(run.linked.moved, 1);
  assert.equal(run.linked.destination, "hand");
  assert.deepEqual(run.events.map(event => event.action), ["return-to-hand"]);
});

test("rad-130-167 Battlefield Armorer: a reference that left its zone makes the return ignored (359.3.e.7)", () => {
  const kernel = world().player("A", { energy: 1 }).unit("gear-1", { types: ["gear"], zone: "trash" }).build();
  const stale = kernel.ref("gear-1");
  kernel.perform({ type: "move-zone", object: stale, to: "banishment" });
  const run = runInstruction(
    zone,
    { pick: returnGear.args.pick.value, to: returnGear.args.to },
    { world: kernel, picks: answerFor([stale]) }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("gear-1").zone, "banishment");
});

test("rad-130-167 Battlefield Armorer golden: the merged matcher evaluates 'died at a battlefield'", () => {
  // 355.10.b: the restriction is a filter on the gear that died. The merged
  // trigger matcher reads the pre-move snapshot's location.type through the
  // zone field, so a gear that died at a battlefield matches while one that
  // died in a base does not.
  const battlefieldGear = world().unit("gear-bf", {
    types: ["gear"],
    zone: "board",
    location: { type: "battlefield", id: "bf-1" }
  }).build().getObject("gear-bf");
  const baseGear = world().unit("gear-base", {
    types: ["gear"],
    zone: "board",
    location: { type: "base", player: "A" }
  }).build().getObject("gear-base");

  assert.equal(matchesTriggerEvent(triggered.trigger.filter, { timingPoint: "object-killed", object: battlefieldGear }, "A"), true);
  assert.equal(matchesTriggerEvent(triggered.trigger.filter, { timingPoint: "object-killed", object: baseGear }, "A"), false);
  // 740.1.a: "friendly" = the ability controller; an opponent's gear never matches.
  assert.equal(
    matchesTriggerEvent(triggered.trigger.filter, { timingPoint: "object-killed", object: { ...battlefieldGear, controller: "B", owner: "B" } }, "A"),
    false
  );
});

test("rad-130-167 Battlefield Armorer: declining the optional leaves the payment and the return unexecuted", () => {
  const kernel = world().player("A", { energy: 1 }).build();
  kernel.setAnswers({ "battlefield-armorer.opt-in/optional": false });
  const outcome = runAbilityBody(bodyWithoutTargets, kernel);
  assert.deepEqual(outcome.results.map(result => result.id), ["battlefield-armorer.opt-in"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.events, []);
});

test("rad-130-167 Battlefield Armorer: the payment step is declared as data, never faked with a stub", () => {
  // "you may pay :rb_energy_1:" is a cost within instructions (204.3). Its
  // primitive is not merged, so the card declares the payment step and the
  // return is linked to it; nothing in the card fakes the payment (no
  // effect.exhaust, no free return). The dependency itself is recorded in
  // judgeReason and the TODO below instead of locking the primitive's error.
  assert.equal(pay.op, "cost.pay");
  assert.deepEqual(pay.args.energy, { kind: "constant", value: 1 });
  assert.equal(returnGear.linkedTo, "battlefield-armorer.pay");
  assert.equal(returnGear.op, "effect.zone");
  assert.deepEqual(returnGear.args.to, { kind: "constant", value: "hand" });
  assert.equal(optIn.args.body.value.length, 2);
});

test.todo(
  "rad-130-167 Battlefield Armorer: trigger on 'a friendly gear at a battlefield dies' — the " +
    "object-killed payload carries the pre-move location but TriggerSpec.filter has no " +
    "battlefield/location predicate, so the 355.10.b restriction cannot be evaluated (RIFT-90 target/filter system)"
);

test.todo(
  "rad-130-167 Battlefield Armorer: 'return it to its owner's hand' must recycle the event object after " +
    "it left the board (355.10.c / 359.3.e.13); the merged pick/target system only resolves objects that are " +
    "still in their zone (RIFT-90)"
);
