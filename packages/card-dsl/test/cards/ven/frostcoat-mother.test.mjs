import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/frostcoat-mother.js";

const CANONICAL_ID =
  "card.hash-af86d71346754f5a19f63ebf193cb978f3d3dffe541f342d86bd89ab951eefb8";
const SOURCE_TEXT =
  "[Empower] :rb_energy_12:. This ability costs :rb_energy_1: less for each rune you control. (Pay the cost: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have +3 :rb_might:.";

const [empower, costReduction, might] = program.abilities;

test("ven-032-166 Frostcoat Mother: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-032-166 Frostcoat Mother: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /827\.1\.c\.3/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-91/);
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
    value: {
      kind: "count",
      subject: "runes",
      filter: { type: "rune", controller: "self", zone: "rune-zone" }
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
    kind: "expression",
    value: { kind: "constant", value: "empowered" }
  });
});

test.todo(
  "ven-032-166 Frostcoat Mother: expand [Empower] 12 with the 827.1.c.3 per-rune cost rewrite and the " +
    "827.1.c.5 'use only if not Empowered' restriction — no Empower KeywordDef and no cost 'per-rune' consumer (RIFT-89)"
);

test.todo(
  "ven-032-166 Frostcoat Mother: register the Empowered-gated +3 Might (828.1.b.1, 143.2.a) — no card-side " +
    "continuous.might registration and no Empowered status predicate (RIFT-87/RIFT-91)"
);
