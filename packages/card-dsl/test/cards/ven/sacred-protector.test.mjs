import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/sacred-protector.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-e99af0758d26984ed89173384615fc55536c8bab7b751efe428c2565832ff0f7";
const SOURCE_TEXT =
  "I don't deal combat damage unless I'm at a battlefield with exactly one other unit you control.";

const [ability] = program.abilities;
const condition = ability.condition;

// The static effect cannot be executed (no continuous.combat consumer), but its
// condition clause is ordinary IR and runs through the merged predicate kernel.
const predicate = {
  id: "sacred-protector.condition",
  op: "condition.predicate",
  args: { condition: { kind: "constant", value: condition } }
};

const protectedKernel = ({ allies, enemies = 0, allyLocation, enemyLocation }) => {
  const builder = world().player("controller");
  builder.unit("sacred-protector", {
    controller: "controller",
    location: { type: "battlefield", id: "bf-1" }
  });
  for (let index = 0; index < allies; index++) {
    builder.unit(`ally-${index}`, {
      controller: "controller",
      location: { type: "battlefield", id: allyLocation ?? "bf-1" }
    });
  }
  for (let index = 0; index < enemies; index++) {
    builder.unit(`enemy-${index}`, {
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: enemyLocation ?? "bf-1" }
    });
  }
  const base = builder.build();
  return base.clone({
    controller: "controller",
    sourceSnapshot: base.getObject("sacred-protector")
  });
};

test("ven-129-166 Sacred Protector: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-129-166 Sacred Protector: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.combat/);
  assert.match(program.judgeReason, /467\.2\.c\.1\.a/);
  assert.match(program.judgeReason, /combat consumer/);
  assert.match(program.judgeReason, /RIFT-258/);
  assert.match(program.judgeReason, /RIFT-257/);
});

test("ven-129-166 Sacred Protector: one static no-combat-damage ability with the exactly-one condition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.deepEqual(ability.effect, {
    kind: "continuous.combat",
    mode: "no-combat-damage",
    appliesTo: "self"
  });
  // Contract 3.4: the condition clause belongs to the ability it guards.
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "eq");
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "other-friendly-units-here");
  // “exactly one other unit you control” = same battlefield, controlled by you,
  // excluding the source itself (contract 3.6 selector shapes).
  assert.deepEqual(condition.left.filter, {
    type: "unit",
    zone: "board",
    controller: "controller",
    sameLocationAs: "self",
    exclude: "self"
  });
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
});

test("ven-129-166 golden: the printed condition is true with exactly one other friendly unit here", () => {
  const kernel = protectedKernel({ allies: 1 });
  const outcome = runAbilityBody([predicate], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["sacred-protector.condition.value"], true);
});

test("ven-129-166 golden: zero or two other friendly units here make the condition false", () => {
  for (const allies of [0, 2]) {
    const kernel = protectedKernel({ allies });
    const outcome = runAbilityBody([predicate], kernel);
    assert.equal(outcome.status, "executed");
    assert.equal(
      outcome.linkedValues["sacred-protector.condition.value"],
      false,
      `allies=${allies}`
    );
  }
});

test("ven-129-166 golden: a friendly unit at another battlefield does not satisfy 'here'", () => {
  const elsewhere = protectedKernel({ allies: 1, allyLocation: "bf-2" });
  assert.equal(
    runAbilityBody([predicate], elsewhere).linkedValues["sacred-protector.condition.value"],
    false
  );
});

test("ven-129-166 golden: an enemy unit here is not 'a unit you control'", () => {
  const withEnemy = protectedKernel({ allies: 1, enemies: 1 });
  assert.equal(
    runAbilityBody([predicate], withEnemy).linkedValues["sacred-protector.condition.value"],
    true
  );
});

test.todo(
  "ven-129-166 Sacred Protector: preventing its combat damage (467.2.c.1.a) needs the " +
    "combat consumer for continuous.combat (the RIFT-258 primitive is merged but returns negated/impossible " +
    "without a consumer) plus the combat start/simultaneous-damage transactions"
);
