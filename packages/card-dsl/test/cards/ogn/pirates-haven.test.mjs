import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/pirates-haven.js";

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
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-21/);
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
  assert.equal(instruction.op, "effect.might-modify");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(instruction.targets.length, 1);
  assert.equal(instruction.targets[0].id, "pirates-haven.readied-unit");
  assert.equal(instruction.targets[0].selection, "one");
});

test.todo(
  "Pirate's Haven: +1 Might this turn through a continuous.might layers effect " +
    "(RIFT-91) and event-payload binding of 'it' to the readied unit (RIFT-21)"
);
