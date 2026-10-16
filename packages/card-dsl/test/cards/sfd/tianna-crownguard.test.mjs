import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/tianna-crownguard.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";

const CARD_ID = "card.hash-d4d3c7fbd236daf76867733cea0af3151a9d91e178cb072e3bbb88c4391fef22";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "While I'm at a battlefield, opponents can't score points.";

const [deflectAbility, restriction] = program.abilities;

test("sfd-060-221 Tianna Crownguard: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-060-221 Tianna Crownguard: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /470/);
  assert.match(program.judgeReason, /RIFT-9/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-060-221 Tianna Crownguard: [Deflect] keyword plus a conditionally active anti-score restriction", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deflectAbility, { kind: "keyword", keyword: "deflect" });

  assert.equal(restriction.kind, "static");
  assert.equal(restriction.effect.kind, "continuous.restrict");
  // 470/470.1: this forbids the Scoring process (471.1/471.2), it does not undo
  // points already gained and is not a damage/prevention effect.
  assert.equal(restriction.effect.operation, "score");
  assert.equal(restriction.effect.forbidden, true);
  assert.equal(restriction.effect.appliesTo, "opponents");
  // 363.2.a: the continuous effect applies only while its condition holds —
  // "While I'm at a battlefield".
  assert.equal(restriction.condition.kind, "expression");
  assert.deepEqual(restriction.condition.value, {
    kind: "object-property",
    object: "self",
    property: "at-battlefield"
  });
});

test("sfd-060-221 Tianna Crownguard: the Deflect keyword definition is merged and stacks by sum (809.2)", () => {
  assert.equal(deflect.keyword, "Deflect");
  assert.equal(deflect.stacking, "sum");
  const [tax] = deflect.expand({ value: undefined, host: { canonicalCardId: CARD_ID } });
  assert.equal(tax.kind, "static");
  assert.equal(tax.effect.kind, "target.tax");
  // 809.1.b.3: the omitted Deflect value is presumed 1.
  assert.deepEqual(tax.effect.value, { kind: "constant", value: 1 });
});

test.todo(
  "sfd-060-221 Tianna Crownguard: 'opponents can't score points' needs a registered continuous.restrict " +
    "primitive/consumer on the Scoring path (470/471.1/471.2) plus the 363.2.a Location predicate — the " +
    "frozen GameAction set has no forbid-score action and scoring/ reads no continuous restrictions — RIFT-9 / RIFT-31"
);

test.todo(
  "sfd-060-221 Tianna Crownguard: [Deflect]'s target tax must be collected when an opponent chooses this unit " +
    "and paid as any-domain Power (809.1.c.1) instead of the Energy-shaped tax the chain builds today — " +
    "RIFT-90 / RIFT-89"
);
