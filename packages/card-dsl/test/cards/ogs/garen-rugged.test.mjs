// Golden test for Garen, Rugged (ogs-007-024).
//
// The card prints two keywords in one block, so the runnable evidence is the
// two declarations plus the merged Assault/Shield KeywordDef expansions for
// this exact card identity. The layer wiring that would add +2 Might while
// attacking or defending is still missing (see judgeReason and the test.todo
// entries at the bottom).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/garen-rugged.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import assault from "../../../../engine-core/dist/effects/keywords/Assault.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";

const CANONICAL_ID =
  "card.hash-4cb8d7a21af85e64b1351cadd5764e7d72532c46a93c2c85289c8c4351c33818";
const SOURCE_TEXT =
  "[Assault 2], [Shield 2] (+2 :rb_might: while I'm an attacker or defender.)";
const HOST = { canonicalCardId: CANONICAL_ID };

test("ogs-007-024 Garen, Rugged: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogs-007-024 Garen, Rugged: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README section 2: the reason must name the missing semantics and the
  // dependent tasks, not just "needs support".
  assert.match(program.judgeReason, /Assault/);
  assert.match(program.judgeReason, /Shield/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /conditionMatches/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogs-007-024 Garen, Rugged: exactly two valued keyword abilities, Assault 2 then Shield 2", () => {
  // The printed "[Assault 2], [Shield 2]" is two keywords, in printed order, each
  // carrying its own Assault Value / Shield Value of 2 (CR 807.1.b.1-2, 814.1.b.1-2).
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities, [
    { kind: "keyword", keyword: "assault", value: 2 },
    { kind: "keyword", keyword: "shield", value: 2 }
  ]);
});

test("ogs-007-024 Garen, Rugged: both declared keywords resolve to the merged KeywordDefs", () => {
  const registeredAssault = keywordDefinitionsById.get("Assault");
  const registeredShield = keywordDefinitionsById.get("Shield");
  assert.ok(registeredAssault, "effects/keywords/Assault.ts must be in the generated registry");
  assert.ok(registeredShield, "effects/keywords/Shield.ts must be in the generated registry");
  assert.equal(registeredAssault, assault);
  assert.equal(registeredShield, shield);
  // RIFT-258 merged the continuous.might instruction that the expansions
  // register through; the card-side keyword expansion binding (RIFT-257) and
  // the designation/compare evaluation remain the gaps (see judgeReason).
  assert.equal(instructionDefinitionsById.has("continuous.might"), true);
  // Card IR uses the lowercase keyword ids; the registry is keyed by printed names.
  assert.equal(program.abilities[0].keyword, registeredAssault.keyword.toLowerCase());
  assert.equal(program.abilities[1].keyword, registeredShield.keyword.toLowerCase());
  // CR 807.2 / 814.2: same-named keywords from several sources sum into one value.
  assert.equal(registeredAssault.stacking, "sum");
  assert.equal(registeredShield.stacking, "sum");
  assert.ok(registeredAssault.ruleRefs.includes("807.1.c"));
  assert.ok(registeredShield.ruleRefs.includes("814.1.c"));
});

test("ogs-007-024 Garen, Rugged: Assault 2 is +2 Might gated on the Attacker designation", () => {
  const expansion = assault.expand({ value: program.abilities[0].value, host: HOST });
  assert.equal(expansion.length, 1);
  const [ability] = expansion;
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.effect.appliesTo, "self");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 2 });
  // CR 807.1.c / 807.1.d.1: applies only while the Unit holds the Attacker designation.
  assert.equal(ability.condition.kind, "compare");
  assert.equal(ability.condition.left.kind, "object-property");
  assert.equal(ability.condition.left.object, "self");
  assert.equal(ability.condition.left.property, "designation");
  assert.equal(ability.condition.operator, "eq");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: "attacker" });
});

test("ogs-007-024 Garen, Rugged: Shield 2 is +2 Might gated on the Defender designation", () => {
  const expansion = shield.expand({ value: program.abilities[1].value, host: HOST });
  assert.equal(expansion.length, 1);
  const [ability] = expansion;
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.effect.appliesTo, "self");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 2 });
  // CR 814.1.c / 814.1.d.1: applies only while the Unit holds the Defender designation.
  assert.equal(ability.condition.kind, "compare");
  assert.equal(ability.condition.left.property, "designation");
  assert.equal(ability.condition.operator, "eq");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: "defender" });
});

test("ogs-007-024 Garen, Rugged: the combined reminder maps to one role per keyword, never one merged +2", () => {
  // The single printed reminder "(+2 :rb_might: while I'm an attacker or
  // defender.)" is the reminder text for BOTH keywords, not a third ability:
  // Assault 2 answers for the attacker role (CR 807.1.c) and Shield 2 for the
  // defender role (CR 814.1.c). A Unit holds its controller's designation and
  // loses the opposite one (CR 323.2.a/323.2.b), so the two +2s are never both
  // applicable to the same Unit in one Combat.
  const attackerAbility = assault.expand({ value: program.abilities[0].value, host: HOST })[0];
  const defenderAbility = shield.expand({ value: program.abilities[1].value, host: HOST })[0];
  assert.equal(attackerAbility.condition.right.value, "attacker");
  assert.equal(defenderAbility.condition.right.value, "defender");
  assert.notEqual(attackerAbility.condition.right.value, defenderAbility.condition.right.value);
  assert.equal(attackerAbility.effect.amount.value, defenderAbility.effect.amount.value);
});

test("ogs-007-024 Garen, Rugged: both expansions validate as EffectIR for this card identity", () => {
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: [
      ...assault.expand({ value: program.abilities[0].value, host: HOST }),
      ...shield.expand({ value: program.abilities[1].value, host: HOST })
    ],
    sourceText: program.sourceText
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);
});

test("ogs-007-024 Garen, Rugged: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test.todo(
  "Garen, Rugged: +2 Might exactly while the 5 Might unit holds the Attacker designation and +2 while it " +
    "holds the Defender designation (CR 807.1.c / 814.1.c) — blocked because no merged producer resolves " +
    "a card's keyword abilities into their KeywordDef expansions and registers them through " +
    "layers/engine.ts (contract 3.5/3.7), because the Attacker/Defender designations are not " +
    "ObjectSnapshot characteristics (contract 3.8 combatRole; RIFT-105 branch), and because " +
    "layers/engine.ts conditionMatches does not evaluate the compare predicate (RIFT-91)"
);

test.todo(
  "Garen, Rugged: CR 807.2 / 814.2 (with CR 466.2.c.3) — a second Assault or Shield source sums per keyword, " +
    "and role exclusivity keeps the two +2s from stacking in one Combat; keywords already declare " +
    "stacking \"sum\", execution depends on the same card-static-to-layers registration path"
);
