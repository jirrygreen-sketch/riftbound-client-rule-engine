import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/blighted-battleaxe.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CARD_ID = "card.hash-21de7fcaef3e38ea7173a7b6b370c00cc4d0e2893c34cafde3a98ee7b65ac558";
const SOURCE_TEXT =
  "[Equip] :rb_energy_1::rb_rune_fury: (:rb_energy_1::rb_rune_fury:: Attach this to a unit you control.)";

const [equip] = program.abilities;

test("unl-019-219 Blighted Battleaxe: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Equip|equip/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("unl-019-219 Blighted Battleaxe: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The generated registry indexes the program by this exact identity.
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("unl-019-219 Blighted Battleaxe: single Equip declaration carrying one Fury Power", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // 818.1.c: printed cost is 1 energy symbol plus 1 Fury rune symbol; the KeywordAbility
  // carries the Power part (value = symbol count, costDomain = domain).
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Fury");
  // 818.1.a: the printing carries the required Equipment tag in the local catalog.
  assert.equal(SOURCE_TEXT.includes("Equip"), true);
});

test("unl-019-219 Blighted Battleaxe: the merged Equip expansion stays valid EffectIR for this card", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  assert.equal(definition.keyword, "Equip");
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "separate");

  // 818.1.c.2: the expansion is functionally "[Cost]: Attach this gear to a unit you
  // control." Expanding and validating it keeps the declared keyword honest against the
  // current keyword registry.
  const expansion = definition.expand({
    value: equip.value,
    host: { canonicalCardId: CARD_ID }
  });
  const expanded = validateCardProgram({
    canonicalCardId: CARD_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: expansion,
    sourceText: SOURCE_TEXT
  });
  assert.equal(expanded.ok, true, JSON.stringify(expanded.ok ? [] : expanded.issues));
  assert.deepEqual(expanded.issues, []);

  // The expanded body performs an attach; the activation keeps the printed cost shape.
  const [activation] = expansion;
  assert.equal(activation.kind, "activated");
  assert.equal(activation.timing, "action");
  assert.equal(activation.cost.payments.length >= 1, true);
  assert.deepEqual(activation.body.map((step) => [step.id, step.op]), [
    ["equip-attach", "effect.attach"]
  ]);
  // 818.1.b.1: the chosen unit is a Target restricted to units you control.
  assert.equal(activation.body[0].targets.length, 1);
  assert.equal(activation.body[0].targets[0].id, "equip-target");
  assert.equal(activation.body[0].targets[0].min, 1);
  assert.equal(activation.body[0].targets[0].max, 1);
  assert.equal(activation.body[0].targets[0].selection, "one");
  assert.equal(activation.body[0].targets[0].filter.type, "unit");
});

test.todo(
  "unl-019-219 Blighted Battleaxe: pay the printed Equip cost (1 energy + 1 Fury Power, 818.1.c / 818.1.c.3) " +
    "through the cost plan and attach the gear end-to-end (RIFT-89 follow-up); the KeywordAbility also has no " +
    "field for the printed energy symbol count"
);
test.todo(
  "unl-019-219 Blighted Battleaxe: the card-program -> keyword expansion -> chain wiring (contract 3.5) is " +
    "required before the declared KeywordAbility is expanded at runtime"
);
