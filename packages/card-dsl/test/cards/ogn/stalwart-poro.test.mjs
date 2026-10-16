import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/stalwart-poro.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL_ID =
  "card.hash-d758a4eb01d27daf80036a95c8930bef4e01df5c77bf18f8f92392c7dd708701";
const SOURCE_TEXT = "[Shield] (+1 :rb_might: while I'm a defender.)";

test("ogn-052-298 Stalwart Poro: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-052-298 Stalwart Poro: identity, status, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogn-052-298 Stalwart Poro: judgeReason names the missing wiring and its tasks", () => {
  assert.match(program.judgeReason, /Shield/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /814\.1\.d/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /conditionMatches/);
  assert.match(program.judgeReason, /RIFT-105/);
});

test("ogn-052-298 Stalwart Poro: exactly one unvalued Shield keyword ability", () => {
  // CR 814.1.b.3: the omitted X is presumed to be 1, so the card omits value.
  assert.equal(program.abilities.length, 1);
  const [keyword] = program.abilities;
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "shield");
  assert.equal(keyword.value, undefined);
});

test("ogn-052-298 Stalwart Poro: the declared keyword id matches the registered KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Shield");
  assert.ok(registered, "effects/keywords/Shield.ts must be in the generated registry");
  assert.equal(program.abilities[0].keyword, registered.keyword.toLowerCase());
  assert.ok(registered.ruleRefs.includes("814.1.c"));
  assert.ok(registered.ruleRefs.includes("814.1.d.1"));
  // 814.2: granted Shield values sum into one value.
  assert.equal(registered.stacking, "sum");
});

test("ogn-052-298 Stalwart Poro: the expansion is gated on the Defender designation, not applied unconditionally", () => {
  const [expansion] = shield.expand({ host: { canonicalCardId: program.canonicalCardId } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.might");
  assert.equal(expansion.effect.mode, "add");
  assert.equal(expansion.effect.layer, "arithmetic");
  assert.equal(expansion.effect.appliesTo, "self");
  // CR 814.1.b.3 + 814.1.c: the omitted value is 1 and the bonus only exists
  // while the unit holds the Defender designation (814.1.d/814.1.d.1).
  assert.deepEqual(expansion.effect.amount, { kind: "constant", value: 1 });
  assert.equal(expansion.condition.kind, "compare");
  assert.equal(expansion.condition.left.kind, "object-property");
  assert.equal(expansion.condition.left.object, "self");
  assert.equal(expansion.condition.left.property, "designation");
  assert.equal(expansion.condition.operator, "eq");
  assert.deepEqual(expansion.condition.right, { kind: "constant", value: "defender" });
});

test.todo(
  "Stalwart Poro: +1 Might while I am a defender (CR 814.1.c) — blocked because no merged consumer "
    + "registers a card's static/keyword expansion as a continuous effect, because layers/engine.ts "
    + "does not evaluate the compare condition, and because the "
    + "Defender designation of CR 814.1.d is not yet an ObjectSnapshot characteristic (contract 3.8 "
    + "combatRole, RIFT-105 branch)"
);

test.todo(
  "Stalwart Poro: Shield stacking proves no double application when a second source grants Shield 3 "
    + "(CR 814.2 sums to one Shield 4) — blocked on the same card-static-to-layers registration path"
);
