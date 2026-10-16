import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/smoke-and-mirrors.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-6add1fe7f28222eaf95929c9ea158fc564653d8c24fc981553089763dd098361";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Choose a unit you control and another unit you control at a different location. " +
  "If at least one of them has [Temporary], move each to the other's location. Draw 1.";

const [hidden, action, play] = program.abilities;
const [swap, drawInstruction] = play.body;
const [unitA, unitB] = swap.targets;

test("unl-083-219 Smoke and Mirrors: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-083-219 Smoke and Mirrors: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /effect\.swap-location/);
  assert.match(program.judgeReason, /RIFT-90/);
});

test("unl-083-219 Smoke and Mirrors: [Hidden] + [Action] plus the atomic swap shape and an independent Draw 1", () => {
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(hidden.value, undefined);
  assert.equal(action.value, undefined);
  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["smoke-and-mirrors.swap-locations", "effect.swap-location"],
      ["smoke-and-mirrors.draw-1", "effect.draw"]
    ]
  );

  // 448.1 / 448.3: the pair exchange must be one atomic Move relation; two
  // sequential effect.move instructions would differ (RIFT-9 effect.swap-location).
  assert.deepEqual(swap.args.objects, {
    kind: "constant",
    value: [
      { target: "smoke-and-mirrors.unit-a" },
      { target: "smoke-and-mirrors.unit-b" }
    ]
  });
  // 355.5 / 355.7: both chosen units are targets controlled by the caster.
  assert.deepEqual(unitA, {
    id: "smoke-and-mirrors.unit-a",
    filter: { zone: "board", type: "unit", controller: "controller" },
    min: 1,
    max: 1,
    selection: "one"
  });
  // "another" excludes unit-a; "at a different location" is a pair relation
  // recorded descriptively (no merged TargetPlan pair re-check).
  assert.equal(unitB.id, "smoke-and-mirrors.unit-b");
  assert.deepEqual(unitB.filter.exclude, { target: "smoke-and-mirrors.unit-a" });
  assert.equal(unitB.filter.locationRelation, "different-from-selected-unit");

  // "If at least one of them has [Temporary]": the predicate shape is retained
  // (keyword characteristics have no filter/condition dimension yet).
  assert.equal(swap.condition.kind, "compare");
  assert.equal(swap.condition.operator, "gte");
  assert.equal(swap.condition.left.subject, "selected-units-with-temporary");

  // "Draw 1" is an independent sentence: not linked to the swap.
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawInstruction.linkedTo, undefined);
});

test("unl-083-219 Smoke and Mirrors golden: the independent Draw 1 draws one card for the caster", () => {
  const kernel = world().player("A").deck(["top-card", "next-card"]).build();
  const run = runInstruction(
    draw,
    { amount: drawInstruction.args.amount },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
});

test.todo(
  "unl-083-219 Smoke and Mirrors: execute the atomic pair swap (CR 448.1/448.3) — RIFT-9 effect.swap-location is unmerged; " +
    "two sequential effect.move instructions are not an equivalent substitute"
);

test.todo(
  "unl-083-219 Smoke and Mirrors: 'If at least one of them has [Temporary]' needs a keyword-characteristic predicate " +
    "(CR 816.3) — Condition/object filters have no keyword dimension"
);

test.todo(
  "unl-083-219 Smoke and Mirrors: 'another unit you control at a different location' needs the pair-relation re-check at " +
    "Finalize/Resolve (CR 355.7 / RIFT-90 TargetPlan)"
);
