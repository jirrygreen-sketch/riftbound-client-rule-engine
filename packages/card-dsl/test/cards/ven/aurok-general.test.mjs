import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/aurok-general.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL_ID =
  "card.hash-74533231e291deb55f594e5f04b19faf248214fac82769433d2d3387166f0bad";
const SOURCE_TEXT =
  "[Empower] :rb_energy_3::rb_rune_order: (:rb_energy_3::rb_rune_order:: Empower me. " +
  "Use only if not Empowered.)\n[Empowered][>] Your units that are [Empowered] have " +
  "+2 :rb_might: (including me).";

const [empower, aura] = program.abilities;

test("ven-130-166 Aurok General: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-130-166 Aurok General: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("ven-130-166 Aurok General: [Empower] is declared and stays unexpanded", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  // The merged keyword registry holds no Empower/Empowered KeywordDef, so
  // 827.1.c.1's cost and 'use only if not Empowered' cannot be expanded.
  assert.equal(keywordDefinitionsById.get("Empower"), undefined);
  assert.equal(keywordDefinitionsById.get("Empowered"), undefined);
});

test("ven-130-166 Aurok General: the Empowered dependent aura shape", () => {
  assert.equal(aura.kind, "static");
  assert.equal(aura.effect.kind, "continuous.might");
  assert.equal(aura.effect.mode, "add");
  assert.equal(aura.effect.layer, "arithmetic");
  assert.deepEqual(aura.effect.amount, { kind: "constant", value: 2 });
  // “Your units that are [Empowered] (including me)”: a controller-scoped unit
  // filter with the 442.1.a Empowered status gate; both are descriptive because
  // no Empowered predicate and no card-side continuous.might consumer exist.
  assert.deepEqual(aura.effect.filter, {
    type: "unit",
    zone: "board",
    controller: "controller",
    empowered: true
  });
});

test.todo(
  "ven-130-166 Aurok General: [Empower] expansion (827.1.c.1: 3 Energy + 1 Order Power, " +
    "'use only if not Empowered') needs an Empower KeywordDef — none is merged"
);

test.todo(
  "ven-130-166 Aurok General: the +2 Might aura needs an Empowered status predicate (442.1.a) " +
    "and the card-side continuous.might registration into layers (RIFT-87 / RIFT-91)"
);

