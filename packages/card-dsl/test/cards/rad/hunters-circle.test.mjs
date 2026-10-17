import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/hunters-circle.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL =
  "card.hash-7737d765f33a7c1065a7cc21af4afc511f86a348b9bfcda04f685a4478b48ffd";
const SOURCE_TEXT =
  "For each player, the first unit or gear they play here on their turn costs :rb_energy_1: less.";

const [ability] = program.abilities;

/** A real merged cost plan for a printed-3 card with the card's announced discount. */
function planWithCardDiscount(energy) {
  const base = world().hand("source", { types: ["unit"], energy }).build();
  const ctx = base.clone({ sourceSnapshot: base.object(base.ref("source")) });
  return buildCostPlan(ctx, {
    id: "play",
    cost: { kind: "printed" },
    // A Champion unit is a Unit printing carrying the Champion tag
    // (133.7.a / catalog-card-type-v2), so its normal play cost binds as Unit.
    printed: { id: "unit", cardType: "Unit", domains: ["Colorless"], energy, power: 0 },
    discounts: [
      {
        id: "hunters-circle",
        resource: "energy",
        amount: { kind: "constant", value: 1 }
      }
    ]
  });
}

test("rad-163-167 Hunters' Circle: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("rad-163-167 Hunters' Circle: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /CostPlanInput\.discounts/);
  assert.match(program.judgeReason, /destination/);
  assert.match(program.judgeReason, /Condition/);
  assert.match(program.judgeReason, /per-turn-first-play/);
  assert.match(program.judgeReason, /first unit or gear/);
  // Second-sweep refresh: name the two observed binder failures.
  assert.match(program.judgeReason, /staticTarget/);
  assert.match(program.judgeReason, /sameLocationAs/);
});

test("rad-163-167 Hunters' Circle gap: the production binder rejects the declaration twice over", () => {
  // A Battlefield permanent has no location, so the source-relative anchor the
  // card uses cannot resolve, and `appliesTo: "play-cost"` is not a supported
  // static anchor at all. Either way the static ability never binds, so it can
  // never reach a future play's CostPlanInput.discounts.
  const f = fixture({ cards: [{ id: "field", cardId: CANONICAL, types: ["battlefield"] }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("field"), to: "board" });
  const source = f.kernel.getObject("field");
  assert.equal(source.location, null);
  const binder = createEngineStaticBinder(f.engine);
  assert.throws(() => binder.bindStatic(ability, source), /Unsupported static appliesTo "play-cost"/);
  assert.throws(
    () => binder.bindStatic(
      { kind: "static", effect: { ...ability.effect, appliesTo: undefined } },
      source
    ),
    /Static sameLocationAs source has no location/
  );
  assert.deepEqual(f.engine.layers.registry.list(), []);
});

test("rad-163-167 Hunters' Circle gap: Condition has no history kind for the first-play window", () => {
  // The one-shot window needs a static cost gate; the merged Condition
  // evaluator only supports always/never/compare/expression/all/any/not and
  // the RIFT-359 predicate kinds, and `condition.history` is a resolve-time
  // instruction that cannot gate a play's cost plan.
  const kernel = world().build();
  const environment = { context: kernel, linked: () => undefined, canLookBack: () => true, isIgnored: () => false };
  assert.throws(() => evaluateCondition({ kind: "history" }, environment), /Unsupported condition: history/);
  assert.equal(ability.condition.kind, "always");
});


test("rad-163-167 Hunters' Circle: one static -1 energy discount for each player's unit/gear play here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition.kind, "always");

  // 356.4: "costs [1] less" is a discount on the played card's total cost.
  assert.equal(ability.effect.kind, "cost.modify");
  assert.equal(ability.effect.resource, "energy");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: -1 });
  assert.equal(ability.effect.appliesTo, "play-cost");

  // "For each player, the first unit or gear they play here on their turn":
  // both card types (356.4.b) at this Battlefield (053.3) for the player
  // playing the card. The per-turn first-play window is the judged part.
  assert.deepEqual(ability.effect.filter, {
    type: ["unit", "gear"],
    controller: "controller",
    sameLocationAs: "self"
  });
  assert.equal(ability.effect.duration, "per-turn-first-play");
  assert.match(program.judgeReason, /sameLocationAs|打出到本战场/);
});

test("rad-163-167 Hunters' Circle: the announced -1 discount really reduces a merged cost plan", () => {
  // The golden proves the discount arithmetic the card announces, using the
  // merged cost plan: 3 energy → 2, and nothing below 0 (356.4 / 356.4.c.2).
  const discounted = planWithCardDiscount(3);
  assert.equal(discounted.total.energy, 2);
  assert.deepEqual(
    discounted.discounts.map(applied => [applied.id, applied.resource, applied.before, applied.after]),
    [["hunters-circle", "energy", 3, 2]]
  );
  assert.equal(discounted.printed.energy, 3, "the printed cost stays independent of the discount");

  const free = planWithCardDiscount(0);
  assert.equal(free.total.energy, 0, "a 0-energy cost cannot be reduced below 0");
  assert.deepEqual(free.discounts[0].after, 0);
});

test.todo(
  "rad-163-167 Hunters' Circle: install the announced -1 energy discount on a later unit/gear play " +
    "made to this Battlefield and assert the finalized plan of that play costs 1 less (356.4) — needs " +
    "a static-program-to-CostPlan binding on top of the merged cost plan"
);

test.todo(
  "rad-163-167 Hunters' Circle: gate the discount to each player's FIRST qualifying play of their " +
    "turn only (a second unit/gear played here the same turn costs full) — needs per-player per-turn " +
    "one-shot history with a play-location predicate, which the current Condition/HistoryQuery shape " +
    "cannot express as a static cost gate; merged location choices do not query historical play destinations"
);

