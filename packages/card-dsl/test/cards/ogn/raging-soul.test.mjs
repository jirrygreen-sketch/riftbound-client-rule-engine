import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/raging-soul.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /RIFT-81/);
  assert.match(program.judgeReason, /RIFT-83/);
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

test("raging-soul: a real discard is observable as turn history through the merged interpreter", () => {
  // The gate's authored condition shape is the count form; the merged history
  // primitive proves that a discard executed by the merged effect.discard is
  // recorded and countable within the turn scope.
  const kernel = world().hand("fodder", { owner: "A" }).hand("kept", { owner: "A" }).build();
  kernel.setAnswers({ "discard-fodder/effect.discard%3AA": [kernel.ref("fodder")] });
  const discarded = resolveChainBody([{
    id: "discard-fodder",
    op: "effect.discard",
    args: { amount: { kind: "constant", value: 1 } }
  }], kernel);
  assert.equal(discarded.status, "executed");
  const gate = runAbilityBody([{
    id: "raging-soul.gate",
    op: "condition.history",
    args: {
      query: { kind: "constant", value: { scope: "turn", action: "discard" } },
      operator: { kind: "constant", value: "gte" },
      right: { kind: "constant", value: 1 }
    }
  }], kernel);
  assert.equal(gate.linkedValues["raging-soul.gate.count"], 1);
  assert.equal(gate.linkedValues["raging-soul.gate.value"], true);
  // A turn with no discard does not satisfy the gate (the false branch).
  const noDiscard = runAbilityBody([{
    id: "raging-soul.gate",
    op: "condition.history",
    args: {
      query: { kind: "constant", value: { scope: "turn", action: "discard" } },
      operator: { kind: "constant", value: "gte" },
      right: { kind: "constant", value: 1 }
    }
  }], world().build());
  assert.equal(noDiscard.linkedValues["raging-soul.gate.count"], 0);
  assert.equal(noDiscard.linkedValues["raging-soul.gate.value"], false);
});

test.todo(
  "raging-soul: continuous.grant-keyword for both Assault and Ganking (RIFT-9 continuous.keyword) plus a layers " +
    "consumer over card programs (RIFT-91) are required to execute the grants"
);
test.todo(
  "raging-soul: the granted Assault still needs the Attacker designation (807.1.c/807.1.d.1, ObjectSnapshot.combatRole is only frozen in contract 3.8)"
);
test.todo(
  "raging-soul: the granted Ganking permission must reach the Standard Move legality checks (810.1.c, 144.4.c)"
);
test.todo(
  "raging-soul: wiring the authored count/history condition to ctx.history is the condition-history consumer work (RIFT-89/90)"
);
