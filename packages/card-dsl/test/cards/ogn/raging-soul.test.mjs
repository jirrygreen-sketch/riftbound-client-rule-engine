// Golden test for Raging Soul (ogn-019-298).
//
// Execution evidence (a real discard through the merged chain, the
// no-discard and opponent-discard boundaries and the host-only keyword grants)
// lives in the RIFT-675 parameterized template golden:
// test/cards/templates/static-static-675.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of both conditional self-grants.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/raging-soul.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-55958c501a029c3b3b6cc885be9c3637445d707ccf6347d1f0338abd97718571";
const [assaultGrant, gankingGrant] = program.abilities;

test("raging-soul: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("raging-soul: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /Assault\/Ganking 的 KeywordDef/);
  // The card static binding is merged; the current condition/history and
  // designation gaps are recorded against their real consumers.
  assert.match(program.judgeReason, /programs\/statics\.ts 的 bindStaticToLayers/);
  assert.match(program.judgeReason, /ctx\.history/);
  assert.match(program.judgeReason, /条件历史查询未接通/);
  assert.ok(!/RIFT-359/.test(program.judgeReason));
  assert.ok(!/没有任何已合入消费方把卡牌 static 能力注册进图层/.test(program.judgeReason));
  assert.equal(
    program.sourceText,
    "If you've discarded a card this turn, I have [Assault] and [Ganking]. " +
      "(+1 :rb_might: while I'm an attacker. I can move from battlefield to battlefield.)"
  );
});

test("raging-soul: two static self-grants, one per keyword (807.1, 810.1)", () => {
  assert.equal(program.abilities.length, 2);
  for (const grant of program.abilities) {
    assert.equal(grant.kind, "static");
    assert.equal(grant.effect.kind, "continuous.grant-keyword");
    assert.equal(grant.effect.appliesTo, "self");
  }
  assert.equal(assaultGrant.effect.keyword, "assault");
  // 807.1.b.3: no printed Assault value, so the grant is Assault 1.
  assert.equal(assaultGrant.effect.value, undefined);
  assert.equal(gankingGrant.effect.keyword, "ganking");
});

test("raging-soul: both grants share the same 'discarded a card this turn' condition (364.3.a, 423.1)", () => {
  const expectedCondition = {
    kind: "compare",
    left: {
      kind: "count",
      subject: "cards-discarded-this-turn",
      filter: { player: "controller" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  };
  assert.deepEqual(assaultGrant.condition, expectedCondition);
  assert.deepEqual(gankingGrant.condition, expectedCondition);
  assert.notEqual(assaultGrant.condition, gankingGrant.condition, "each ability owns its own condition object");
});

test.todo(
  "ogn-019-298 Raging Soul: the granted Assault still needs the Attacker designation (807.1.c/807.1.d.1; " +
    "ObjectSnapshot.combatRole is frozen in contract 3.8 but no combat flow produces it)"
);
test.todo(
  "ogn-019-298 Raging Soul: the granted Ganking permission must reach the Standard Move legality checks — " +
    "the KeywordDef emits a string permission while layers/rules/query.ts movement() reads the normalized " +
    "permission.routes shape (810.1.c, 144.4.c)"
);
test.todo(
  "ogn-019-298 Raging Soul: evaluate the 'discarded a card this turn' gate from ctx.history({ scope: 'turn', " +
    "action: 'discard' }) instead of the live set query that counts the host itself (364.3.a, 423.1)"
);
