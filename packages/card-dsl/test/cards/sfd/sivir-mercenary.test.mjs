// Golden test for Sivir, Mercenary (sfd-143-221).
//
// Execution evidence (the real printed 4 Energy + 1 Chaos Power payment, the
// still-closed "spent at least [A][A]" gate, the fail-closed accelerate.cost
// bind and the blocked printed expectations) lives in the RIFT-673
// parameterized template golden:
// test/cards/templates/keyword-static-static-673.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of the printed abilities.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sivir-mercenary.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-bd07122c30b6cd8a4c4c84c4bcce0070fad8ea471344189ee61fb766cb54e888";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
  "If you've spent at least :rb_rune_rainbow::rb_rune_rainbow: this turn, I have +2 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)";

const [accelerate, mightStatic, gankingStatic] = program.abilities;

test("sfd-143-221 Sivir, Mercenary: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-143-221 Sivir, Mercenary: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The refreshed reason cites the missing spent/cost-receipt read, the
  // condition-closure behaviour of the production binder, the Ganking
  // movement-permission gap and the unmapped accelerate.cost shape.
  assert.match(program.judgeReason, /135\.2\.e\.5\.a/);
  assert.match(program.judgeReason, /spent/);
  assert.match(program.judgeReason, /evaluateCondition/);
  assert.match(program.judgeReason, /powerSpentThisTurn/);
  assert.match(program.judgeReason, /permission\.routes/);
  assert.match(program.judgeReason, /accelerate\.cost/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
});

test("sfd-143-221 Sivir, Mercenary: Accelerate keyword declared, never re-expanded in the card", () => {
  assert.equal(program.abilities.length, 3);
  // 805: the optional additional cost and the enter-ready replacement belong to
  // effects/keywords/Accelerate.ts (contract 3.7).
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
});

test("sfd-143-221 Sivir, Mercenary: the +2 Might half is a conditioned arithmetic-layer static ability", () => {
  assert.equal(mightStatic.kind, "static");
  // 143.2.a / 475-477: Might is altered in the arithmetic layer, never through a
  // Buff counter (702-704).
  assert.equal(mightStatic.effect.kind, "continuous.might");
  assert.equal(mightStatic.effect.mode, "add");
  assert.equal(mightStatic.effect.layer, "arithmetic");
  assert.equal(mightStatic.effect.appliesTo, "self");
  assert.deepEqual(mightStatic.effect.amount, { kind: "constant", value: 2 });

  // "If you've spent at least [A][A] this turn" — the recorded condition shape;
  // the turn's Power-spent amount has no read interface (see judgeReason).
  assert.equal(mightStatic.condition.kind, "compare");
  assert.equal(mightStatic.condition.operator, "gte");
  assert.deepEqual(mightStatic.condition.right, { kind: "constant", value: 2 });
  assert.deepEqual(mightStatic.condition.left, {
    kind: "object-property", object: "source", property: "powerSpentThisTurn"
  });
});

test("sfd-143-221 Sivir, Mercenary: the Ganking half is declared as a conditional keyword grant", () => {
  assert.equal(gankingStatic.kind, "static");
  // 810.1.b / 810.3: Ganking is a Passive Ability keyword; the grant is the
  // continuous.grant-keyword shape whose expansion lives in
  // effects/keywords/Ganking.ts (contract 3.7), not restated here.
  assert.equal(gankingStatic.effect.kind, "continuous.grant-keyword");
  assert.equal(gankingStatic.effect.appliesTo, "self");
  assert.deepEqual(gankingStatic.effect.keyword, { id: "Ganking" });
  // A passive grant is live while the source/condition applies, with no own turn expiry.
  assert.equal(gankingStatic.effect.duration, undefined);
  assert.equal(gankingStatic.condition.kind, "compare");
  assert.deepEqual(gankingStatic.condition.left, mightStatic.condition.left);
  assert.deepEqual(gankingStatic.condition.right, { kind: "constant", value: 2 });
});

test.todo(
  "sfd-143-221 Sivir, Mercenary: evaluate \"you've spent at least [A][A] this turn\" — no merged Expr reads " +
    "spent amounts this turn (ResolveContext exposes no spend receipt); source.powerSpentThisTurn is " +
    "an unresolved read position and a missing read closes the bound condition"
);

test.todo(
  "sfd-143-221 Sivir, Mercenary: grant [Ganking] for the turn through a continuous.grant-keyword consumer that the " +
    "movement system reads (810.1.b / 144.4.c.1) — the movement runtime reads permission.routes, " +
    "not the granted keyword string"
);

test.todo(
  "sfd-143-221 Sivir, Mercenary: paying the optional Accelerate cost [1][C] and the enter-ready replacement " +
    "run through the whole card — the Finalize optionalAdditional cost plan and the Accelerate keyword expansion " +
    "have merged but accelerate.cost has no layer mapping"
);
