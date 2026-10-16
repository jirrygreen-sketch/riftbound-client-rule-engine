// Golden test for Lulu, Whimsical (rad-110-167).
// The move trigger, the optional wrapper and the target selection are encoded;
// the base-Might trait-layer set and the object-moved emitter are the judged gaps.
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

test("rad-110-167 Lulu, Whimsical: judgeReason names the base-Might primitive and the move emitter", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /continuous\.duration/);
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /RIFT-91/);
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

test("rad-110-167 Lulu, Whimsical: declining the optional choice touches nothing", () => {
  const kernel = world()
    .unit("lulu", { might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("ally", { might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets("lulu.another-unit", [kernel.ref("ally")]);
  kernel.setAnswers({ "lulu.may-set-base-might/optional": false });
  const outcome = runAbilityBody(moveTrigger.body, kernel);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.getObject("ally").might, 2);
});

test.todo(
  "rad-110-167 Lulu, Whimsical: 'another unit\'s base Might becomes 4 this turn' applied in the " +
    "Trait-Altering layer and expiring at end of turn (CR 143.2.a.1/475/479.2) — needs the " +
    "continuous.might (base-Might) and continuous.duration primitives (RIFT-91)"
);
test.todo(
  "rad-110-167 Lulu, Whimsical: the object-moved timing point emitted for real Moves (Standard Move / " +
    "Ganking between battlefields; not Recall or entry, CR 421.1/449.1/458) — zones/movement is not " +
    "wired into the event pipeline (batch 5)"
);

