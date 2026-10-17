import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/safety-inspector.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { translateCost } from "../../../../engine-core/dist/programs/play.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";

const CANONICAL_ID =
  "card.hash-e6ded9cf1a86a9d78660918b257ded9725d2afb4395c59332d8c3f7d09d03eb9";
const SOURCE_TEXT =
  "You may spend 3 XP as an additional cost to play me.\n" +
  "When you play me, each player must kill one of their units. If you paid my additional cost, you don't kill a unit this way.";
const PICK_ID = "safety-inspector.each-player-unit";

const [additionalCost, playEffect] = program.abilities;
const [killInstruction] = playEffect.body;
const pickSpec = killInstruction.picks[0];

test("unl-164-219 Safety Inspector: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-164-219 Safety Inspector: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /cost\.additional/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /each-player/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /Unavailable condition result/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-164-219 Safety Inspector: the optional additional cost is 3 XP declared on the card being played (356.2.b.1)", () => {
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal(additionalCost.effect.id, "safety-inspector.additional-cost");
  assert.equal(additionalCost.effect.appliesTo, "self");
  assert.equal(additionalCost.effect.optional, true);
  assert.equal(additionalCost.effect.stage, "optional-additional");
  assert.equal(additionalCost.effect.payments.length, 1);
  // 730.2: Spending XP reduces the marked value of the paying player.
  assert.deepEqual(additionalCost.effect.payments[0], {
    kind: "xp",
    amount: { kind: "constant", value: 3 }
  });
});

test("unl-164-219 Safety Inspector: one card-played self trigger whose body is a single kill of a per-player unit", () => {
  assert.equal(playEffect.kind, "triggered");
  // 383.4.a / 383.4.a.1: a Play Effect on the played permanent.
  assert.equal(playEffect.trigger.at, "card-played");
  assert.deepEqual(playEffect.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(playEffect.optional, false);
  assert.equal(playEffect.body.length, 1);

  // 429.6: Kill one permanent; "one of their units" is a resolve-time,
  // non-targeting choice (355.10.c), so it is a pick rather than a target.
  assert.equal(killInstruction.id, "safety-inspector.kill-unit");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args.picks, { kind: "constant", value: PICK_ID });
  assert.equal(killInstruction.args.target, undefined);
  assert.equal(killInstruction.args.self, undefined);
  assert.equal(killInstruction.targets, undefined);
  assert.equal(killInstruction.linkedTo, undefined);

  assert.equal(pickSpec.id, PICK_ID);
  assert.deepEqual(pickSpec.options, ["unit-controlled-by-each-player"]);
  // The per-player controller value has no IR form (see judgeReason); the
  // recorded filter keeps the intended scope and must not be read as a
  // single-player approximation.
  assert.deepEqual(pickSpec.filter, {
    type: "unit",
    zone: "board",
    controller: "each-player"
  });
  assert.equal(pickSpec.min, 1);
  assert.equal(pickSpec.max, 1);
  assert.equal(pickSpec.selection, "one");
});

test("unl-164-219 Safety Inspector golden: selecting the additional cost really charges 3 XP at play (356.2.b.1 / 730.2)", () => {
  const kernel = world()
    .player("A", { xp: 3, energy: 5 })
    .unit("safety-inspector", { controller: "A" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("safety-inspector") });
  const plan = buildCostPlan(scoped, {
    id: "cost:safety-inspector",
    // The printed 5 Energy / 1 Power base cost is bound by card identity at
    // Finalize; the additional component is the declared 3 XP.
    cost: { kind: "explicit", energy: { kind: "constant", value: 5 } },
    optionalAdditional: [
      {
        id: "safety-inspector.additional-cost",
        kind: "additional",
        cost: { kind: "explicit", payments: [{ kind: "xp", amount: { kind: "constant", value: 3 } }] },
        selected: true
      }
    ]
  });

  assert.equal(plan.total.energy, 5);
  assert.equal(plan.total.xp, 3);
  assert.deepEqual(plan.selectedAdditional, [
    { id: "safety-inspector.additional-cost", kind: "additional" }
  ]);

  const receipt = payCostPlan(scoped, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "spend-xp"]);
  assert.equal(scoped.player("A").xp, 0);
  assert.equal(scoped.player("A").energy, 0);
  // 356.4.f.1: the receipt records the paid optional additional cost.
  assert.deepEqual(
    receipt.additional.map(entry => ({ id: entry.id, kind: entry.kind, paid: entry.paid })),
    [{ id: "safety-inspector.additional-cost", kind: "additional", paid: true }]
  );
});

