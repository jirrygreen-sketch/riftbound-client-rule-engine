// Execution evidence: this file runs the printed reduction through the merged
// finalizeCostPlan collector (cost/discounts/collect.ts, RIFT-709). The
// static|| template row ../../templates/static-642.test.mjs still pins the
// production binding rejection.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/hunters-circle.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { finalizeCostPlan } from "../../../../engine-core/dist/cost/discounts/index.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
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
  assert.match(program.judgeReason, /finalizeCostPlan/);
  assert.match(program.judgeReason, /play destination/);
  assert.match(program.judgeReason, /per-turn-first-play/);
  assert.match(program.judgeReason, /For each player/);
  // 2026-10-18 refresh: name the exact measured failures instead of a generic
  // "no consumer".
  assert.match(program.judgeReason, /staticTarget/);
  assert.match(program.judgeReason, /no layer mapping/);
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
  assert.equal(ability.effect.kind, "continuous.cost-modification");
  assert.equal(ability.effect.resource, "energy");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: -1 });
  assert.equal(ability.effect.appliesTo, "play-cost");

  // "For each player, the first unit or gear they play here on their turn":
  // both card types (356.4.b) at this Battlefield (053.3) for the player
  // playing the card. The per-turn first-play window is consumed by the merged
  // collector; the "here" destination anchor is the judged part.
  assert.deepEqual(ability.effect.filter, {
    type: ["unit", "gear"],
    controller: "controller",
    sameLocationAs: "self"
  });
  assert.equal(ability.effect.duration, "per-turn-first-play");
  assert.match(program.judgeReason, /打出目的地/);
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

test("rad-163-167 Hunters' Circle: the printed unit-or-gear population and the per-player first-play window execute on a real collector plan", () => {
  // CR 356.4.a / 356.4.b + 356.4.g: the discount is for each player, applies to
  // their first unit or gear, and the value is locked when the play's cost plan
  // is built. The merged collector consumes the printed field set of this exact
  // declaration; only the "here" destination anchor is dropped for this probe so
  // the remaining printed clauses can be measured (the anchor itself is asserted
  // separately below).
  const { sameLocationAs, ...filter } = ability.effect.filter;
  const declared = { ...ability, effect: { ...ability.effect, filter } };
  const base = world()
    .player("A", { energy: 5 })
    .player("B", { energy: 5 })
    .object("circle", { types: ["battlefield"], zone: "board", controller: "A", owner: "A", location: null })
    .unit("a-played", { controller: "A", owner: "A" })
    .unit("b-played", { controller: "B", owner: "B" })
    .hand("a-unit", { types: ["unit"], energy: 3, power: [], controller: "A", owner: "A" })
    .hand("a-gear", { types: ["gear"], energy: 3, power: [], controller: "A", owner: "A" })
    .hand("a-spell", { types: ["spell"], energy: 3, power: [], controller: "A", owner: "A" })
    .hand("b-unit", { types: ["unit"], energy: 3, power: [], controller: "B", owner: "B" })
    .build();
  const plan = (card, controller, plays = []) => {
    const ctx = base.clone({ sourceSnapshot: base.getObject(card), controller });
    return finalizeCostPlan(ctx, { id: "play", cost: { kind: "printed" } }, {
      statics: [{ id: "hunters-circle:0", source: ctx.ref("circle"), ability: declared }],
      finalizedPlaysThisTurn: plays
    });
  };

  assert.equal(plan("a-unit", "A").total.energy, 2, "the first unit costs 1 less");
  assert.equal(plan("a-gear", "A").total.energy, 2, "the first gear costs 1 less");
  assert.equal(
    plan("a-unit", "A", [{ object: base.getObject("a-played"), player: "A" }]).total.energy,
    3,
    "the second qualifying play costs full (356.4.g locks the value per play)"
  );
  assert.equal(plan("a-spell", "A").total.energy, 3, "a spell is not a unit or gear");
  assert.equal(
    plan("a-unit", "A", [{ object: base.getObject("b-played"), player: "B" }]).total.energy,
    2,
    "another player's play does not consume this payer's window"
  );

  // The remaining printed clause is "For each player": the merged selector
  // vocabulary resolves filter.controller against the ability source, so a
  // non-controller's first unit is not discounted. Measured, not assumed.
  assert.equal(
    plan("b-unit", "B").total.energy,
    3,
    "a non-controller's first unit is not yet covered by the payer-relative selector (see judgeReason)"
  );
});

test("rad-163-167 Hunters' Circle: the printed \"here\" anchor fails closed until the destination is bound (053.3)", () => {
  // The declaration above keeps sameLocationAs: "self" for the printed "here",
  // and the merged collector really refuses to guess: a Battlefield permanent
  // has no location, and a finalized-play snapshot has none either (the card is
  // still on the Chain at Finalize).
  const base = world()
    .player("A", { energy: 5 })
    .object("circle", { types: ["battlefield"], zone: "board", controller: "A", owner: "A", location: null })
    .hand("a-unit", { types: ["unit"], energy: 3, power: [] })
    .build();
  const ctx = base.clone({ sourceSnapshot: base.getObject("a-unit") });
  assert.throws(
    () => finalizeCostPlan(ctx, { id: "play", cost: { kind: "printed" } }, {
      statics: [{ id: "hunters-circle:0", source: ctx.ref("circle"), ability }],
      finalizedPlaysThisTurn: []
    }),
    error => error instanceof CostPlanError && error.reason === "judge-required" &&
      /play destination binding is required/.test(error.message)
  );

  const f = fixture({ cards: [{ id: "played", types: ["unit"] }] });
  f.engine.execute(f.card("played", { body: [] }));
  f.engine.advance();
  const [finalized] = f.engine.pipeline.events.filter(event => event.timingPoint === "chain-item-finalize");
  assert.equal(finalized.object.location, null, "a card played to a Battlefield is still on the Chain at Finalize");
  assert.equal(finalized.object.zone, "hand", "Finalize happens before the play moves the card out of its zone");
});

test.todo(
  "rad-163-167 Hunters' Circle: install the announced -1 energy discount on a later unit/gear play " +
    "made to this Battlefield and assert the finalized plan of that play costs 1 less (356.4) — needs " +
    "a static-program-to-CostPlan binding on top of the merged cost plan"
);

test.todo(
  "rad-163-167 Hunters' Circle: bind the printed 'here' destination so the discount applies only to " +
    "plays made to this Battlefield (053.3) — needs a play-destination snapshot on the finalized-play " +
    "history; the collector currently fails closed because a Battlefield permanent has no location and a " +
    "Finalize-time snapshot has not entered the Battlefield yet"
);

