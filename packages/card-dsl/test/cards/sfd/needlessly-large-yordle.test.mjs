import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/needlessly-large-yordle.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";
import tank from "../../../../engine-core/dist/effects/keywords/Tank.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";

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

test("sfd-055-221 Needlessly Large Yordle: the expanded Shield 5 never applies because its condition is unevaluable", () => {
  // 814.1.d/814.1.d.1: the +5 applies only while the host is a defender. The
  // expanded condition reads the "designation" characteristic, which the merged
  // ObjectSnapshot does not carry (only combatRole) and layers/engine.ts
  // conditionMatches does not evaluate compare conditions, so the bonus stays off.
  const kernel = world()
    .unit("yordle", { cardId: CARD_ID, might: 5, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const source = kernel.getObject("yordle");
  const layers = createLayerEngine([source]);
  const [might] = shield.expand({ value: 5, host: { canonicalCardId: CARD_ID } });
  const handle = createEngineStaticBinder({ layers }).bindStatic(might, source);
  assert.equal(layers.evaluate(source.ref).might, 5);
  assert.deepEqual(layers.registry.list().map((entry) => entry.effect.effect.kind), ["continuous.might"]);
  handle.unbind();
});

test("sfd-055-221 Needlessly Large Yordle: the Tank expansion is registered but has no combat consumer", () => {
  // 815.1.b/815.1.c.1/.c.2: Tank is a damage-assignment priority. The merged
  // binder persists continuous.combat, but that kind has no layer branch and
  // combat/base-combat-allocation.ts only accepts keywordPriority: "proven-none",
  // so the printed assignment rule cannot be enforced.
  const kernel = world()
    .unit("yordle", { cardId: CARD_ID, might: 5, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const source = kernel.getObject("yordle");
  const layers = createLayerEngine([source]);
  const [combat] = tank.expand({ value: undefined, host: { canonicalCardId: CARD_ID } });
  assert.equal(combat.effect.kind, "continuous.combat");
  const handle = createEngineStaticBinder({ layers }).bindStatic(combat, source);
  const [entry] = layers.registry.list();
  assert.equal(entry.effect.effect.kind, "continuous.combat");
  // The layer engine has no branch for it: no Might, no buff, no assignment rule.
  assert.equal(layers.evaluate(source.ref).might, 5);
  assert.equal(layers.evaluate(source.ref).buffs, 0);
  handle.unbind();
});

test("sfd-055-221 Needlessly Large Yordle: the card-static discount never reaches a cost plan", () => {
  // 356.1/356.4: the printed discount is a static continuous.cost-modification.
  // The merged binder refuses that kind, so no CostPlanInput.discounts list can
  // ever receive the -2 Energy / -1 Calm Power reduction.
  const kernel = world()
    .unit("yordle", { cardId: CARD_ID, might: 5, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const source = kernel.getObject("yordle");
  const layers = createLayerEngine([source]);
  assert.throws(
    () => createEngineStaticBinder({ layers }).bindStatic(discount, source),
    /Static ability kind continuous\.cost-modification has no layer mapping/
  );
  assert.deepEqual(layers.registry.list(), []);
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
