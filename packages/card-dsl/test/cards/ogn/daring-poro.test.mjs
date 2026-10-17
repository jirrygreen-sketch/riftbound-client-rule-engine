import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import daringPoro from "../../../dist/cards/ogn/daring-poro.js";
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";

const CANONICAL =
  "card.hash-406baf0c2f39d1eb52f69f43bb251ddd06afca820b412de6486e3112ed87bb21";
const HOST = { canonicalCardId: CANONICAL };

test("ogn-210-298 Daring Poro: program passes validateCardProgram", () => {
  const result = validateCardProgram(daringPoro);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-210-298 Daring Poro: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(daringPoro.canonicalCardId, CANONICAL);
  assert.equal(daringPoro.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(daringPoro.status, "judge-required");
  assert.match(daringPoro.judgeReason, /Assault/);
  assert.match(daringPoro.judgeReason, /combatRole/);
  assert.equal(daringPoro.sourceText, "[Assault] (+1 :rb_might: while I'm an attacker.)");
});

test("ogn-210-298 Daring Poro: the only ability is the Assault keyword declaration", () => {
  assert.equal(daringPoro.abilities.length, 1);
  // CR 807.1.b.3: the printed keyword omits X, so no value is written and the
  // default 1 comes from keywords/Assault.ts.
  assert.deepEqual(daringPoro.abilities, [{ kind: "keyword", keyword: "assault" }]);
  assert.equal(daringPoro.abilities[0].value, undefined);
});

test("ogn-210-298 Daring Poro: declared keyword resolves to the merged Assault definition (RIFT-81)", () => {
  const [declaration] = daringPoro.abilities;
  assert.equal(assault.keyword, "Assault");
  assert.equal(assault.valued, true);
  // Assault is CR 807.2 sum-stacking; the omitted value defaults to 1.
  assert.equal(assault.stacking, "sum");
  assert.equal(assault.expand({ value: declaration.value, host: HOST })[0].effect.amount.value, 1);
});

test("ogn-210-298 Daring Poro: CR 807.1.c is +1 Might while the Attacker designation is held", () => {
  const [ability] = assault.expand({ value: daringPoro.abilities[0].value, host: HOST });
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.effect.appliesTo, "self");
  assert.equal(ability.effect.amount.value, 1);
  // The +1 is gated on holding the Attacker designation (807.1.d/807.1.d.1).
  assert.equal(ability.condition.kind, "compare");
  assert.equal(ability.condition.operator, "eq");
  assert.equal(ability.condition.left.kind, "object-property");
  assert.equal(ability.condition.left.object, "self");
  assert.equal(ability.condition.left.property, "designation");
  assert.equal(ability.condition.right.value, "attacker");
});

test.todo(
  "Daring Poro: +1 Might applies exactly while the unit holds the Attacker designation (CR 807.1.c/807.1.d.1) " +
    "and drops back to 2 outside Combat — blocked on the designation/combatRole " +
    "mapping, live CombatFlow designation, and LayerEngine compare-condition evaluation"
);

test.todo(
  "Daring Poro: CR 807.2 stacking — a granted Assault 3 merges with this printed Assault into a single Assault 4 " +
    "and one +4 Might expansion through the existing Assault stacking definition"
);
