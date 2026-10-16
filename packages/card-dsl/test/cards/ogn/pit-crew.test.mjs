import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/pit-crew.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-c14f8fe7647e76e1a5b3db9a1eef0a30ba2a0cdc929fe013536ce268b02c81d8";
const TRIGGER_BODY_ID = "pit-crew.ready-self";

/** A board with Pit Crew as the ability source, mirrored to the source snapshot. */
function pitCrewWorld({ exhausted = true } = {}) {
  const kernel = world()
    .unit("pit-crew", {
      might: 3,
      exhausted,
      ref: { id: "pit-crew", zoneEntryId: 1 }
    })
    .build();
  Object.defineProperty(kernel, "source", { value: kernel.getObject("pit-crew") });
  return kernel;
}

test("Pit Crew program validates and is executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, "When you play a gear, ready me.");
});

test("Pit Crew structure: a card-played trigger filtered to a gear played by the controller", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.equal(ability.trigger.filter.event, "card-played");
  // "you play a gear": the played object is a gear and the playing player is
  // this ability's controller ("self" resolves to the controller in the event
  // matcher). No `once` lifetime: the trigger fires for every gear played.
  assert.deepEqual(ability.trigger.filter.object, { type: "gear" });
  assert.equal(ability.trigger.filter.player, "self");
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);

  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, TRIGGER_BODY_ID);
  assert.equal(instruction.op, "effect.ready");
  // "ready me": the default selection is the ability source (355.10.g, 412.4).
  assert.deepEqual(instruction.args, {});
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("Pit Crew golden: 'ready me' readies the exhausted source unit (CR 416.1)", () => {
  const kernel = pitCrewWorld({ exhausted: true });
  const [instruction] = program.abilities[0].body;
  const run = runInstruction(ready, instruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("pit-crew").exhausted, false);
  assert.equal(run.linked.readied.count, 1);
  assert.deepEqual(run.linked.readied.objects, [{ id: "pit-crew", zoneEntryId: 1 }]);
});

test("Pit Crew golden: an already-ready source is a no-op, not a second ready event (CR 416.1.b / 416.1.c)", () => {
  const kernel = pitCrewWorld({ exhausted: false });
  const [instruction] = program.abilities[0].body;
  const run = runInstruction(ready, instruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("pit-crew").exhausted, false);
  assert.equal(run.linked.readied.count, 0);
  assert.deepEqual(run.linked.readied.objects, []);
});

test.todo(
  "Pit Crew end-to-end: the merged chain registers the card-played trigger and fires it when a gear is played " +
    "(383.4.a), then readies the source through the chain's Resolve step; card-program trigger registration into the " +
    "EventPipeline is not merged yet"
);
