import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/unl/spectral-centaur.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL =
  "card.hash-54a2013f8d1b41ecedba3f879be7fae1727fe8209e602a142e8ba6550ed829c9";
const SOURCE_TEXT = "When another friendly unit dies, give me +2 :rb_might: this turn.";

const [ability] = program.abilities;
const [instruction] = ability.body;
const [meSpec] = instruction.targets;

test("unl-068-219 Spectral Centaur: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-068-219 Spectral Centaur: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /exclude/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-120/);
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
  assert.equal(instruction.linkedTo, undefined);

  assert.equal(instruction.targets.length, 1);
  assert.equal(meSpec.id, "spectral-centaur.me");
  // `"me"` 是自指；用契约 3.6 的对象锚点表达，而不是运行时不存在的 objectId 常量。
  assert.deepEqual(meSpec.filter, { zone: "board", type: "unit", object: "self" });
  assert.equal(meSpec.min, 1);
  assert.equal(meSpec.max, 1);
  assert.equal(meSpec.selection, "one");
});

test("unl-068-219 Spectral Centaur golden: the merged continuous.might op applies +2 this turn", () => {
  const base = world().unit("spectral-centaur", { might: 5, controller: "A", zone: "board" }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("spectral-centaur") });
  kernel.setTargets("spectral-centaur.me", [kernel.ref("spectral-centaur")]);
  const outcome = runAbilityBody([instruction], kernel);
  assert.equal(outcome.status, "executed");
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("spectral-centaur")).might, 7);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("spectral-centaur")).might, 5);
});

test.todo(
  "unl-068-219 Spectral Centaur: 'another friendly unit' needs an exclusion anchor in the closed " +
    "ObjectFilter / trigger-spec validator (events/trigger-spec.ts) — today isTriggerSpec rejects " +
    "the declared filter"
);
test.todo(
  "unl-068-219 Spectral Centaur: 'give me +2 :rb_might: this turn' needs the continuous.might layers " +
    "card-program trigger registration; the merged op execution is covered above (RIFT-91/RIFT-120)"
);
test.todo(
  "unl-068-219 Spectral Centaur: registering the card's triggered ability as a TriggerRegistration " +
    "(production chain/event pipeline) is shared wiring tracked by the coordinator (RIFT-120)"
);
