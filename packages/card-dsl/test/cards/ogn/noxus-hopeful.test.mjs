// RIFT-670 single-card golden: validation, identity, judgeReason and the key
// structure of Noxus Hopeful. Real execution evidence for this card (the
// whole-card scenario through the generic card harness plus the measured
// fail-closed outcome of both expanded static abilities) lives in
// `test/cards/templates/keyword-static-670.test.mjs`.
//
// The card stays judge-required: the printed static `cost.modify` and the
// Legion `condition.predicate` expansion both have no layer mapping in
// `engine-core/src/programs/statics.ts`, so a real play still pays the full
// printed cost. Nothing here approximates the discount.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/noxus-hopeful.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { evaluateExpression } from "../../../../engine-core/dist/effects/interpreter/expr.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";

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
  assert.match(program.judgeReason, /812\.1\.c/);
  assert.match(program.judgeReason, /cards-finalized-this-turn/);
  assert.match(program.judgeReason, /161|count/);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /has no layer mapping/);
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
  // amount is the reduction ("I cost [2] less"), not a signed delta.
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
  // The ordinary history dimensions and the reference kernel's exclusion path
  // are executable. Production static-condition consumption remains the gap.
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

test("noxus-hopeful: the production count ignores the finalized-history subject and any player filter (812.1.c gap)", () => {
  // expr.ts's `count` resolves only the filter against the current object set:
  // the printed subject "cards-finalized-this-turn" is not consulted and the
  // filter's `player` key is not a recognised filter field, so any surviving
  // object other than the excluded source makes the count >= 1 — including an
  // opponent's hand card or the controller's own rune. That is not 812.1.c.
  const count = extra => {
    const builder = world().player("A").player("B")
      .object("src", { owner: "A", controller: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 4 });
    if (extra) builder.object("extra", extra);
    const kernel = builder.build();
    const context = bindResolveContext(kernel, { source: kernel.getObject("src"), controller: "A" });
    return evaluateExpression(costModification.condition.left, {
      context,
      host: kernel.ref("src"),
      linked: () => undefined,
      canLookBack: () => false,
      isIgnored: () => false
    });
  };
  assert.equal(count(null), 0, "the source alone is excluded");
  assert.equal(
    count({ owner: "B", controller: "B", types: ["unit"], zone: "hand", energy: 1, power: null, might: 1 }),
    1,
    "an opponent's hand card is counted, so the printed condition is not the 812.1.c history query"
  );
  assert.equal(
    count({ owner: "A", controller: "A", types: ["rune"], zone: "rune-zone", might: null }),
    1,
    "the controller's own rune is counted too — subject and player are both ignored"
  );
});

test.todo(
  "noxus-hopeful: consume HistoryQuery.exclude/objectFilter from a production ResolveContext " +
    "when evaluating the Legion static condition (CR 812.1.c)"
);
test.todo(
  "noxus-hopeful: collect static cost.modify into the CostPlan discount stage " +
    "while preserving the printed 2-Energy reduction (CR 356.4)"
);
