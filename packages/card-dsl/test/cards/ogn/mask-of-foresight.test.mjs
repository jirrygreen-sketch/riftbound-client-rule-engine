import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/mask-of-foresight.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

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
  assert.equal(
    program.sourceText,
    "When a friendly unit attacks or defends alone, give it +1 :rb_might: this turn."
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
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
    "continuous.might (contract 3.4/3.5; effect.buff explicitly leaves temporary Might changes " +
    "to continuous.might, CR 702 vs 143.2). RIFT-91 owns the layer consumer."
);

test.todo(
  "Mask of Foresight: the “alone” clause is CR v1.5 740.2.a (no other friendly units at the same " +
    "location). None of the merged conditions (always/never/compare/all/any/not/expression) can " +
    "express the same-location friendly-unit check; it needs the keyword/predicate support tracked " +
    "under RIFT-83 / RIFT-87."
);

test.todo(
  "Mask of Foresight: “give it …” must bind the triggering unit itself (the attack-declared / " +
    "defense-declared payload object), not an arbitrary friendly unit; that payload-to-effect binding " +
    "is not merged (RIFT-33 / RIFT-120)."
);
