import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/here-to-help.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import playInstruction from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";

const CANONICAL_ID = "card.hash-783f18a4ad28b8126f59f285304bee0b93c1e76fb7a557f8e9fee60bebf1f609";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Action] (Play on your turn or in showdowns.)\n" +
  "You may play a unit from hand to a battlefield you control, reducing its cost by :rb_energy_3:.";

const [hidden, action, play] = program.abilities;
const [optional] = play.body;
const destination = optional.args.body.value.find(instruction => instruction.id === "here-to-help.choose-battlefield");
const permitted = optional.args.body.value.find(instruction => instruction.op === "effect.play");
const pickSpec = permitted.picks[0];
const destinationChoice = "here-to-help.may-play-unit/here-to-help.choose-battlefield/here-to-help.battlefield";

/**
 * The explicit CostSpec the merged cost.modify needs in order to read the
 * picked card's own printed cost. `object-property` with the card's PickSpec
 * selector is the merged way to reach that card; nothing reads a PickSpec
 * implicitly.
 */
const pickedUnitCostSpec = {
  energy: { kind: "object-property", object: { pick: "here-to-help.unit" }, property: "energy" },
  power: { kind: "object-property", object: { pick: "here-to-help.unit" }, property: "power" }
};

const reductionModifier = {
  kind: "reduce",
  resource: "energy",
  amount: { kind: "constant", value: 3 },
  minimum: { kind: "constant", value: 0 }
};

function battlefieldWorld() {
  return world()
    .hand("unit-card", { types: ["unit"], owner: "A" })
    .object("friendly-field", { types: ["battlefield"], zone: "board", location: null, controller: "A" })
    .object("enemy-field", { types: ["battlefield"], zone: "board", location: null, owner: "B", controller: "B" })
    .unit("ally", { location: { type: "battlefield", id: "friendly-field" } })
    .unit("enemy", { owner: "B", location: { type: "battlefield", id: "enemy-field" } })
    .build();
}

/**
 * The reference kernel compares filter values literally; the production chain
 * query (chain/engine.ts) normalizes controller "self"/"opponent" and the
 * layer matcher (layers/filter.ts) understands location-type strings. Reproduce
 * those paths so the card's own PickSpec is what executes.
 */
function productionQuery(kernel) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") {
        return (filter) => {
          const normalized = { ...filter };
          const kernelFilter = { ...normalized };
          const opponents = [];
          for (const playerKey of ["controller", "owner"]) {
            if (normalized[playerKey] === "self") {
              kernelFilter[playerKey] = target.controller;
            } else if (normalized[playerKey] === "opponent") {
              delete kernelFilter[playerKey];
              opponents.push(playerKey);
            }
          }
          if (typeof normalized.location === "string") delete kernelFilter.location;
          return target
            .query(kernelFilter)
            .filter((object) => opponents.every((playerKey) => object[playerKey] !== target.controller))
            .filter((object) => normalized.location === undefined || typeof normalized.location !== "string" ||
              (object.location !== null && object.location.type === normalized.location));
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

test("sfd-111-221 Here to Help: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("sfd-111-221 Here to Help: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("sfd-111-221 Here to Help: judgeReason names cost.hidden and the played-unit cost binding", () => {
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /FinalizedCostPlan/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /CostPlan\.total/);
  assert.match(program.judgeReason, /Location/);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /811\.1\.b/);
  assert.match(program.judgeReason, /356\.4/);
});

test("sfd-111-221 Here to Help: [Hidden] + [Action] keywords and the printed cost", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
});

test("sfd-111-221 Here to Help: the optional clause wraps the permitted instruction in its body (contract 3.9)", () => {
  assert.equal(play.body.length, 1);
  assert.equal(optional.id, "here-to-help.may-play-unit");
  assert.equal(optional.op, "choice.optional");
  // The may is expressed as choice.optional wrapping the permitted
  // instruction, never as a leading choice plus a linkedTo successor.
  assert.equal(optional.linkedTo, undefined);
  assert.deepEqual(optional.args.prompt, {
    kind: "constant",
    value: "Play a unit from hand, reducing its cost by 3 energy?"
  });
  assert.equal(optional.args.body.kind, "constant");
  assert.deepEqual(optional.args.body.value.map((instruction) => instruction.id), [
    "here-to-help.choose-battlefield",
    "here-to-help.play-unit"
  ]);
});

