// Golden test for Lulu, Whimsical (rad-110-167).
// The move trigger, the optional wrapper and the target selection are encoded;
// the Trait-Altering base-Might set and the real Move flow are the judged gaps
// (see the program's judgeReason).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/lulu-whimsical.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-4417983f70fa69947305b0884a1562186a0299bf7532c22d71f44111a3d79438";
const SOURCE_TEXT = "When I move, you may have another unit's base Might become 4 this turn.";

const [moveTrigger] = program.abilities;
const [maySet] = moveTrigger.body;
const [setBaseMight] = maySet.args.body.value;
const [anotherUnit] = setBaseMight.targets;

test("rad-110-167 Lulu, Whimsical: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-110-167 Lulu, Whimsical: judgeReason names the current gaps (Trait-Altering set, real Move)", () => {
  // 143.2.a.1 / 479.2: the base-Might set still has no primitive, and the
  // merged continuous.might only covers the arithmetic layer.
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-258/);
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /479\.2/);
  // The object-moved producer is merged; the remaining Move gap is the real
  // transaction plus card-program trigger registration.
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /standard-move-transaction/);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("rad-110-167 Lulu, Whimsical: 'When I move' subscribes to object-moved for this card (421.1/449.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(moveTrigger.kind, "triggered");
  assert.equal(moveTrigger.trigger.at, "object-moved");
  assert.deepEqual(moveTrigger.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" }
  });
  assert.equal(moveTrigger.trigger.once, undefined);
  assert.equal(moveTrigger.optional, false);
});

test("rad-110-167 Lulu, Whimsical: 'you may' becomes choice.optional wrapping the instruction (contract 3.9)", () => {
  assert.equal(moveTrigger.body.length, 1);
  assert.equal(maySet.id, "lulu.may-set-base-might");
  assert.equal(maySet.op, "choice.optional");
  assert.equal(maySet.linkedTo, undefined);
  assert.equal(maySet.args.body.kind, "constant");
  assert.deepEqual(maySet.args.body.value.map(entry => entry.id), ["lulu.set-base-might"]);
});

test("rad-110-167 Lulu, Whimsical: the wrapped instruction sets base Might to 4 for this turn (143.2.a.1)", () => {
  assert.equal(setBaseMight.op, "continuous.base-might");
  assert.deepEqual(setBaseMight.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(setBaseMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(setBaseMight.args.target, {
    kind: "constant",
    value: "lulu.another-unit"
  });
  assert.equal(setBaseMight.targets.length, 1);
  assert.equal(setBaseMight.picks, undefined);
  assert.deepEqual(anotherUnit, {
    id: "lulu.another-unit",
    filter: { type: "unit", exclude: "source" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("rad-110-167 Lulu, Whimsical: declining the optional choice touches nothing (real interpreter)", () => {
  const kernel = world()
    .unit("lulu", { might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("ally", { might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("lulu") });
  scoped.setTargets("lulu.another-unit", [kernel.ref("ally")]);
  scoped.setAnswers({ "lulu.may-set-base-might/optional": false });

  const outcome = runAbilityBody(moveTrigger.body, scoped);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(outcome.events, []);
  // 355.13: a declined optional changes no characteristic and registers nothing.
  assert.equal(scoped.getObject("ally").might, 2);
  assert.equal(scoped.continuousEffects.length, 0);
});

test.todo(
  "rad-110-167 Lulu, Whimsical: 'another unit\'s base Might becomes 4 this turn' applied in the " +
    "Trait-Altering layer (CR 143.2.a.1/475/479.2) — the merged continuous.might only covers the " +
    "arithmetic layer; the base-Might set and its this-turn duration have no primitive"
);
test.todo(
  "rad-110-167 Lulu, Whimsical: the object-moved trigger firing for a real Move — the time is already " +
    "produced by the action adapter for move-location, but combat/flow.ts still throws " +
    "standard-move-transaction for the Standard Move, and no merged path registers a CardProgram " +
    "triggered ability (RIFT-257)"
);