test("unl-164-219 Safety Inspector golden: declining the additional cost charges nothing extra (356.4.f.1)", () => {
  const kernel = world()
    .player("A", { xp: 3, energy: 5 })
    .unit("safety-inspector", { controller: "A" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("safety-inspector") });
  const plan = buildCostPlan(scoped, {
    id: "cost:safety-inspector",
    cost: { kind: "explicit", energy: { kind: "constant", value: 5 } },
    optionalAdditional: [
      {
        id: "safety-inspector.additional-cost",
        kind: "additional",
        cost: { kind: "explicit", payments: [{ kind: "xp", amount: { kind: "constant", value: 3 } }] },
        selected: false
      }
    ]
  });

  assert.equal(plan.total.xp, 0);
  const receipt = payCostPlan(scoped, plan);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay"]);
  assert.equal(scoped.player("A").xp, 3);
  // The "if you paid" gate (356.4.f.1) is exactly this empty list.
  assert.deepEqual(receipt.additional, []);
});

test("unl-164-219 Safety Inspector golden: the kill body really kills the chosen unit through the merged primitive (429.6)", () => {
  const kernel = world()
    .unit("my-unit", { controller: "A" })
    .unit("their-unit", { owner: "B", controller: "B" })
    .player("B")
    .build();
  const run = runInstruction(
    kill,
    { picks: killInstruction.args.picks.value },
    { world: kernel, picks: { [PICK_ID]: [kernel.ref("their-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("their-unit").zone, "trash");
  assert.equal(kernel.getObject("my-unit").zone, "board");
  assert.deepEqual(run.linked.killed, [{ id: "their-unit", zoneEntryId: 1 }]);
  // 429.1.a.1: Killing is not a Move; the object goes to its owner's Trash.
  assert.deepEqual(run.events.map(event => event.action), ["kill"]);
});

test("unl-164-219 Safety Inspector golden: an empty pick is ignored instead of guessing a unit (359.3.e.6)", () => {
  const kernel = world().unit("my-unit", { controller: "A" }).build();
  const run = runInstruction(
    kill,
    { picks: killInstruction.args.picks.value },
    { world: kernel, picks: { [PICK_ID]: [] } }
  );

  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.getObject("my-unit").zone, "board");
  assert.deepEqual(run.events, []);
});

test.todo(
  "unl-164-219 Safety Inspector: fan out each-player kills and let each player choose one of their own units (CR 429.6)"
);
test.todo(
  "unl-164-219 Safety Inspector: bind the optional additional-cost decision receipt to the play trigger, exempting only the payer (CR 356.4.f.1)"
);
test.todo(
  "unl-164-219 Safety Inspector: collect the static cost.additional declaration into the CardProgram play cost plan; XP payment and receipts already execute above"
);

test("unl-164-219 Safety Inspector: the each-player controller filter currently matches no unit at all", () => {
  // CR 429.6: the killer is each player's own choice among that player's units.
  // The merged filter vocabulary only understands any/self/opponent/playerId,
  // so the declared "each-player" selector matches neither player -- pinning
  // that keeps the shape from silently selecting an arbitrary unit.
  const kernel = world()
    .unit("mine", { owner: "A", controller: "A" })
    .unit("theirs", { owner: "B", controller: "B" })
    .build();
  assert.equal(matchesObjectFilter({ controller: "each-player" }, kernel.getObject("mine")), false);
  assert.equal(matchesObjectFilter({ controller: "each-player" }, kernel.getObject("theirs")), false);
  // The declared pick keeps its bounds so a later fan-out adapter can consume it.
  assert.deepEqual(pickSpec.filter, { type: "unit", zone: "board", controller: "each-player" });
  assert.equal(pickSpec.min, 1);
  assert.equal(pickSpec.max, 1);
});

test("unl-164-219 Safety Inspector: the additional-cost receipt predicate has no Finalize producer", () => {
  // CR 356.4.f.1: the exemption needs the actual payment decision. The read
  // path exists, but no producer feeds a finalized plan/receipt into a program
  // trigger, so evaluating the predicate without one fails closed.
  const kernel = world().build();
  const environment = {
    context: kernel,
    query: (filter) => kernel.query(filter),
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
  assert.throws(
    () => evaluateCondition(
      { kind: "result", result: "cost.additional", id: "safety-inspector.additional-cost" },
      environment
    ),
    /Unavailable condition result: cost\.additional/
  );
});

test("unl-164-219 Safety Inspector: the merged production surfaces still refuse the static cost.additional declaration", () => {
  assert.throws(
    () => translateCost({ kind: "additional", payments: additionalCost.effect.payments }, "safety-inspector", "play"),
    (error) => error.name === "ProgramBindingError" && /Additional costs are not bound/.test(error.message)
  );

  const kernel = world().unit("inspector", { types: ["unit"] }).build();
  const host = createActionPipelineHost({
    checkpoint: () => kernel.snapshot(),
    restore: (state) => kernel.restore(state),
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: (request) => kernel.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const binder = createEngineStaticBinder(engine);
  assert.throws(
    () => binder.bindStatic(additionalCost, kernel.getObject("inspector")),
    (error) => error.name === "ProgramBindingError" && /no layer mapping/.test(error.message)
  );
});