test("sfd-111-221 Here to Help: the permitted play uses a hand pick, a bound Location and a deferred cost", () => {
  assert.equal(permitted.id, "here-to-help.play-unit");
  assert.equal(permitted.op, "effect.play");
  assert.equal(permitted.linkedTo, undefined);
  // 355.10.a: a card in hand is not in a public zone, so it is a pick, not a target.
  assert.deepEqual(permitted.args.pick, { kind: "constant", value: "here-to-help.unit" });
  assert.equal(permitted.targets, undefined);
  assert.deepEqual(pickSpec, {
    id: "here-to-help.unit",
    options: ["dynamic:unit-card-in-controller-hand"],
    filter: { type: "unit", zone: "hand", owner: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
  // Bind the controller's battlefield with the merged location expression;
  // effect.play accepts the resulting linked value through its Expr schema.
  assert.equal(destination.id, "here-to-help.choose-battlefield");
  assert.equal(destination.op, "condition.value");
  assert.deepEqual(destination.args.value, {
    kind: "location",
    value: {
      kind: "choose",
      id: "here-to-help.battlefield",
      filter: { type: "battlefield", controller: "controller" }
    }
  });
  assert.deepEqual(permitted.args.location, {
    kind: "linked-value",
    instructionId: "here-to-help.choose-battlefield",
    key: "value"
  });
  // 356.4/356.6: the printed -3 energy reduction needs a finalized plan
  // produced by the cost system for the picked unit; this descriptor is a
  // non-finalized marker, so effect.play keeps failing closed below.
  assert.deepEqual(permitted.args.cost, {
    kind: "constant",
    value: {
      kind: "cost.modify",
      base: "printed",
      resource: "energy",
      amount: -3,
      minimum: 0,
      finalized: false
    }
  });
  assert.equal(instructionDefinitionsById.get("effect.play"), playInstruction);
});

test("sfd-111-221 Here to Help evidence: the merged cost.modify freezes the picked unit's printed cost with the -3 discount", () => {
  // 356.4/356.6 measured against the merged primitive: with an explicit
  // CostSpec whose expressions read the card's own PickSpec, cost.modify locks
  // the picked unit's printed cost (4 Energy + 1 Body Power) and applies the
  // printed -3 Energy reduction in one discount instance.
  const kernel = world().hand("unit-card", { types: ["unit"], owner: "A", energy: 4, power: ["Body"] }).build();
  const run = runInstruction(costModify, {
    id: "here-to-help.unit-cost",
    cost: pickedUnitCostSpec,
    modifier: reductionModifier
  }, { world: kernel, picks: { "here-to-help.unit": [kernel.ref("unit-card")] } });

  assert.equal(run.result.status, "executed");
  const plan = run.linked.cost;
  assert.equal(plan.finalized, true);
  // The base is the picked unit's printed cost, not this spell's 2/1.
  assert.deepEqual(plan.base, {
    energy: 4,
    power: [{ amount: 1, allowedDomains: ["Body"] }],
    xp: 0,
    actions: []
  });
  assert.deepEqual(plan.total, {
    energy: 1,
    power: [{ amount: 1, allowedDomains: ["Body"] }],
    xp: 0,
    actions: []
  });
  assert.deepEqual(plan.discounts, [{
    id: "here-to-help.unit-cost:modifier:0",
    component: null,
    resource: "energy",
    amount: 3,
    minimum: 0,
    before: 4,
    after: 1
  }]);
});

test("sfd-111-221 Here to Help evidence: the reduction floors at zero and a null printed Energy cost is never 0", () => {
  // 356.6: Energy and Power costs cannot be reduced below 0.
  const floored = world().hand("unit-card", { types: ["unit"], owner: "A", energy: 2, power: ["Body"] }).build();
  const floorRun = runInstruction(costModify, {
    id: "here-to-help.unit-cost",
    cost: pickedUnitCostSpec,
    modifier: reductionModifier
  }, { world: floored, picks: { "here-to-help.unit": [floored.ref("unit-card")] } });

  assert.equal(floorRun.result.status, "executed");
  assert.equal(floorRun.linked.cost.total.energy, 0);
  assert.deepEqual(floorRun.linked.cost.discounts, [{
    id: "here-to-help.unit-cost:modifier:0",
    component: null,
    resource: "energy",
    amount: 3,
    minimum: 0,
    before: 2,
    after: 0
  }]);

  // energy: null means "no printed Energy cost"; the planner must fail closed
  // rather than treat it as a payable 0 (README section 2).
  const printedNothing = world().hand("unit-card", { types: ["unit"], owner: "A", energy: null, power: ["Body"] }).build();
  assert.throws(
    () => runInstruction(costModify, {
      id: "here-to-help.unit-cost",
      cost: pickedUnitCostSpec,
      modifier: reductionModifier
    }, { world: printedNothing, picks: { "here-to-help.unit": [printedNothing.ref("unit-card")] } }),
    /Energy must be a nonnegative safe integer/
  );
  assert.equal("cost" in printedNothing.linkedSnapshot(), false);
});

test("sfd-111-221 Here to Help evidence: cost.modify's locked CostPlan carries no flat amount for effect.play to consume", () => {
  // Measured handoff gap (cost/kinds/README.md integration request 5).
  //
  // cost.modify links a full CostPlan whose payable amount lives under
  // `total`; effect.play reads a flat FinalizedCostPlan (finalized/energy/
  // power/xp) and resolves `cost.energy ?? 0`. The locked plan below is the
  // real output of the merged primitive for the picked unit, and it exposes no
  // top-level energy/power at all — so no merged producer bridges the two
  // shapes, and passing the plan straight through would pay 0 (a silent free
  // play, measured and logged; not asserted here as intended behaviour).
  const kernel = world().hand("unit-card", { types: ["unit"], owner: "A", energy: 4, power: ["Body"] }).build();
  const run = runInstruction(costModify, {
    id: "here-to-help.unit-cost",
    cost: pickedUnitCostSpec,
    modifier: reductionModifier
  }, { world: kernel, picks: { "here-to-help.unit": [kernel.ref("unit-card")] } });

  assert.equal(run.result.status, "executed");
  const plan = run.linked.cost;
  assert.equal(plan.finalized, true);
  // The payable amount is nested under `total`...
  assert.equal(plan.total.energy, 1);
  // ...and the flat fields effect.play reads are absent.
  assert.equal(plan.energy, undefined);
  assert.equal(plan.power, undefined);
  assert.equal("xp" in plan, false);
});

test("sfd-111-221 Here to Help evidence: a flat FinalizedCostPlan derived from that total does pay and play", () => {
  // Same play with the flat descriptor shape effect.play actually consumes, so
  // the failing half is provably the missing CostPlan.total -> flat producer,
  // not effect.play itself.
  const kernel = battlefieldWorld();
  kernel.addPlayer("A", { energy: 9, power: ["Body", "Fury"] });
  const run = runInstruction(playInstruction, {
    pick: "here-to-help.unit",
    location: { kind: "constant", value: { type: "battlefield", id: "friendly-field" } },
    cost: { kind: "constant", value: { finalized: true, energy: 1, power: ["Body"], xp: 0 } }
  }, { world: kernel, picks: { "here-to-help.unit": [kernel.ref("unit-card")] } });

  assert.equal(run.result.status, "executed");
  const played = kernel.getObject("unit-card");
  assert.equal(played.zone, "board");
  assert.deepEqual(played.location, { type: "battlefield", id: "friendly-field" });
  assert.equal(kernel.player("A").energy, 8);
  assert.equal(kernel.events.filter((event) => event.action === "pay").length, 1);
  assert.equal(kernel.events.filter((event) => event.action === "play").length, 1);
});

test("sfd-111-221 Here to Help evidence: the chain adapter cannot decode a cost.modify body, so the card cannot author the plan at all", () => {
  // chain/interpreter-adapter.ts unwraps literal fields only for the ops listed
  // in LITERAL_FIELDS; cost.modify is absent, so a card body's Expr-wrapped `id`
  // reaches the primitive as an object and is rejected. The body below is
  // valid CardProgram IR (asserted first) — the failure is the adapter seam.
  const instructions = [
    {
      id: "here-to-help.build-cost",
      op: "cost.modify",
      args: {
        id: { kind: "constant", value: "here-to-help.unit-cost" },
        cost: { kind: "constant", value: pickedUnitCostSpec },
        modifier: { kind: "constant", value: reductionModifier }
      }
    }
  ];
  const validation = validateCardProgram({
    canonicalCardId: CANONICAL_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    sourceText: SOURCE_TEXT,
    abilities: [{ kind: "play", body: instructions }]
  });
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));

  const kernel = world().hand("unit-card", { types: ["unit"], owner: "A", energy: 4, power: ["Body"] }).build();
  kernel.setPicks("here-to-help.unit", [kernel.ref("unit-card")]);
  assert.throws(
    () => resolveChainBody(instructions, productionQuery(kernel)),
    /cost\.modify id must be a non-empty string/
  );
  assert.equal("cost" in kernel.linkedSnapshot(), false);
});

test("sfd-111-221 Here to Help evidence: [Hidden]'s cost.hidden static has no production binding layer", () => {
  // 811.1.b: the keyword expansion and buildHiddenCostPlan are merged, but the
  // merged static binder refuses the printed permission outright, and no chain
  // path turns it into a Hide Discretionary Action, facedown storage or the
  // next-turn Reaction play (811.1.c / 811.6).
  const kernel = world().hand("subject", {
    types: ["spell"],
    owner: "A",
    cardId: CANONICAL_ID
  }).build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: () => { throw new Error("the permission evidence must not require a choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host });
  const binder = createEngineStaticBinder(engine);
  const source = kernel.getObject("subject");
  const hostRef = { canonicalCardId: CANONICAL_ID };

  assert.deepEqual(keywordDefinitionsById.get("Hidden").expand({ host: hostRef }), [{
    kind: "static",
    effect: { kind: "cost.hidden" }
  }]);
  assert.throws(
    () => binder.bindStatic(keywordDefinitionsById.get("Hidden").expand({ host: hostRef })[0], source),
    /no layer mapping/,
    "[Hidden]'s cost.hidden must stay unconsumed"
  );
  // [Action]'s Showdown permission is delivered by the declaration
  // (programs/keywords.ts abilitySpeed), but its own continuous.timing
  // expansion is likewise still refused by the static binder.
  assert.throws(
    () => binder.bindStatic(keywordDefinitionsById.get("Action").expand({ host: hostRef })[0], source),
    /Unsupported static appliesTo/,
    "[Action]'s Showdown permission must stay unbound"
  );
  assert.deepEqual(engine.layers.registry.list(), []);
});

test("sfd-111-221 Here to Help golden: declining the optional clause leaves the hand and the board untouched", () => {
  const kernel = world().hand("unit-card", { types: ["unit"], owner: "A" }).build();
  kernel.setPicks("here-to-help.unit", [kernel.ref("unit-card")]);
  kernel.setAnswers({ "here-to-help.may-play-unit/optional": false });
  const eventCount = kernel.events.length;

  const outcome = resolveChainBody(play.body, productionQuery(kernel));

  // Contract 3.9: declining yields negated/skipped for this node and later
  // (unlinked) instructions still run; here there are none.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(kernel.getObject("unit-card").zone, "hand");
  assert.equal(kernel.events.length, eventCount);
});

test("sfd-111-221 Here to Help golden: accepting reaches effect.play, which negates on the non-finalized cost (no silent free play)", () => {
  const kernel = battlefieldWorld();
  kernel.setPicks("here-to-help.unit", [kernel.ref("unit-card")]);
  kernel.setAnswers({
    "here-to-help.may-play-unit/optional": true,
    [destinationChoice]: { type: "battlefield", id: "friendly-field" }
  });

  const outcome = resolveChainBody(play.body, productionQuery(kernel));

  // effect.play requires an already-finalized FinalizedCostPlan; the
  // descriptive cost descriptor is not one, so the play fails closed instead
  // of playing the unit for free (356.4 / 356.6).
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.linkedValues["here-to-help.may-play-unit/here-to-help.choose-battlefield.value"], {
    type: "battlefield", id: "friendly-field"
  });
  const played = outcome.results.find((entry) => entry.id === "here-to-help.play-unit");
  assert.equal(played.result.status, "negated");
  assert.equal(played.result.reason, "impossible");
  assert.equal(kernel.getObject("unit-card").zone, "hand");
  assert.equal(kernel.events.filter((event) => event.action === "play").length, 0);
});

test.todo(
  "sfd-111-221 Here to Help: [Hidden] needs a production consumer for cost.hidden — the Hide Discretionary Action, " +
  "facedown/Champion storage and the next-turn Reaction free play (CR 811.1.b / 811.1.c / 811.6). The keyword " +
  "expansion and buildHiddenCostPlan are merged, but programs/statics.ts rejects the static with " +
  "'Static ability kind cost.hidden has no layer mapping'."
);

test.todo(
  "sfd-111-221 Here to Help: the picked unit's locked CostPlan must reach effect.play as a paid flat plan — " +
  "cost.modify already freezes the printed cost minus 3 Energy (CR 356.4 / 356.6), but nobody flattens " +
  "CostPlan.total into the FinalizedCostPlan effect.play reads, and resolveChainBody cannot decode a " +
  "cost.modify card body (chain/interpreter-adapter.ts LITERAL_FIELDS)."
);

test("sfd-111-221 Here to Help golden: the Location choice offers only a controlled battlefield", () => {
  const kernel = battlefieldWorld();
  kernel.setAnswers({ "here-to-help.may-play-unit/optional": true });
  assert.throws(() => resolveChainBody(play.body, productionQuery(kernel)), error => {
    assert.ok(error instanceof AwaitChoice);
    assert.equal(error.request.id, destinationChoice);
    assert.equal(error.request.chooser, "A");
    assert.equal(error.request.visibility, "public");
    assert.deepEqual(error.request.options, [{ type: "battlefield", id: "friendly-field" }]);
    return true;
  });
  assert.equal(kernel.getObject("unit-card").zone, "hand");
  assert.deepEqual(kernel.events, []);
});

test("sfd-111-221 Here to Help golden: an enemy battlefield is rejected before any play or payment", () => {
  const kernel = battlefieldWorld();
  kernel.setAnswers({
    "here-to-help.may-play-unit/optional": true,
    [destinationChoice]: { type: "battlefield", id: "enemy-field" }
  });
  assert.throws(() => resolveChainBody(play.body, productionQuery(kernel)), /Invalid location choice answer/);
  assert.equal(kernel.getObject("unit-card").zone, "hand");
  assert.deepEqual(kernel.events, []);
});
