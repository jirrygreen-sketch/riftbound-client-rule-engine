import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/sett-kingpin.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { LayerEngine } from "../../../../engine-core/dist/layers/engine.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-8e8505ab8acf50a1be41bbb00297263ad9415f1e111039591ccbaefedd5a2d00";
const [tank, mightAbility] = program.abilities;

test("ogn-240-298 Sett, Kingpin: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-240-298 Sett, Kingpin: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /continuous\.combat/);
  assert.match(program.judgeReason, /count/);
  assert.match(program.judgeReason, /buffed/);
  assert.equal(
    program.sourceText,
    "[Tank] (I must be assigned combat damage first.)\n" +
      "I get +1 :rb_might: for each buffed friendly unit at my battlefield."
  );
});

test("ogn-240-298 Sett, Kingpin: [Tank] expands to a continuous.combat effect", () => {
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });
  // CR 815.1.a-c: the Tank KeywordDef expands to one
  // static continuous.combat damage-assignment requirement; the combat step has
  // no consumer for it yet, so the declaration cannot take effect.
  const definition = keywordDefinitionsById.get("Tank");
  assert.ok(definition, "the merged Tank KeywordDef must be registered");
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "single");
  const [ability] = definition.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.combat");
  assert.equal(ability.effect.mode, "damage-assignment");
  assert.equal(ability.effect.priority, "first");
});

test("ogn-240-298 Sett, Kingpin: the Might bonus counts buffed friendly units at the same battlefield", () => {
  assert.equal(mightAbility.kind, "static");
  assert.equal(mightAbility.effect.kind, "continuous.might");
  assert.equal(mightAbility.effect.mode, "add");
  assert.equal(mightAbility.effect.layer, "arithmetic");
  assert.equal(mightAbility.effect.appliesTo, "self");
  assert.equal(mightAbility.condition, undefined);
  // CR 703: each Buff contributes +1 Might; "for each buffed friendly unit" is a count.
  const amount = mightAbility.effect.amount;
  assert.equal(amount.kind, "count");
  assert.equal(amount.subject, "buffed-friendly-units-at-my-battlefield");
  assert.deepEqual(amount.filter, {
    type: "unit",
    zone: "board",
    controller: "controller",
    sameLocationAs: "self",
    buffed: true
  });
});

test("ogn-240-298 Sett, Kingpin: no buffed units leaves Sett at printed Might", () => {
  const kernel = world()
    .unit("sett", { might: 5, buffs: 0, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const declared = new LayerEngine([kernel.getObject("sett")]);
  declared.addContinuous({
    id: "sett:declared",
    layer: "arithmetic",
    source: kernel.ref("sett"),
    filter: { type: "unit" },
    effect: mightAbility.effect
  }, { type: "permanent" });

  // This zero-count case does not establish support for nonzero dynamic counts;
  // that dependency remains recorded by the TODO below.
  assert.equal(declared.evaluate(kernel.ref("sett")).might, 5);
});

test("ogn-240-298 Sett, Kingpin: the supported literal arithmetic adds to printed Might", () => {
  const kernel = world().unit("sett", { might: 5 }).build();
  const literal = new LayerEngine([kernel.getObject("sett")]);
  literal.addContinuous({
    id: "sett:literal",
    layer: "arithmetic",
    source: kernel.ref("sett"),
    filter: { type: "unit" },
    effect: { ...mightAbility.effect, amount: { kind: "constant", value: 2 } }
  }, { type: "permanent" });

  assert.equal(literal.evaluate(kernel.ref("sett")).might, 7);
  assert.equal(kernel.getObject("sett").might, 5);
});

test.todo(
  "ogn-240-298 Sett, Kingpin: [Tank]'s combat damage assignment requirement (CR 815.1.b/815.1.c, " +
    "815.2): the Tank KeywordDef expands to continuous.combat, " +
    "but the combat step still needs the continuous.combat consumer that enforces lethal-first " +
    "assignment ordering (combat/base-combat-allocation.ts binds none)"
);
test.todo(
  "ogn-240-298 Sett, Kingpin: the per-buffed-unit Might count needs layer arithmetic to evaluate " +
    "count expressions and a 'buffed' (>=1 Buff) filter predicate (CR 702.2.a/702/703); " +
    "sameLocationAs:self is already resolved by the merged static binder"
);
