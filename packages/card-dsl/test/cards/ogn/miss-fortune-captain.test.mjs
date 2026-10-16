import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/miss-fortune-captain.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-541ef049150d65551ee54e4c6763bc4a7009a9e321032a8470f0ec2a2030a8f7";

const [accelerate, ganking, moveTrigger] = program.abilities;
const optionalInstruction = moveTrigger.body[0];
const readyInstruction = optionalInstruction.args.body.value[0];

function missFortuneWorld() {
  const kernel = world()
    .unit("miss-fortune", { exhausted: false, location: { type: "battlefield", id: "bf-1" } })
    .unit("exhausted-ally", { exhausted: true, location: { type: "base", player: "A" } })
    .unit("enemy-unit", { owner: "B", exhausted: true, location: { type: "base", player: "B" } })
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("miss-fortune") });
}

test("ogn-162-298 Miss Fortune, Captain: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
      "[Ganking] (I can move from battlefield to battlefield.)\n" +
      "The first time I move each turn, you may ready something else that's exhausted."
  );
});

test("ogn-162-298 Miss Fortune, Captain: judgeReason cites the move timing and the pick pipeline", () => {
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /PickSpec/);
  assert.match(program.judgeReason, /355\.10\.d/);
  // Re-sweep after RIFT-270: the point is now emitted by the pipeline, but the
  // card trigger binding and the Standard Move -> pipeline wiring are missing.
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /Standard Move/);
  assert.match(program.judgeReason, /finalizePick/);
});

test("ogn-162-298 Miss Fortune, Captain: Accelerate and Ganking stay keyword declarations (805/810)", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
  assert.deepEqual(ganking, { kind: "keyword", keyword: "ganking" });
  assert.equal(program.abilities.filter(ability => ability.kind === "static").length, 0);
});

test("ogn-162-298 Miss Fortune, Captain: 'the first time I move each turn' is a per-turn move trigger (383.1/383.1.b)", () => {
  assert.equal(moveTrigger.kind, "triggered");
  assert.equal(moveTrigger.trigger.at, "object-moved");
  assert.deepEqual(moveTrigger.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" }
  });
  assert.equal(moveTrigger.trigger.once, "per-turn");
  assert.equal(moveTrigger.optional, true);
  assert.equal(moveTrigger.body.length, 1);
});

test("ogn-162-298 Miss Fortune, Captain: 'you may ready something else' is choice.optional wrapping the ready (contract 3.9)", () => {
  assert.equal(optionalInstruction.id, "miss-fortune.may-ready-other");
  assert.equal(optionalInstruction.op, "choice.optional");
  assert.equal(optionalInstruction.args.body.kind, "constant");
  assert.equal(optionalInstruction.args.body.value.length, 1);
  assert.equal(optionalInstruction.linkedTo, undefined);
  assert.deepEqual(optionalInstruction.args.prompt, {
    kind: "constant",
    value: "Ready something else that's exhausted?"
  });

  assert.equal(readyInstruction.id, "miss-fortune.ready-other");
  assert.equal(readyInstruction.op, "effect.ready");
  assert.deepEqual(readyInstruction.args, {
    objects: { kind: "constant", value: { kind: "pick", id: "miss-fortune.exhausted-other" } }
  });
  assert.equal(readyInstruction.targets, undefined);
});

test("ogn-162-298 Miss Fortune, Captain: 'something else that's exhausted' is a non-target pick (355.10.d)", () => {
  assert.equal(readyInstruction.picks.length, 1);
  const [pick] = readyInstruction.picks;
  assert.equal(pick.id, "miss-fortune.exhausted-other");
  assert.deepEqual(pick.options, ["exhausted-object-other-than-source"]);
  assert.deepEqual(pick.filter, { exclude: "source", states: "exhausted" });
  assert.equal(pick.min, 1);
  assert.equal(pick.max, 1);
  assert.equal(pick.selection, "one");
  // picks are not targets: nothing here may trigger became-target effects.
  assert.equal(readyInstruction.targets, undefined);
});

test("ogn-162-298 Miss Fortune, Captain: accepting the optional readies another object through the kernel", () => {
  const kernel = missFortuneWorld();
  kernel.setAnswers({ "miss-fortune.may-ready-other/optional": true });
  kernel.setPicks("miss-fortune.exhausted-other", [kernel.ref("exhausted-ally")]);

  const outcome = runAbilityBody(moveTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("exhausted-ally").exhausted, false);
  assert.equal(kernel.getObject("miss-fortune").exhausted, false);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);
  assert.deepEqual(outcome.results[0].result.linkedValues.readied.objects, [
    { id: "exhausted-ally", zoneEntryId: 1 }
  ]);
});

test("ogn-162-298 Miss Fortune, Captain: declining the optional readies nothing (403.1)", () => {
  const kernel = missFortuneWorld();
  kernel.setAnswers({ "miss-fortune.may-ready-other/optional": false });

  const outcome = runAbilityBody(moveTrigger.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["miss-fortune.may-ready-other", "negated"]
  ]);
  assert.equal(kernel.getObject("exhausted-ally").exhausted, true);
  assert.equal(outcome.events.length, 0);
});

test.todo(
  "ogn-162-298 Miss Fortune, Captain: 'The first time I move each turn' needs the duel Standard Move " +
    "(CR v1.5 421.1/449.1) to publish its results into the single event pipeline (zones/movement and " +
    "duel/standard-move-executor-v2 only hand requiresMoveTriggers to the outer caller) and the card's " +
    "trigger registration to bind the self anchor (RIFT-257)."
);
test.todo(
  "ogn-162-298 Miss Fortune, Captain: the non-target pick (355.10.d/355.10.d.1) needs a Finalize " +
    "selection pipeline that resolves the PickSpec filter and binds ctx.picks; finalizePick has no " +
    "production caller and effect.ready reads picks that nothing populates for a card program yet."
);
