import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/tools-of-empire.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CARD_ID = "card.hash-df9284be653b8dfcd7b469fd3cf3f242aabebe0a2a123738ad9225ede8828b1c";
const SOURCE_TEXT =
  "[Empower] :rb_energy_2: (:rb_energy_2:: Empower this. Use only if not Empowered.)\n" +
  ":rb_exhaust:: Give a unit +2 :rb_might: this turn. If this is [Empowered], give that unit +4 :rb_might: this turn instead.";

const [empower, activated] = program.abilities;
const [giveTwo, giveFour] = activated.body;
const unitSpec = giveTwo.targets[0];

const toolsWorld = () => world()
  .unit("tools-of-empire", {
    types: ["gear"],
    might: null,
    zone: "board",
    location: { type: "base", player: "A" }
  })
  .unit("friendly", { might: 3 })
  .build();

test("ven-077-166 Tools of Empire: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-077-166 Tools of Empire: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // The reason names only the current Empower and Empowered-condition gaps.
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.doesNotMatch(program.judgeReason, /assertFinalizationSurface|RIFT-81|RIFT-89|RIFT-90|RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-077-166 Tools of Empire: Empower 2 plus an exhaust-cost Might ability", () => {
  assert.equal(program.abilities.length, 2);
  // 827.1.c: the printed Empower cost is 2 Energy; the card only declares identity.
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower", value: 2 });

  // 151.2: a Gear activation; 415.3.a/415.5: exhausting itself is the cost.
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
  assert.equal(activated.restriction, undefined);
});

test("ven-077-166 Tools of Empire: one unit target carrying the printed +2 and the Empowered +4 branch", () => {
  // "a unit" (355.9.a.1: on the Board) is one Target (355.10.a).
  assert.deepEqual(unitSpec, {
    id: "tools-of-empire.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // The Might modification belongs to the layers' continuous.might with an
  // end-of-turn expiry (317.2.c / 433.1.a).
  assert.equal(giveTwo.op, "continuous.might");
  assert.deepEqual(giveTwo.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(giveTwo.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(giveTwo.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "tools-of-empire.unit" }
  });
  assert.equal(giveTwo.linkedTo, undefined);
  assert.equal(giveTwo.condition, undefined);

  // The Empowered branch names the SAME unit through the shared TargetSpec
  // ("that unit", 355.10.c) and is linked so a lost target suppresses it too.
  assert.equal(giveFour.op, "continuous.might");
  assert.deepEqual(giveFour.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(giveFour.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(giveFour.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "tools-of-empire.unit" }
  });
  assert.equal(giveFour.linkedTo, "tools-of-empire.give-2-might");
  assert.deepEqual(giveFour.condition, {
    kind: "expression",
    value: { kind: "constant", value: "is-empowered" }
  });
  // The branch reuses the earlier TargetSpec instead of choosing a new unit.
  assert.equal(giveFour.targets, undefined);
  // The printed "instead" is exclusive: the card never declares both amounts on
  // one instruction and never drops the second.
  assert.notDeepEqual(giveTwo.args.amount, giveFour.args.amount);
});

test("ven-077-166 Tools of Empire golden: the exhaust cost really exhausts the Gear (415.3.a/415.5)", () => {
  const kernel = toolsWorld();
  const bound = kernel.clone({
    source: kernel.ref("tools-of-empire"),
    sourceSnapshot: kernel.getObject("tools-of-empire")
  });
  const plan = buildCostPlan(bound, { id: "cost:tools-of-empire", cost: activated.cost });
  assert.deepEqual(plan.total.actions.map((entry) => entry.action.type), ["exhaust"]);
  const receipt = payCostPlan(bound, plan);
  assert.equal(receipt.paid, true);
  assert.equal(bound.getObject("tools-of-empire").exhausted, true);
});

test("ven-077-166 Tools of Empire golden: the declared target filter really selects Board units only", async () => {
  // "a unit" defaults to a Board object (355.9.a.1); the merged filter matcher is
  // the consumer the target system uses, so the printed restriction is verified.
  const { matchesObjectFilter } = await import("../../../../engine-core/dist/layers/filter.js");
  const kernel = world()
    .unit("board-unit", { might: 3 })
    .hand("hand-unit", { types: ["unit"], might: 3 })
    .build();
  assert.equal(matchesObjectFilter(unitSpec.filter, kernel.getObject("board-unit")), true);
  assert.equal(matchesObjectFilter(unitSpec.filter, kernel.getObject("hand-unit")), false);
});

test.todo(
  "ven-077-166 Tools of Empire: [Empower] 2 (CR 827.1.c.1 activation cost plus \"Use only if not Empowered\") needs an " +
    "Empower KeywordDef expansion that carries the printed 2 Energy cost and the not-Empowered activation gate"
);
test.todo(
  "ven-077-166 Tools of Empire: the printed \"+2 … if Empowered, +4 … instead\" either/or branch needs a merged " +
    "runtime Empowered condition predicate (RIFT-359); the +4 instruction must remain conditional on the same target"
);

test("ven-077-166 Tools of Empire golden: the non-Empowered +2 branch registers a temporary Might effect", () => {
  const base = toolsWorld();
  const kernel = base.clone({
    source: base.ref("tools-of-empire"),
    sourceSnapshot: base.getObject("tools-of-empire")
  });
  kernel.setTargets("tools-of-empire.unit", [kernel.ref("friendly")]);

  const outcome = resolveChainBody([giveTwo], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 2);
  assert.equal(registration.effect.filter.objectId, "friendly");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.deepEqual(outcome.results[0].result.linkedValues.affected, {
    count: 1,
    objects: [kernel.ref("friendly")]
  });
  assert.equal(createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map(entry => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }))
  ).evaluate(kernel.ref("friendly")).might, 5);
});
