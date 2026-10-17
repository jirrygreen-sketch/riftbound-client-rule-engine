import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/pirates-haven.js";
import might from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

test("ogn-143-298 Pirate's Haven: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-143-298 Pirate's Haven: identity, version and verbatim source text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-0dd1405dd6c76acb2f2f4eaf062ac11f4c35f9cf7548386d976200c9b22d2547"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When you ready a friendly unit, give it +1 :rb_might: this turn."
  );
  assert.match(program.judgeReason, /事件对象选择器/);
});

test("ogn-143-298 Pirate's Haven: object-readied trigger structure", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-readied");
  assert.equal(ability.trigger.filter.event, "object-readied");
  assert.deepEqual(ability.trigger.filter.object, { type: "unit" });
  assert.equal(ability.trigger.filter.player, "self");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);

  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(instruction.targets.length, 1);
  assert.equal(instruction.targets[0].id, "pirates-haven.readied-unit");
  assert.equal(instruction.targets[0].selection, "one");
});

test("ogn-143-298 Pirate's Haven: continuous.might registers +1 for the locked unit", () => {
  const [instruction] = program.abilities[0].body;
  const kernel = world()
    .unit("pirates-haven", { types: ["gear"], zone: "board" })
    .unit("readied-unit", { owner: "A", controller: "A", might: 2, zone: "board" })
    .build();
  const run = runInstruction(
    might,
    {
      amount: instruction.args.amount,
      duration: instruction.args.duration,
      target: instruction.args.target.value
    },
    {
      world: kernel,
      targets: { "pirates-haven.readied-unit": [kernel.ref("readied-unit")] }
    }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, 1);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
});

test.todo(
  "Pirate's Haven: bind the continuous.might target to the object-readied event's unit " +
    "through an event-object selector in the ObjectSelector contract"
);
