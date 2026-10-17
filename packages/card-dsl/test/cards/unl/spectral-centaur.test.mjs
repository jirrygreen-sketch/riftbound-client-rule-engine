import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/spectral-centaur.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL =
  "card.hash-54a2013f8d1b41ecedba3f879be7fae1727fe8209e602a142e8ba6550ed829c9";
const SOURCE_TEXT = "When another friendly unit dies, give me +2 :rb_might: this turn.";

const [ability] = program.abilities;
const [instruction] = ability.body;

test("unl-068-219 Spectral Centaur: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("unl-068-219 Spectral Centaur: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /exclude/);
  assert.match(program.judgeReason, /translateObjectFilter/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-068-219 Spectral Centaur: a self object-killed trigger whose filter excludes the host", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-killed");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-killed",
    object: { type: "unit", controller: "self", exclude: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
});

test("unl-068-219 Spectral Centaur: the body grants +2 Might to this unit for the turn", () => {
  assert.equal(instruction.id, "spectral-centaur.give-plus-2");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  // 355.10.g: "me" is the ability host itself, expressed with the merged
  // appliesTo anchor instead of an unlinked targets spec.
  assert.deepEqual(instruction.args.appliesTo, { kind: "constant", value: "self" });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("unl-068-219 Spectral Centaur golden: the merged continuous.might op applies +2 this turn", () => {
  const base = world().unit("spectral-centaur", { might: 5, controller: "A", zone: "board" }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("spectral-centaur") });
  const outcome = runAbilityBody([instruction], kernel);
  assert.equal(outcome.status, "executed");
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("spectral-centaur")).might, 7);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("spectral-centaur")).might, 5);
});
