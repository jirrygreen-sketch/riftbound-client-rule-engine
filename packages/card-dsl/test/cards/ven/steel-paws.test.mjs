import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/steel-paws.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";

const CANONICAL_ID =
  "card.hash-d1cb46188e07e26d280977537ff04f5a6daa76c60e4a224b15aa5a8c64b3b1aa";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "[Empower] :rb_energy_7: (:rb_energy_7:: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have +7 :rb_might:.";

const [deflectKeyword, empower, might] = program.abilities;

test("ven-043-166 Steel Paws: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-043-166 Steel Paws: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // 809.1.b.3 leaves the omitted Deflect Value at 1; the card must not invent one.
  assert.deepEqual(deflectKeyword, { kind: "keyword", keyword: "deflect" });
  assert.match(program.judgeReason, /809\.1\.c\.1/);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-043-166 Steel Paws: [Deflect] expands to the presumed value 1 target tax", () => {
  // 809.1.b.3 / 809.1.c: the merged KeywordDef presumes 1 and declares the tax;
  // nothing merges permanent tax into target selection yet (judgeReason).
  const [expansion] = deflect.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "target.tax");
  assert.deepEqual(expansion.effect.value, { kind: "constant", value: 1 });
});

test("ven-043-166 Steel Paws: [Empower] 7 and the Empowered +7 Might dependent ability", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 7 });
  assert.equal(might.kind, "static");
  assert.deepEqual(might.effect, {
    kind: "continuous.might",
    mode: "add",
    layer: "arithmetic",
    appliesTo: "self",
    amount: { kind: "constant", value: 7 }
  });
  assert.deepEqual(might.condition, {
    kind: "expression",
    value: { kind: "constant", value: "empowered" }
  });
});

test.todo(
  "ven-043-166 Steel Paws: expand [Empower] 7 (827.1.c.1) — no Empower/Empowered KeywordDef is registered"
);

test.todo(
  "ven-043-166 Steel Paws: bill the Deflect tax as any-domain Power when an opponent chooses this unit " +
    "(809.1.c / 809.1.c.1) — no permanent tax -> target/cost consumer (RIFT-90) and the closed six-domain union " +
    "cannot express [A]"
);

test.todo(
  "ven-043-166 Steel Paws: register the Empowered-gated +7 Might (828.1.b.1, 143.2.a) — no card-side " +
    "continuous.might registration and no Empowered status predicate (RIFT-87/RIFT-91)"
);
