import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/serene-ascetic.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";

const CANONICAL_ID =
  "card.hash-e5195b063794caf45ca0ef55353be70e2a69d150511f33bccf7dfe8ae729254b";
const SOURCE_TEXT =
  "[Empower] :rb_energy_3: (:rb_energy_3:: Empower me. Use only if not Empowered.)\n" +
  "[Empowered][>] I have [Deflect] and [Shield 3]. (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.+3 :rb_might: while I'm a defender.)";

const [empower, granted] = program.abilities;

test("ven-030-166 Serene Ascetic: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-030-166 Serene Ascetic: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /827\.1\.c\.1/);
  assert.match(program.judgeReason, /828\.1\.b\.1/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-030-166 Serene Ascetic: [Empower] 3 is declared with its printed cost, never re-implemented", () => {
  // 827.1.c.1: the keyword carries the printed 3 Energy activation cost; the
  // expansion belongs to the keyword registry (contract 3.7 / README section 5).
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 3 });
  assert.equal(empower.params, undefined);
});

test("ven-030-166 Serene Ascetic: the [Empowered][>] dependent ability grants Deflect 1 and Shield 3 to self", () => {
  // 828.1.b.1: the whole clause after [Empowered][>] is a Dependent Ability, active
  // while the host is Empowered; the card only declares the grant, the keyword
  // expansions stay in Deflect.ts / Shield.ts (809.1.b.3 presumes 1, 814.1.b.3
  // keeps the printed Shield Value 3).
  assert.equal(granted.kind, "static");
  assert.deepEqual(granted.effect, {
    kind: "continuous.grant-keyword",
    appliesTo: "self",
    keywords: [
      { id: "deflect", value: 1 },
      { id: "shield", value: 3 }
    ]
  });
  // 442.1.a / 828.1.c: the 828.1.b.1 gate is the Empowered status, which has no
  // merged predicate; the descriptive expression keeps the printed scope.
  assert.deepEqual(granted.condition, {
    kind: "expression",
    value: { kind: "constant", value: "empowered" }
  });
});

test("ven-030-166 Serene Ascetic: the granted keywords expand with the printed values", () => {
  // 809.1.c / 814.1.c: the merged KeywordDefs turn each granted keyword into the
  // static target-tax / might shape; this is what the card relies on instead of
  // writing a per-card implementation.
  const [deflectGrant] = granted.effect.keywords;
  const [deflectAbility] = deflect.expand({ value: deflectGrant.value, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(deflectAbility.kind, "static");
  assert.equal(deflectAbility.effect.kind, "target.tax");
  assert.deepEqual(deflectAbility.effect.value, { kind: "constant", value: 1 });

  const shieldGrant = granted.effect.keywords[1];
  const [shieldAbility] = shield.expand({ value: shieldGrant.value, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(shieldAbility.effect.kind, "continuous.might");
  assert.deepEqual(shieldAbility.effect.amount, { kind: "constant", value: 3 });
  assert.equal(shieldAbility.condition.left.property, "designation");
  assert.deepEqual(shieldAbility.condition.right, { kind: "constant", value: "defender" });
});

test.todo(
  "ven-030-166 Serene Ascetic: expand [Empower] 3 (827.1.c.1: '3 Energy: Empower me, use only if " +
    "not Empowered', 827.1.b.1 source is not a target) — no Empower KeywordDef is registered"
);

test.todo(
  "ven-030-166 Serene Ascetic: evaluate the 828.1.b.1 Empowered gate (442.1.a / 442.2) — ObjectSnapshot " +
    "and Condition expose no Empowered status predicate"
);

test.todo(
  "ven-030-166 Serene Ascetic: register the Empowered-gated Deflect/Shield grant as a ContinuousEffectSpec " +
    "and bill the Deflect target tax (809.1.c / 814.1.c) — no merged card-program to continuous-effect producer (RIFT-90/RIFT-91)"
);
