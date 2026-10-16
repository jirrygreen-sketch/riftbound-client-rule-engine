import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/ember-monk.js";

const CANONICAL = "card.hash-2845da03b74c83b71b9acc70abe634678cc7dd57b5a5ab5a2dbc7386c52d089a";
const [ability] = program.abilities;
const [instruction] = ability.body;

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-84/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(
    program.sourceText,
    "When you play a card from [Hidden], give me +2 :rb_might: this turn."
  );
});

test("trigger records the intended 'played from Hidden' card-played filter", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { fromHidden: true }
  });
  assert.equal(ability.optional, false);
});

test("body records the +2 Might-this-turn self grant and does not fake it as a Buff counter", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "ember-monk.grant-might");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(instruction.targets, [
    {
      id: "ember-monk.self",
      filter: { object: "self", type: "unit" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // No effect.buff instruction: a Buff counter would be a different effect (703).
  assert.notEqual(instruction.op, "effect.buff");
});

test.todo(
  "execute the +2 Might grant once continuous.might is registered through the layers work (RIFT-91)"
);
test.todo(
  "trigger on cards played from Hidden/facedown: the card-played payload needs a Hidden origin discriminator " +
    "and the Hidden keyword expansion (811.1.d, RIFT-84)"
);
