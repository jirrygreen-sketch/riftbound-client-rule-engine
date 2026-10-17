import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/needlessly-large-yordle.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";

const CARD_ID = "card.hash-fd21f689bd36e48ea3071e7d21c1fa68fd1527e85ca97ffd9052664f6aaba7de";
const SOURCE_TEXT =
  "[Shield 5] (+5 :rb_might: while I'm a defender.)\n" +
  "[Tank] (I must be assigned combat damage first.)\n" +
  "I cost :rb_energy_2::rb_rune_calm: less for each point you scored from holding this turn.";

const [shieldAbility, tankAbility, discount] = program.abilities;

test("sfd-055-221 Needlessly Large Yordle: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-055-221 Needlessly Large Yordle: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Shield/);
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /designation/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-055-221 Needlessly Large Yordle: Shield 5 and Tank keyword declarations (814 / 815)", () => {
  assert.equal(program.abilities.length, 3);
  // 814.1.b/814.1.b.2: X is the printed Shield Value, here 5.
  assert.deepEqual(shieldAbility, { kind: "keyword", keyword: "shield", value: 5 });
  // 815: Tank carries no value.
  assert.deepEqual(tankAbility, { kind: "keyword", keyword: "tank" });
});

test("sfd-055-221 Needlessly Large Yordle: the cost reduction is per holding point, in both resources (356.1/356.4)", () => {
  assert.equal(discount.kind, "static");
  assert.equal(discount.condition, undefined);
  assert.equal(discount.effect.kind, "continuous.cost-modification");
  assert.equal(discount.effect.appliesTo, "self");
  assert.deepEqual(discount.effect.reductions, [
    { resource: "energy", amount: -2, per: "point-scored-from-holding-this-turn" },
    { resource: "power", domain: "Calm", amount: -1, per: "point-scored-from-holding-this-turn" }
  ]);
});

test("sfd-055-221 Needlessly Large Yordle: the merged Shield definition owns the printed 5 (814.1.c)", () => {
  assert.equal(shield.keyword, "Shield");
  assert.equal(shield.stacking, "sum");
  const [might] = shield.expand({ value: 5, host: { canonicalCardId: CARD_ID } });
  assert.equal(might.kind, "static");
  assert.equal(might.effect.kind, "continuous.might");
  assert.deepEqual(might.effect.amount, { kind: "constant", value: 5 });
  assert.equal(might.effect.mode, "add");
  assert.equal(might.effect.layer, "arithmetic");
  assert.equal(might.effect.appliesTo, "self");
  // 814.1.d: the bonus applies only while the unit holds the Defender designation.
  assert.equal(might.condition.kind, "compare");
  assert.equal(might.condition.left.property, "designation");
  assert.deepEqual(might.condition.right, { kind: "constant", value: "defender" });
});

test.todo(
  "sfd-055-221 Needlessly Large Yordle: [Shield 5] needs the Defender designation as a readable " +
    "characteristic so the expanded continuous.might gate can be evaluated (814.1.d/814.1.d.1; the merged " +
    "ObjectSnapshot has no designation and layers/engine.ts does not evaluate compare conditions)"
);

test.todo(
  "sfd-055-221 Needlessly Large Yordle: [Tank]'s damage-assignment priority (815.1.b/815.1.c.1/.c.2) needs " +
    "the merged Tank KeywordDef's continuous.combat declaration plus combat allocation support; " +
    "combat/base-combat-allocation.ts still lacks Tank and Backline consumption"
);

test.todo(
  "sfd-055-221 Needlessly Large Yordle: the discount must be collected at Finalize as -2 Energy and -1 Calm " +
    "Power per point scored from holding this turn (356.1/356.4; and the plan must never go below 0 Power), " +
    "which needs both the card-static cost-binding path and a history count of this turn's hold points"
);
