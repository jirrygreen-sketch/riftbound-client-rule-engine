import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/kayle-justified.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";

const CANONICAL_ID =
  "card.hash-bc9496bbf6f7cd918c02c302dd1a30bdc473b07744028532891c56fa80672908";
const SOURCE_TEXT =
  "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me.)\n" +
  "I can be [Empowered] up to three times.\n" +
  "I have +2 :rb_might: for each time I'm [Empowered].\n" +
  "While I'm [Empowered] three times, I have [Deflect 3] and [Ganking].";

const [empower, empowerLimit, mightPerEmpower, keywordGrant] = program.abilities;

test("ven-134-166 Kayle, Justified: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-134-166 Kayle, Justified: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /442\.1\.c\.1/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /Deflect/);
});

test("ven-134-166 Kayle, Justified: [Empower] plus the printed three-times permission", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
  assert.equal(keywordDefinitionsById.get("Empower"), undefined);
  assert.equal(keywordDefinitionsById.get("Empowered"), undefined);

  // 442.1.c.1: this object may be Empowered up to three times (effect.empower's
  // multiple/limit parameters exist for exactly this printed permission).
  assert.equal(empowerLimit.kind, "static");
  assert.deepEqual(empowerLimit.effect, {
    kind: "empower-limit",
    limit: { kind: "constant", value: 3 },
    appliesTo: "self"
  });
});

test("ven-134-166 Kayle, Justified: +2 Might per Empowered instance and the three-times keyword grant", () => {
  assert.equal(mightPerEmpower.kind, "static");
  assert.equal(mightPerEmpower.effect.kind, "continuous.might");
  assert.equal(mightPerEmpower.effect.layer, "arithmetic");
  assert.deepEqual(mightPerEmpower.effect.perEmpower, { kind: "constant", value: 2 });
  assert.equal(mightPerEmpower.effect.appliesTo, "self");

  // “[Deflect 3] and [Ganking]” while Empowered three times: a keyword grant with
  // a gate on the Empowered count (no predicate exists yet).
  assert.equal(keywordGrant.kind, "static");
  assert.equal(keywordGrant.effect.kind, "continuous.grant-keyword");
  assert.deepEqual(keywordGrant.effect.keywords, [
    { id: "Deflect", value: 3 },
    { id: "Ganking" }
  ]);
  assert.equal(keywordGrant.condition.kind, "compare");
  assert.deepEqual(keywordGrant.condition.left, {
    kind: "object-property",
    object: "self",
    property: "empoweredCount"
  });
  assert.equal(keywordGrant.condition.operator, "gte");
  assert.deepEqual(keywordGrant.condition.right, { kind: "constant", value: 3 });
});

test("ven-134-166 Kayle, Justified: the unmerged ops stay unmerged", () => {
  // Guards against a future silent approximation: neither the Might modifier nor
  // the keyword grant has a registered primitive today.
  assert.equal(instructionDefinitionsById.get("continuous.might"), undefined);
  assert.equal(instructionDefinitionsById.get("continuous.grant-keyword"), undefined);
});

test.todo(
  "ven-134-166 Kayle, Justified: [Empower] expansion (827.1.c.1: 3 Energy, 'empower me') needs " +
    "an Empower KeywordDef — none is merged"
);

test.todo(
  "ven-134-166 Kayle, Justified: the up-to-three Empowered stacking (442.1.c.1) needs an " +
    "Empowered-count predicate wired into effect.empower's multiple/limit params"
);

test.todo(
  "ven-134-166 Kayle, Justified: '+2 :rb_might: for each time I'm [Empowered]' needs the " +
    "card-side continuous.might primitive plus layers registration (RIFT-91)"
);

test.todo(
  "ven-134-166 Kayle, Justified: '[Deflect 3] and [Ganking]' while Empowered three times needs " +
    "a continuous keyword-grant primitive (no continuous.grant-keyword consumer is merged)"
);
