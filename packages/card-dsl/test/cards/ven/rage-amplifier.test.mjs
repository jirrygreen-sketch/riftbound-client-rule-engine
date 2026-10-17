// Golden test for Rage Amplifier (ven-018-166).
//
// Execution evidence (the +1/+2 instead branches driven by a real Empower and
// Disempower through the merged chain, plus the refused printed [Empower]
// activation) lives in the RIFT-675 parameterized template golden:
// test/cards/templates/static-static-675.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of the printed abilities.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/rage-amplifier.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL =
  "card.hash-d253644e2551694bc909320c263dcb18818de02f076039f478f45ef0e36eff91";
const SOURCE_TEXT =
  "[Empower] :rb_energy_6::rb_rune_fury: (:rb_energy_6::rb_rune_fury:: Empower this. Use only if not Empowered.)\n" +
  "Your units have +1 :rb_might:. If I'm [Empowered], they have +2 :rb_might: instead.";

const [empower, baseMight, empoweredMight] = program.abilities;

test("ven-018-166 Rage Amplifier: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-018-166 Rage Amplifier: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /828\.1\.c/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /params\.cost/);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-018-166 Rage Amplifier: the printed Empower cost is declared as the keyword, not expanded", () => {
  assert.equal(program.abilities.length, 3);
  assert.equal(empower.kind, "keyword");
  assert.equal(empower.keyword, "empower");
  // 827.1.c: the printed cost is 6 Energy plus one Fury Power rune.
  assert.equal(empower.value, 6);
  assert.equal(empower.costDomain, "Fury");
  // 827.1.c.1's activation cost / disempower guard must come from the keyword
  // expansion; the card adds no second activated ability.
  assert.ok(program.abilities.every(ability => ability.kind !== "activated"));
});

test("ven-018-166 Rage Amplifier: +1 Might for your units, and the Empowered +2 instead branch", () => {
  // 828.1.b.1: the default branch applies while the source is not Empowered.
  assert.equal(baseMight.kind, "static");
  assert.equal(baseMight.effect.kind, "continuous.might");
  assert.equal(baseMight.effect.mode, "add");
  assert.equal(baseMight.effect.layer, "arithmetic");
  assert.deepEqual(baseMight.effect.amount, { kind: "constant", value: 1 });
  // 740.1.a: "Your units" is the ability controller's units on the Board (365.1).
  assert.deepEqual(baseMight.effect.filter, {
    type: "unit",
    controller: "controller",
    zone: "board"
  });
  assert.deepEqual(baseMight.condition, {
    kind: "not",
    condition: {
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "empowered" },
      operator: "gte",
      right: { kind: "constant", value: 1 }
    }
  });

  // "instead": the Empowered branch replaces the +1 with +2, it is not a
  // second, additional modification.
  assert.equal(empoweredMight.kind, "static");
  assert.equal(empoweredMight.effect.kind, "continuous.might");
  assert.deepEqual(empoweredMight.effect.amount, { kind: "constant", value: 2 });
  assert.deepEqual(empoweredMight.effect.insteadOf, {
    kind: "constant",
    value: "rage-amplifier-base-might"
  });
  assert.deepEqual(empoweredMight.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
  assert.deepEqual(empoweredMight.effect.filter, baseMight.effect.filter);
});

test.todo(
  "ven-018-166 Rage Amplifier: [Empower] 6 Energy + 1 Fury Power must expand to its activation cost with the " +
    "\"use only if not Empowered\" restriction (827.1.c.1 / 442.1.b) - the registered Empower KeywordDef needs " +
    "params.cost forwarding from KeywordAbility through programs/keywords.ts"
);
test.todo(
  "ven-018-166 Rage Amplifier: the production Activation path must expose the live Empowered state so the " +
    "+1/+2 instead branches (828.1.c) stay exclusive outside the RIFT-675 template scenarios; the activation " +
    "cost forwarding is the first blocked piece"
);

