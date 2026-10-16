import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/soul-sword.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CARD_ID = "card.hash-87e2eedcbebff6711e1c1841d161efbe5d63d047836446fb4ececd034911f1be";
const SOURCE_TEXT = "[Equip] :rb_rune_calm: (:rb_rune_calm:: Attach this to a unit you control.)";

const [equip] = program.abilities;

test("unl-039-219 Soul Sword: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Equip|equip/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("unl-039-219 Soul Sword: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("unl-039-219 Soul Sword: single Equip declaration carrying one Calm Power and no energy symbol", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // 818.1.c: printed cost is a single Calm rune symbol.
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Calm");
  // Contrast with sfd/nazuman-ntofo (pure energy Equip): this printing has no energy part.
  assert.equal(SOURCE_TEXT.includes(":rb_energy_1:"), false);
  assert.equal(SOURCE_TEXT.includes(":rb_rune_calm:"), true);
});

test("unl-039-219 Soul Sword: the merged Equip expansion stays valid EffectIR for this card", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  assert.equal(definition.keyword, "Equip");
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "separate");

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

  const [activation] = expansion;
  assert.equal(activation.kind, "activated");
  assert.equal(activation.timing, "action");
  assert.equal(activation.cost.payments.length >= 1, true);
  assert.deepEqual(activation.body.map((step) => [step.id, step.op]), [
    ["equip-attach", "effect.attach"]
  ]);
  assert.equal(activation.body[0].targets.length, 1);
  assert.equal(activation.body[0].targets[0].id, "equip-target");
  assert.equal(activation.body[0].targets[0].min, 1);
  assert.equal(activation.body[0].targets[0].max, 1);
  assert.equal(activation.body[0].targets[0].selection, "one");
  assert.equal(activation.body[0].targets[0].filter.type, "unit");
});

test.todo(
  "unl-039-219 Soul Sword: pay the printed Equip cost (1 Calm Power, 818.1.c / 818.1.c.3) through the cost plan " +
    "and attach the gear end-to-end (RIFT-89 follow-up)"
);
test.todo(
  "unl-039-219 Soul Sword: the card-program -> keyword expansion -> chain wiring (contract 3.5) is required " +
    "before the declared KeywordAbility is expanded at runtime"
);
