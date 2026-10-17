// Golden test for Wuju Bladesman, Starter (ogs-019-024).
//
// The card declares one conditional Passive Ability ("While a friendly unit
// defends alone, it gets +2 :rb_might:.") as a continuous.might static effect
// (contract 3.1 / 3.7). The guard predicate has no merged evaluator, so the
// runnable evidence is validation, identity, the structural contract, and the
// registry lookup; the missing layer wiring is recorded as test.todo.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/wuju-bladesman-starter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-cf38f851f4d3c20ede56526fcc1ad4c1ed2581cc73341deaa53ea09e51c15790";
const SOURCE_TEXT = "While a friendly unit defends alone, it gets +2 :rb_might:.";
const [ability] = program.abilities;

test("ogs-019-024 Wuju Bladesman, Starter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogs-019-024 Wuju Bladesman, Starter: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // README section 2: name the missing semantics and the dependent tasks.
  assert.match(program.judgeReason, /defends alone/);
  assert.match(program.judgeReason, /740\.2\.a/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /conditionMatches/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /Legend Zone/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ogs-019-024 Wuju Bladesman, Starter: one static +2 Might aura over friendly units", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // CR 364.3.a / 363: "While …" is the condition of a Passive Ability, which is
  // computed by the layers (continuous effects never enter the chain).
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 2 });
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    // The frozen PlayerSelector spelling for the ability controller (190.6.d).
    controller: "self",
    zone: "board",
    // Descriptive spelling of the "defends alone" guard (Defender designation +
    // CR 740.2.a "no other friendly units at the same location"); see judgeReason
    // for why no merged evaluator consumes it.
    defendsAlone: true
  });
  assert.equal(ability.effect.duration, undefined);
  // The ability has no instruction body: a static ability is not played or resolved.
  assert.equal(ability.body, undefined);
});

test("ogs-019-024 Wuju Bladesman, Starter: the aura is gated, never an unconditional +2", () => {
  // The guard cannot be dropped without changing the card: a bare
  // continuous.might on every friendly unit would grant +2 outside combat and
  // to units that are not defending alone. Assert the guard is present and is
  // NOT one of the layer conditions the merged engine evaluates
  // (always/never/type/has-tag/has-keyword), so the gap stays visible.
  const filterKeys = Object.keys(ability.effect.filter);
  assert.ok(filterKeys.includes("defendsAlone"));
  assert.equal(ability.effect.filter.type, "unit");
  assert.equal(ability.effect.filter.controller, "self");
  assert.equal(ability.effect.filter.zone, "board");
  // No Might condition would be honest: the card has no Might threshold.
  assert.equal(ability.effect.filter.mightGte, undefined);
  assert.equal(ability.condition, undefined);
});

test.todo(
  "Wuju Bladesman, Starter: a friendly unit gets +2 Might exactly while it defends alone " +
    "(CR 363/364.3.a + 740.2.a: Defender designation from CR 466.2.c.3 with no other friendly " +
    "unit at the same location) — blocked because layers/filter.ts reads neither the merged " +
    "ObjectSnapshot.combatRole (contract 3.8) nor any same-location exclusion predicate, because " +
    "layers/engine.ts conditionMatches silently passes unknown guards, and because no merged " +
    "producer registers a card's static ability as a continuous effect (contract 3.5/3.7; RIFT-257)"
);

test.todo(
  "Wuju Bladesman, Starter: the resolution of the aura from the Legend Zone (CR 107.4.c / " +
    "174.2.b / 174.6) — the frozen ZoneId (effects/contract.ts) and the reference kernel have no " +
    "legend zone, and a static ability has no field to declare its source zone"
);
