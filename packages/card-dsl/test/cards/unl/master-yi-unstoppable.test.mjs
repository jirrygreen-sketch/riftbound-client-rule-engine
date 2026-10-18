// Published status stays judge-required; existing component coverage is retained below.
// The supported static declaration is covered here; the XP and Level replacement
// consumers remain explicit TODO boundaries below.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/master-yi-unstoppable.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-d985b0a1d9b07b7fc028a94da70fd37a60f56a62bcb6c91698366ce148cefbc9";
const SOURCE_TEXT =
  "[Level 3][>] I cost :rb_energy_2::rb_rune_calm: less. (While you have 3+ XP, get the effect.)\n" +
  "[Level 6][>] I cost :rb_energy_4::rb_rune_calm::rb_rune_calm: less instead.\n" +
  "[Level 11][>] I cost :rb_energy_6::rb_rune_calm::rb_rune_calm::rb_rune_calm: less instead.\n" +
  "[Level 16][>] I can't be chosen by enemy spells and abilities.";

const [level3, level6, level11, level16] = program.abilities;

test("unl-059-219 Master Yi, Unstoppable: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-059-219 Master Yi, Unstoppable: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /XP/);
  assert.match(program.judgeReason, /continuous\.cost-modification|cost\/discounts/);
  assert.match(program.judgeReason, /Untargetable/);
  assert.match(program.judgeReason, /staticTarget/);
  assert.match(program.judgeReason, /choose-as-target/);
});

test("unl-059-219 Master Yi, Unstoppable: each printed [Level N][>] line is one XP-gated dependent ability (824.1.b.1)", () => {
  assert.equal(program.abilities.length, 4);
  for (const ability of program.abilities) {
    assert.equal(ability.kind, "static");
    // 824.1.c: "While you have N or more XP, get the effect." — the contract
    // shape records the player property; the evaluator has no XP reader yet.
    assert.equal(ability.condition.kind, "compare");
    assert.equal(ability.condition.operator, "gte");
    assert.equal(ability.condition.left.kind, "player-property");
    assert.equal(ability.condition.left.player, "controller");
    assert.equal(ability.condition.left.property, "xp");
  }
  assert.deepEqual(
    [level3, level6, level11].map(ability => ability.condition.right),
    [
      { kind: "constant", value: 3 },
      { kind: "constant", value: 6 },
      { kind: "constant", value: 11 }
    ]
  );
  assert.deepEqual(level16.condition.right, { kind: "constant", value: 16 });
});

test("unl-059-219 Master Yi, Unstoppable: the three discounts record their printed Energy and Calm Power amounts (356.4.b / 356.4.c)", () => {
  assert.deepEqual(
    [level3, level6, level11].map(ability => [ability.effect.kind, ability.effect.appliesTo]),
    [
      ["continuous.cost-modification", "self"],
      ["continuous.cost-modification", "self"],
      ["continuous.cost-modification", "self"]
    ]
  );
  assert.equal(level3.effect.stage, "discount");
  assert.deepEqual(level3.effect.reductions, [
    { resource: "energy", amount: 2 },
    { resource: "power", amount: 1, domain: "Calm" }
  ]);
  assert.deepEqual(level6.effect.reductions, [
    { resource: "energy", amount: 4 },
    { resource: "power", amount: 2, domain: "Calm" }
  ]);
  assert.deepEqual(level11.effect.reductions, [
    { resource: "energy", amount: 6 },
    { resource: "power", amount: 3, domain: "Calm" }
  ]);
});

test("unl-059-219 Master Yi, Unstoppable: later Level lines mark their discount as 'instead' (356.1.c / 356.4)", () => {
  assert.equal(level3.effect.instead, false);
  assert.equal(level6.effect.instead, true);
  assert.equal(level11.effect.instead, true);
  // Stable replacement markers keep each printed clause addressable for review.
  assert.deepEqual([level3, level6, level11].map(ability => ability.effect.instead), [false, true, true]);
});

test("unl-059-219 Master Yi, Unstoppable: [Level 16][>] declares Untargetable instead of a discount (756/757.1/758)", () => {
  assert.equal(level16.effect.kind, "continuous.restrict");
  assert.equal(level16.effect.operation, "choose-as-target");
  assert.equal(level16.effect.forbidden, true);
  assert.equal(level16.effect.chooser, "opponent");
  assert.equal(level16.effect.appliesTo, "spells-and-abilities");
  assert.deepEqual(level16.effect.filter, {
    type: "unit",
    zone: "board",
    object: "self"
  });
  assert.equal(level16.effect.value, undefined);
});

test.todo(
  "unl-059-219 Master Yi, Unstoppable: expand [Level N][>] (CR 824.1.b.1: 'while you have N or more XP, this card " +
    "gains [Text]') with dynamic Active/Inactive re-evaluation (824.1.c.1/.d) — player-property(controller, xp) " +
    "is in the contract, but effects/interpreter/expr.ts does not evaluate it"
);

test.todo(
  "unl-059-219 Master Yi, Unstoppable: apply the printed 'I cost [2]/[4]/[6] less' reductions in Finalize with " +
    "the Floors of 356.6 and the instead replacement of 356.1.c — chain/engine.ts still calls buildCostPlan directly, " +
    "and the cost collector has no consumer for the Level instead marker"
);

test.todo(
  "unl-059-219 Master Yi, Unstoppable: make the [Level 16] Untargetable declaration reject illegal target choices " +
    "(CR 756/757/758, 355.9.b) — adapt the declared scope, opposing chooser and XP gate to the existing target-legality consumer"
);
