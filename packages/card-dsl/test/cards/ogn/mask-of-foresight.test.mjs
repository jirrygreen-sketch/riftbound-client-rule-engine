import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/mask-of-foresight.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

// chain/engine.ts normalizes `controller: "controller"` to the ability
// controller and runs the production matcher; the reference kernel's own query
// compares filter values literally. Bind the production query so the card's
// declared target filter is the one under test (the same helper the merged
// siphon-power-viktor / dropboarder goldens use).
const chainQuery = (kernel, controller) => (filter) => {
  const normalized = { ...filter };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self" || normalized[key] === "controller") normalized[key] = controller;
  }
  return kernel.query({}).filter((object) => {
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "opponent" && object[key] === controller) return false;
    }
    return matchesObjectFilter({
      ...normalized,
      ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
      ...(normalized.owner === "opponent" ? { owner: "any" } : {})
    }, object);
  });
};

const chainContext = (kernel, controller = "A") => bindResolveContext(kernel, {
  controller,
  query: chainQuery(kernel, controller)
});

const CANONICAL = "card.hash-5f48a04a4f966d4526f18478a25c6240550688787ada0e43c59ba66df41a1ef5";

const [attackTrigger, defendTrigger] = program.abilities;

test("ogn-060-298 Mask of Foresight: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /740\.2\.a/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(
    program.sourceText,
    "When a friendly unit attacks or defends alone, give it +1 :rb_might: this turn."
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Mask of Foresight golden: both trigger bodies register the temporary +1 Might through the merged primitive", () => {
  // The card's own continuous.might instructions are the ones under test: the
  // interpreter registers the arithmetic-layer effect with the end-of-turn
  // duration, and the layers engine exposes the modified Might.
  for (const trigger of [attackTrigger, defendTrigger]) {
    const [instruction] = trigger.body;
    const targetId = instruction.targets[0].id;
    const base = world().unit("attacker", { owner: "A", might: 3 }).build();
    const kernel = base.clone({ sourceSnapshot: base.getObject("attacker"), source: base.ref("attacker") });
    // The trigger payload binding ("it") is the RIFT-257 gap; lock the target
    // exactly as Finalize would supply the triggering unit.
    kernel.setTargets(targetId, [kernel.ref("attacker")]);
    const bound = chainContext(kernel);
    bound.setTargets(targetId, [kernel.ref("attacker")]);
    const outcome = runAbilityBody([instruction], bound);
    assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
      [instruction.id, "executed"]
    ]);
    assert.equal(kernel.continuousEffects.length, 1);
    const registration = kernel.continuousEffects[0];
    assert.deepEqual(registration.duration, { type: "end-of-turn" });
    assert.equal(registration.effect.effect.kind, "continuous.might");
    assert.equal(registration.effect.effect.amount, 1);
    assert.equal(registration.effect.layer, "arithmetic");
    assert.equal(registration.effect.filter.objectId, "attacker");
    const layers = createLayerEngine(
      [kernel.getObject("attacker")],
      kernel.continuousEffects.map((entry, index) => ({ effect: entry.effect, duration: entry.duration, timestamp: index + 1 }))
    );
    assert.equal(layers.evaluate(kernel.ref("attacker")).might, 4);
    // 702: a Might modification is never a Buff counter.
    assert.equal(kernel.getObject("attacker").buffs, 0);
  }
});

test("Mask of Foresight golden: a stale locked unit is ignored and no Might effect is registered", () => {
  const base = world().unit("attacker", { owner: "A", might: 3 }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("attacker"), source: base.ref("attacker") });
  const stale = kernel.ref("attacker");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  const bound = chainContext(kernel);
  bound.setTargets("mask-of-foresight.attacking-unit", [stale]);
  const outcome = runAbilityBody([attackTrigger.body[0]], bound);
  assert.deepEqual(outcome.results.map(result => [result.id, result.result]), [
    ["mask-of-foresight.grant-might", { status: "ignored", reason: "mistargeted" }]
  ]);
  assert.equal(kernel.continuousEffects.length, 0);
});

test("Mask of Foresight structure: attack and defend triggers each granting +1 Might this turn", () => {
  assert.equal(program.abilities.length, 2);

  assert.equal(attackTrigger.kind, "triggered");
  assert.equal(attackTrigger.optional, false);
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    object: { type: "unit", controller: "self" }
  });
  assert.equal(attackTrigger.trigger.once, undefined);

  assert.equal(defendTrigger.kind, "triggered");
  assert.equal(defendTrigger.optional, false);
  assert.equal(defendTrigger.trigger.at, "defense-declared");
  assert.deepEqual(defendTrigger.trigger.filter, {
    event: "defense-declared",
    object: { type: "unit", controller: "self" }
  });
  assert.equal(defendTrigger.trigger.once, undefined);

  // “give it +1 :rb_might: this turn” is a temporary Might modification, so the op is the
  // layers continuous.might effect and never effect.buff (CR 702 Buff counters).
  for (const [trigger, id, targetId] of [
    [attackTrigger, "mask-of-foresight.grant-might", "mask-of-foresight.attacking-unit"],
    [defendTrigger, "mask-of-foresight.grant-might-defending", "mask-of-foresight.defending-unit"]
  ]) {
    assert.equal(trigger.body.length, 1);
    const [instruction] = trigger.body;
    assert.equal(instruction.id, id);
    assert.equal(instruction.op, "continuous.might");
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
    assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });
    assert.deepEqual(instruction.args.target, { kind: "constant", value: targetId });
    assert.equal(instruction.linkedTo, undefined);
    assert.equal(instruction.targets.length, 1);
    const [spec] = instruction.targets;
    assert.equal(spec.id, targetId);
    assert.deepEqual(spec.filter, { type: "unit", controller: "controller", zone: "board" });
    assert.equal(spec.min, 1);
    assert.equal(spec.max, 1);
    assert.equal(spec.selection, "one");
  }
});

test.todo(
  "Mask of Foresight: the +1 Might for the rest of the turn needs the layers consumer for " +
    "continuous.might — merged (RIFT-258, golden executes it); the registration still has to be " +
    "driven from the CardProgram trigger (RIFT-257) instead of a locked golden target."
);

test.todo(
  "Mask of Foresight: the “alone” clause is CR v1.5 740.2.a (no other friendly units at the same " +
    "location). None of the merged conditions (always/never/compare/all/any/not/expression) can " +
    "express the same-location friendly-unit check as a single predicate; it needs the predicate " +
    "support anchored on the trigger payload object (740.2.a)."
);

test.todo(
  "Mask of Foresight: “give it …” must bind the triggering unit itself (the attack-declared / " +
    "defense-declared payload object), not an arbitrary friendly unit; that payload-to-effect binding " +
    "and the CardProgram trigger registration are not merged (RIFT-257), and the attack-declared / " +
    "defense-declared producers belong to the combat workstream (RIFT-124)."
);
