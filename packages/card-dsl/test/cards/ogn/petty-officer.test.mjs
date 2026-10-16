import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import pettyOfficer from "../../../dist/cards/ogn/petty-officer.js";
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL =
  "card.hash-2daf12389f3f2209c75815321b3f70aaadfe8d1f9e8cc4b3dd747c93c0f780dc";
const HOST = { canonicalCardId: CANONICAL };

test("ogn-215-298 Petty Officer: program passes validateCardProgram", () => {
  const result = validateCardProgram(pettyOfficer);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-215-298 Petty Officer: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(pettyOfficer.canonicalCardId, CANONICAL);
  assert.equal(pettyOfficer.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(pettyOfficer.status, "judge-required");
  assert.match(pettyOfficer.judgeReason, /Assault/);
  assert.match(pettyOfficer.judgeReason, /combatRole/);
  assert.match(pettyOfficer.judgeReason, /RIFT-257/);
  assert.match(pettyOfficer.judgeReason, /RIFT-264/);
  assert.match(pettyOfficer.judgeReason, /RIFT-258/);
  assert.equal(pettyOfficer.sourceText, "[Assault] (+1 :rb_might: while I'm an attacker.)");
});

test("ogn-215-298 Petty Officer: exactly one unvalued Assault keyword ability", () => {
  assert.equal(pettyOfficer.abilities.length, 1);
  assert.deepEqual(pettyOfficer.abilities, [{ kind: "keyword", keyword: "assault" }]);
  assert.equal(pettyOfficer.abilities[0].value, undefined);
});

test("ogn-215-298 Petty Officer: the declared keyword resolves to the merged Assault definition", () => {
  assert.equal(keywordDefinitionsById.get("Assault"), assault);
  const [ability] = assault.expand({ value: pettyOfficer.abilities[0].value, host: HOST });
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.amount.value, 1, "807.1.b.3 default for a valueless printing");
  assert.equal(ability.condition.left.property, "designation");
  assert.equal(ability.condition.right.value, "attacker");
});

test("ogn-215-298 Petty Officer: the Assault expansion validates as EffectIR for this card identity", () => {
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: assault.expand({ value: pettyOfficer.abilities[0].value, host: HOST }),
    sourceText: pettyOfficer.sourceText
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);
});

test.todo(
  "Petty Officer: +1 Might exactly while the 5 Might unit holds the Attacker designation (CR 807.1.c/807.1.d.1) — " +
    "blocked on ObjectSnapshot.combatRole (契约 3.8) and a layer condition that evaluates compare (RIFT-258)"
);

test.todo(
  "Petty Officer: CR 807.2 — Assault granted by another source sums with this printed Assault into one merged value " +
    "(RIFT-264 stacking \"sum\" 已声明；执行依赖 RIFT-257 CardProgram → 关键词→图层接线)"
);
