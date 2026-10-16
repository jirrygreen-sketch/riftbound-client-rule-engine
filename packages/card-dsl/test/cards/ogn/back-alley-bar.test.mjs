import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/back-alley-bar.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [ability] = program.abilities;
const [instruction] = ability.body;
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };
const OTHER_BATTLEFIELD = { type: "battlefield", id: "battlefield-2" };

test("ogn-277-298 Back-Alley Bar: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("ogn-277-298 Back-Alley Bar: identity, ruleset, status and printed text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-493d66d1c2a0fe93d708e9d2f3e005dc5a57140526eb8080cdad1ce0977c081a"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // deck-catalog.json (ogn-277-298) carries this text verbatim.
  assert.equal(program.sourceText, "When a unit moves from here, give it +1 :rb_might: this turn.");
  assert.match(program.judgeReason, /might/i);
});

test("ogn-277-298 Back-Alley Bar: Move trigger filtered on this battlefield as the origin", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // CR 421.1 / 449.1 / 449.2: Move is the location-changing action; the
  // object-moved timing point carries fromKind/fromLocationId. CR 458.1: a
  // Recall is not a Move, which is why the trigger is not a zone/location
  // change subscription.
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    details: { fromKind: "battlefield", fromLocationId: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
});

test("ogn-277-298 Back-Alley Bar: the body asks for +1 Might this turn and targets no object", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "back-alley-bar.give-might");
  assert.equal(instruction.op, "effect.might-modify");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  // CR 355.10.c: "a unit moves from here" is only a trigger condition, so the
  // moved unit is not a target and no TargetSpec is declared.
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("ogn-277-298 Back-Alley Bar: the merged Move primitive performs the move the trigger watches", () => {
  // The trigger half cannot execute (no might primitive), but the Move the
  // trigger fires on is merged: this asserts the movement the object-moved
  // payload describes, including the origin location the filter uses.
  const kernel = world()
    .unit("mover", { zone: "board", location: BATTLEFIELD })
    .build();
  const run = runInstruction(
    move,
    { objects: { kind: "constant", value: "source" }, to: { kind: "constant", value: OTHER_BATTLEFIELD } },
    { world: kernel.clone({ sourceSnapshot: kernel.getObject("mover") }) }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.count, 1);
  assert.equal(run.linked.moved.objects[0].id, "mover");
  assert.deepEqual(run.linked.moved.movements[0].from, BATTLEFIELD);
  assert.deepEqual(run.linked.moved.movements[0].to, OTHER_BATTLEFIELD);
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
});

test.todo(
  "ogn-277-298 Back-Alley Bar: +1 Might this turn on the moved unit (CR 122.5/703) needs a " +
    "temporary Might modification primitive; effect.buff leaves it to layers/continuous.might, " +
    "and a Buff counter would be a different Game Object (CR 702-704)"
);

test.todo(
  "ogn-277-298 Back-Alley Bar: naming the moved unit from the trigger payload needs an " +
    "event-object ObjectSelector (the frozen set is self/source/target/pick/linked)"
);

test.todo(
  "ogn-277-298 Back-Alley Bar: the object-moved timing point with its origin-location payload " +
    "reaching this ability, and Recalls staying excluded (CR 458.1; RIFT-33 scenarios-triggers)"
);
