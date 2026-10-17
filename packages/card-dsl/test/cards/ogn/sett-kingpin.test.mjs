import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/sett-kingpin.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

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
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.equal(
    program.sourceText,
    "[Tank] (I must be assigned combat damage first.)\n" +
      "I get +1 :rb_might: for each buffed friendly unit at my battlefield."
  );
});

test("ogn-240-298 Sett, Kingpin: [Tank] expands to a continuous.combat effect", () => {
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });
  // CR 815.1.a-c: the Tank KeywordDef is merged (RIFT-264) and expands to one
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

test.todo(
  "ogn-240-298 Sett, Kingpin: [Tank]'s combat damage assignment requirement (CR 815.1.b/815.1.c, " +
    "815.2): the Tank KeywordDef is merged (RIFT-264) and expands to continuous.combat, " +
    "but the combat step still needs the continuous.combat consumer that enforces lethal-first " +
    "assignment ordering (combat/base-combat-allocation.ts binds none)"
);
test.todo(
  "ogn-240-298 Sett, Kingpin: the per-buffed-unit Might count needs layer arithmetic to evaluate " +
    "count expressions and a 'buffed' (>=1 Buff) plus same-location filter predicate (CR 702.2.a/702/703)"
);
