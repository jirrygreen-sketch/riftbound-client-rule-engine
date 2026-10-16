import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/sett-kingpin.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { LayerEngine } from "../../../../engine-core/dist/layers/engine.js";

const CANONICAL = "card.hash-8e8505ab8acf50a1be41bbb00297263ad9415f1e111039591ccbaefedd5a2d00";
const [tank, mightAbility] = program.abilities;

const settObject = (values = {}) => ({
  ref: { id: "sett", zoneEntryId: 1 },
  cardId: "card:ogn-240-298",
  name: "Sett, Kingpin",
  types: ["unit"],
  tags: ["Ionia"],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: { type: "battlefield", id: "battlefield-1" },
  might: 5,
  energy: 4,
  power: ["Order"],
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false,
  ...values
});

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
  assert.match(program.judgeReason, /count/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(
    program.sourceText,
    "[Tank] (I must be assigned combat damage first.)\n" +
      "I get +1 :rb_might: for each buffed friendly unit at my battlefield."
  );
});

test("ogn-240-298 Sett, Kingpin: [Tank] is declared but has no registered keyword expansion", () => {
  assert.deepEqual(tank, { kind: "keyword", keyword: "tank" });
  // CR 815.1.a-c: Tank is a passive ability keyword on units; without a KeywordDef and a
  // combat-damage-assignment consumer the declaration cannot take effect.
  assert.equal(keywordDefinitionsById.has("Tank"), false);
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

test("ogn-240-298 Sett, Kingpin: the layers arithmetic consumer ignores the count expression (stays at printed Might)", () => {
  // The layer engine's valueOf() does not evaluate a "count" expression, so the declared
  // amount resolves to nothing and the ability contributes no Might. With a literal amount
  // the same effect does move the arithmetic layer, which isolates the gap.
  const declared = new LayerEngine([settObject()]);
  declared.addContinuous({
    id: "sett:declared",
    layer: "arithmetic",
    source: { id: "sett", zoneEntryId: 1 },
    filter: { type: "unit" },
    effect: mightAbility.effect
  }, { type: "permanent" });
  assert.equal(declared.evaluate({ id: "sett", zoneEntryId: 1 }).might, 5);

  const literal = new LayerEngine([settObject()]);
  literal.addContinuous({
    id: "sett:literal",
    layer: "arithmetic",
    source: { id: "sett", zoneEntryId: 1 },
    filter: { type: "unit" },
    effect: { ...mightAbility.effect, amount: { kind: "constant", value: 2 } }
  }, { type: "permanent" });
  assert.equal(literal.evaluate({ id: "sett", zoneEntryId: 1 }).might, 7);
});

test.todo(
  "ogn-240-298 Sett, Kingpin: [Tank]'s combat damage assignment requirement (CR 815.1.b/815.1.c, " +
    "815.2) needs a Tank KeywordDef plus the combat continuous consumer"
);
test.todo(
  "ogn-240-298 Sett, Kingpin: the per-buffed-unit Might count needs layer arithmetic to evaluate " +
    "count expressions and a 'buffed' (>=1 Buff) plus same-location filter predicate (CR 702.2.a/702/703, RIFT-91)"
);
