// Golden test for Frostcoat Mother (ven-032-166).
//
// Execution evidence (the registered per-rune cost rewrite behind its
// fail-closed bind, the Empowered-gated +3 Might with its Disempower boundary
// and the blocked printed [Empower] activation) lives in the RIFT-673
// parameterized template golden:
// test/cards/templates/keyword-static-static-673.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of the printed abilities.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/frostcoat-mother.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-af86d71346754f5a19f63ebf193cb978f3d3dffe541f342d86bd89ab951eefb8";
const SOURCE_TEXT =
  "[Empower] :rb_energy_12:. This ability costs :rb_energy_1: less for each rune you control. (Pay the cost: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have +3 :rb_might:.";

const [empower, costReduction, might] = program.abilities;

test("ven-032-166 Frostcoat Mother: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-032-166 Frostcoat Mother: judgeReason names the cost, condition and consumer gaps", () => {
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /827\.1\.c\.3/);
  assert.match(program.judgeReason, /Empowered/);
  assert.match(program.judgeReason, /expandProgram/);
  assert.match(program.judgeReason, /appliesTo/);
  assert.match(program.judgeReason, /费用消费方/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-032-166 Frostcoat Mother: [Empower] carries the printed 12 Energy and no invented activation", () => {
  // 827.1.c.1: the activation, its cost rewrite and its restriction belong to the
  // keyword layer, so the card only declares the printed keyword value.
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 12 });
  assert.equal(program.abilities.some(ability => ability.kind === "activated"), false);
});

test("ven-032-166 Frostcoat Mother: 'costs 1 less for each rune you control' is a rewrite of that Empower activation", () => {
  // 827.1.c.3 / 206.1: the clause is part of determining the Empower cost, not an
  // independent effect; 133.5.a.1 / 431.1 make the count the controller's runes.
  assert.equal(costReduction.kind, "static");
  assert.deepEqual(costReduction.effect, {
    kind: "continuous.cost-modification",
    resource: "energy",
    appliesTo: "empower-activation-cost",
    per: "rune-you-control",
    minimum: 0,
    amount: {
      kind: "arithmetic",
      operator: "neg",
      operands: [{
        kind: "count",
        subject: "runes",
        filter: { type: "rune", controller: "self", zone: "rune-zone" }
      }]
    }
  });
  assert.equal(costReduction.condition, undefined);
});

test("ven-032-166 Frostcoat Mother: the [Empowered][>] dependent ability is +3 Might to self", () => {
  // 828.1.b.1 / 143.2.a: the bonus lives in the arithmetic layer while the host is Empowered.
  assert.equal(might.kind, "static");
  assert.deepEqual(might.effect, {
    kind: "continuous.might",
    mode: "add",
    layer: "arithmetic",
    appliesTo: "self",
    amount: { kind: "constant", value: 3 }
  });
  assert.deepEqual(might.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "empowered" },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test.todo(
  "ven-032-166 Frostcoat Mother: the printed 12 Energy needs KeywordAbility/params.cost wiring into Empower.expand " +
    "and the per-rune rewrite needs a binding plus an Empower-cost consumer (827.1.c.1 / 827.1.c.3); " +
    "the merged ObjectSnapshot still lacks the Empowered state contract (442.1.a)"
);
