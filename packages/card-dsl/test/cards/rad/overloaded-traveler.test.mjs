import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/rad/overloaded-traveler.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-adfd644e08c5d8afc96ca8c90b7a573a5e333bba2b2fb4d364ea5830160dc459";
const [staticAbility] = program.abilities;

test("rad-072-167 Overloaded Traveler: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "While there's a friendly gear with [Deploy] at my battlefield, I have +1 :rb_might:."
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-072-167 Overloaded Traveler: judgeReason names the conditional Might, the Deploy predicate, and the type mismatch", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /\[Deploy\]/);
  assert.match(program.judgeReason, /830\.3/);
  // The catalog types this printing as a Spell with Might 2 while the text is a
  // permanent unit's static ability.
  assert.match(program.judgeReason, /Spell/);
  assert.match(program.judgeReason, /143\.2/);
});

test("rad-072-167 Overloaded Traveler: structure — one static conditional +1 Might on the source", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(staticAbility.kind, "static");
  const { effect } = staticAbility;
  assert.equal(effect.kind, "continuous.might");
  assert.equal(effect.mode, "add");
  assert.equal(effect.layer, "arithmetic");
  assert.equal(effect.appliesTo, "self");
  assert.deepEqual(effect.amount, { kind: "constant", value: 1 });
  assert.equal(effect.duration, "while-conditional");
});

test("rad-072-167 Overloaded Traveler: structure — the friendly-[Deploy]-gear-at-my-battlefield condition", () => {
  const { condition } = staticAbility;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });

  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "friendly-gears-with-deploy-at-my-battlefield");
  // "my battlefield" is the source's own location (sameLocationAs: "self");
  // the [Deploy] qualifier stays in the subject because no merged filter path
  // evaluates a keyword qualifier (judgeReason), and no key is added that
  // nothing would read.
  assert.deepEqual(condition.left.filter, {
    type: "gear",
    controller: "you",
    sameLocationAs: "self"
  });
  assert.equal(Object.hasOwn(condition.left.filter, "keyword"), false);
  assert.equal(Object.hasOwn(condition.left.filter, "keywords"), false);
});

test.todo(
  "rad-072-167 Overloaded Traveler: 'I have +1 Might' while the condition holds needs the " +
    "continuous.might layers consumer (RIFT-91)."
);

test.todo(
  "rad-072-167 Overloaded Traveler: filtering on the [Deploy] keyword needs a keyword predicate in the " +
    "query path (830.3 makes Deploy a checkable characteristic); layers/filter.ts can only test keywords " +
    "through the continuous-effect has-keyword condition, and condition.predicate only consumes Condition " +
    "objects — RIFT-91 keyword predicate work."
);

test.todo(
  "rad-072-167 Overloaded Traveler: the catalog types this printing as Spell with Might 2 while its text " +
    "is a permanent unit's static ability ('I have +1 Might', 'my battlefield'; CR 1.5 143.2/107.2, and " +
    "157/351.2 for spells). Card-data issue report, not a card-program change."
);
