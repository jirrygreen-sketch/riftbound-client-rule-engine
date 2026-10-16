import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/noxus-hopeful.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-d8fc7a6f007a594060f40601cd5a28becae060a1537ac98db24d17e8039fc452";
const [legion, costModification] = program.abilities;

test("noxus-hopeful: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("noxus-hopeful: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /812\.1\.c/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.equal(
    program.sourceText,
    "[Legion] — I cost :rb_energy_2: less. (Get the effect if you've played another card this turn.)"
  );
});

test("noxus-hopeful: Legion is declared as a keyword ability, never re-implemented (812.1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(legion, { kind: "keyword", keyword: "legion" });
  assert.equal(legion.value, undefined);
});

test("noxus-hopeful: the dependent ability is a 2-Energy cost reduction applied as a discount (356.4)", () => {
  assert.equal(costModification.kind, "static");
  assert.equal(costModification.effect.kind, "cost.modify");
  assert.equal(costModification.effect.resource, "energy");
  assert.equal(costModification.effect.appliesTo, "self");
  assert.equal(costModification.effect.stage, "discount");
  // amount is the reduction ("I cost [2] less"), matching RIFT-89 CostDiscount.amount.
  assert.deepEqual(costModification.effect.amount, { kind: "constant", value: 2 });
});

test("noxus-hopeful: the Legion gate counts another card finalized this turn, excluding the host (812.1.c)", () => {
  assert.deepEqual(costModification.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "cards-finalized-this-turn",
      filter: { player: "controller", exclude: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("noxus-hopeful: the merged history query counts a finalized play", () => {
  // The ordinary history dimensions are executable. The host-card exclusion
  // remains a judge-required consumer gap and is covered by the TODO below.
  const kernel = world().unit("other-card", { owner: "A" }).build();
  kernel.perform({ type: "play", object: kernel.ref("other-card"), player: "A" });
  const counted = runAbilityBody([{
    id: "legion-count",
    op: "condition.history",
    args: {
      query: { kind: "constant", value: { scope: "turn", action: "play" } },
      operator: { kind: "constant", value: "gte" },
      right: { kind: "constant", value: 1 }
    }
  }], kernel);
  assert.equal(counted.linkedValues["legion-count.count"], 1);
});

test.todo(
  "noxus-hopeful: Legion expansion (812.1.b.1) and the history query's card-exclusion dimension " +
    "(contract 3.8 exclude/objectFilter) need the HistoryQuery consumer and RIFT-257 CardProgram binding"
);
test.todo(
  "noxus-hopeful: applying the 2-Energy discount through the cost system needs the cost.modify consumer " +
    "over card programs (RIFT-261 / RIFT-89)"
);
