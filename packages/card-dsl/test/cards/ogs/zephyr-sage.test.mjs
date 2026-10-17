// Golden test for Zephyr Sage (ogs-005-024).
//
// The whole card is a single printed Shield keyword, so the runnable evidence
// is the declaration plus the merged KeywordDef expansion for this exact card
// identity. The layer wiring that would actually add +1 Might during Combat is
// still missing (see judgeReason and the test.todo entries at the bottom).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/zephyr-sage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL_ID =
  "card.hash-2b68503e65fe0121f9346680649fa82fb83b4edc1e53b3a7416db4848ce941c6";
const SOURCE_TEXT = "[Shield] (+1 :rb_might: while I'm a defender.)";
const HOST = { canonicalCardId: CANONICAL_ID };

test("ogs-005-024 Zephyr Sage: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogs-005-024 Zephyr Sage: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README section 2: a judge-required program must name the missing primitive/
  // rule and the dependent tasks, not merely say "needs support".
  assert.match(program.judgeReason, /Shield/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /conditionMatches/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogs-005-024 Zephyr Sage: exactly one unvalued Shield keyword ability", () => {
  // CR 814.1.b.3: the omitted X is presumed to be 1, so the card declares no
  // value; the default lives in effects/keywords/Shield.ts.
  assert.equal(program.abilities.length, 1);
  assert.deepEqual(program.abilities, [{ kind: "keyword", keyword: "shield" }]);
  assert.equal(program.abilities[0].value, undefined);
});

test("ogs-005-024 Zephyr Sage: the declared keyword id resolves to the merged Shield KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Shield");
  assert.ok(registered, "effects/keywords/Shield.ts must be in the generated registry");
  assert.equal(registered, shield);
  assert.equal(registered.keyword, "Shield");
  // Card IR uses the lowercase keyword id; the registry is keyed by the printed name.
  assert.equal(program.abilities[0].keyword, registered.keyword.toLowerCase());
  assert.equal(registered.valued, true);
  // CR 814.2: Shield from several sources sums into a single value.
  assert.equal(registered.stacking, "sum");
  assert.ok(registered.ruleRefs.includes("814.1.c"));
  assert.ok(registered.ruleRefs.includes("814.1.d.1"));
});

test("ogs-005-024 Zephyr Sage: the expansion is +1 Might gated on the Defender designation", () => {
  const expansion = shield.expand({ host: HOST });
  assert.equal(expansion.length, 1);
  const [ability] = expansion;
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.effect.appliesTo, "self");
  // CR 814.1.b.3 + 814.1.c: the omitted value is 1 and it applies only while
  // the Unit holds the Defender designation (814.1.d / 814.1.d.1).
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
  assert.equal(ability.condition.kind, "compare");
  assert.equal(ability.condition.left.kind, "object-property");
  assert.equal(ability.condition.left.object, "self");
  assert.equal(ability.condition.left.property, "designation");
  assert.equal(ability.condition.operator, "eq");
  assert.deepEqual(ability.condition.right, { kind: "constant", value: "defender" });
});

test("ogs-005-024 Zephyr Sage: the expansion validates as EffectIR for this card identity", () => {
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: shield.expand({ host: HOST }),
    sourceText: program.sourceText
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);
});

test("ogs-005-024 Zephyr Sage: the generated card registry exposes the program under its canonical id", () => {
  // The registry is build-time codegen over src/cards/**; the golden must prove
  // the new card actually reaches the shared index, not just the file system.
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test.todo(
  "Zephyr Sage: +1 Might exactly while the 6 Might unit holds the Defender designation in Combat " +
    "(CR 814.1.c/814.1.d.1) — blocked because no merged producer resolves a card's keyword ability " +
    "into its KeywordDef expansion and registers it through layers/engine.ts (contract 3.5/3.7; RIFT-257), " +
    "because no layer/filter consumer reads the merged combatRole/designation characteristic " +
    "(contract 3.8), and because layers/engine.ts conditionMatches does not evaluate the compare " +
    "predicate, so the condition would be ignored (RIFT-91 follow-up)"
);

test.todo(
  "Zephyr Sage: CR 814.2 — Shield from a second source sums with this printed Shield into one value " +
    "(keywords/Shield.ts already declares stacking \"sum\"; execution depends on the same " +
    "card-static-to-layers registration path)"
);
