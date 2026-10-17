import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/pyke-dockside-butcher.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";

const CANONICAL_ID =
  "card.hash-29fe440bf64648cf3c6845485b73efbd8c2cae11e1cf26c7b3bb6a355351ebae";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Ganking] (I can move from battlefield to battlefield.)\n" +
  "You may pay :rb_rune_fury: as an additional cost to play me.\n" +
  "When you play me, if you paid the additional cost, ready me and give me +2 :rb_might: this turn.";

const [hidden, ganking, playCost, playedTrigger] = program.abilities;
const [readySelf, grantMight] = playedTrigger.body;

/** A ready/face-down-agnostic fixture: Pyke on the Board, source bound to him. */
function fixture({ exhausted }) {
  const base = world()
    .unit("pyke", { might: 2, exhausted })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("pyke") });
}

test("unl-028-219 Pyke, Dockside Butcher: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-028-219 Pyke, Dockside Butcher: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /additional cost/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /Hide\/面朝下/);
  assert.match(program.judgeReason, /condition\.result/);
  // The stale "cost.pay is unmerged" wording is gone: the primitive settles a
  // finalized CostPlan (verified by probe), so the reason names the real gaps.
  assert.match(program.judgeReason, /CostPlan/);
  assert.match(program.judgeReason, /translateCost/);
  assert.doesNotMatch(program.judgeReason, /cost\.pay 不是已合入|未进 HEAD/);
});

test("unl-028-219 Pyke, Dockside Butcher: [Hidden] and [Ganking] keyword declarations", () => {
  assert.equal(program.abilities.length, 4);
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(ganking, { kind: "keyword", keyword: "ganking" });
});

test("unl-028-219 Pyke, Dockside Butcher: the printed optional additional cost is declared on a play ability", () => {
  // 356.2.b / 356.2.b.1: "as an additional cost" + "may" = Optional Additional
  // Cost, decided during the play steps (355.1.a). The card prints no Power
  // cost (catalog power: null); this is a separate optional component and is
  // never written as 0.
  assert.equal(playCost.kind, "play");
  assert.equal(playCost.cost.kind, "additional-cost");
  assert.equal(playCost.cost.optional, true);
  assert.deepEqual(playCost.cost.power, { kind: "constant", value: ["Fury"] });
  assert.equal(playCost.cost.energy, undefined);
  // The cost itself declares no resolution body.
  assert.deepEqual(playCost.body, []);
});

test("unl-028-219 Pyke, Dockside Butcher: the Play Effect gates on the paid receipt and readies/buffs 'me'", () => {
  // 383.4.a.1: "When you play me" is a Play Effect on this card.
  assert.equal(playedTrigger.kind, "triggered");
  assert.equal(playedTrigger.trigger.at, "card-played");
  assert.deepEqual(playedTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  // 383.2.a.1 / 356.4.f.1: the predicate reads this optional-cost decision.
  // Passing the original play receipt to trigger conditions remains blocked.
  assert.deepEqual(playedTrigger.trigger.condition, {
    kind: "result",
    result: "cost.additional",
    id: playCost.cost.id
  });
  assert.equal(playCost.cost.id, "pyke-dockside-butcher.additional-cost");
  assert.equal(playedTrigger.optional, false);

  // 355.10.g / 416.1: "ready me" is the source, never a target.
  assert.equal(readySelf.id, "pyke-dockside-butcher.ready-self");
  assert.equal(readySelf.op, "effect.ready");
  assert.deepEqual(readySelf.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(readySelf.targets, undefined);

  // "give me +2 :rb_might: this turn": a temporary Might change (143.2.a), so it
  // is an arithmetic-layer continuous.might — not a Buff counter.
  assert.equal(grantMight.id, "pyke-dockside-butcher.grant-might-2");
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "this-turn" });
  // "me" is a self-reference (355.10.g), so no TargetSpec is written; the merged
  // primitive selects the ability source through the contract 3.6 objects form.
  assert.equal(grantMight.targets, undefined);
  assert.deepEqual(grantMight.args.objects, {
    kind: "constant",
    value: { kind: "source" }
  });
  assert.equal(grantMight.args.target, undefined);
});

test("unl-028-219 Pyke, Dockside Butcher golden: 'ready me' readies the exhausted source", () => {
  const kernel = fixture({ exhausted: true });
  const outcome = resolveChainBody([readySelf], kernel);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["pyke-dockside-butcher.ready-self", "executed"]
  ]);
  assert.equal(kernel.getObject("pyke").exhausted, false);
  assert.deepEqual(kernel.events.map(event => event.action), ["ready"]);
});

test("unl-028-219 Pyke, Dockside Butcher golden: the printed predicate reads the real Fury additional-cost decision (356.4.f.1)", () => {
  // The caller supplies the component at this supported API boundary; this is
  // not evidence that describePlay can yet translate the printed play cost.
  for (const [selected, discounted, componentId, expected] of [
    [true, false, playCost.cost.id, true],
    [false, false, playCost.cost.id, false],
    [true, true, playCost.cost.id, true],
    [true, false, "another-card.additional-cost", false]
  ]) {
    const initial = world().player("A", { energy: 3, power: ["Fury"] })
      .hand("pyke", { cardId: CANONICAL_ID, energy: 3, power: null }).build();
    const kernel = initial.clone({ sourceSnapshot: initial.getObject("pyke") });
    const plan = buildCostPlan(kernel, {
      id: "pyke-play", cost: { kind: "printed" },
      optionalAdditional: [{ id: componentId, kind: "additional", selected,
        cost: { power: playCost.cost.power } }],
      discounts: discounted ? [{ id: "power-discount", resource: "power", amount: { kind: "constant", value: 1 } }] : []
    });
    const receipt = payCostPlan(kernel, plan);
    assert.equal(evaluateCondition(playedTrigger.trigger.condition, {
      context: kernel, cost: { plan, receipt }, linked: kernel.linked.bind(kernel)
    }), expected);
    assert.equal(plan.printed.power, null);
    assert.equal(plan.total.energy, 3);
    assert.equal(plan.total.power.reduce((sum, requirement) => sum + requirement.amount, 0), selected && !discounted ? 1 : 0);
    assert.deepEqual(receipt.additional.map(item => item.id), selected ? [componentId] : []);
    assert.equal(kernel.player("A").energy, 0);
    assert.deepEqual(receipt.actions[0].action.plan.power, selected && !discounted ? ["Fury"] : []);
  }
});

test("unl-028-219 Pyke, Dockside Butcher golden: an already-ready source is a no-op (CR 416.1.c)", () => {
  const kernel = fixture({ exhausted: false });
  const outcome = resolveChainBody([readySelf], kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("pyke").exhausted, false);
  assert.deepEqual(kernel.events, []);
  const run = runInstruction(ready, readySelf.args, { world: kernel });
  assert.equal(run.linked.readied.count, 0);
});

test.todo(
  "unl-028-219 Pyke, Dockside Butcher: generate the Finalize cost plan with the optional additional cost" +
    " (CR 356.2.b.1: [Fury]) and bind the 356.4.f.1 paid receipt so 'if you paid the additional cost' is a real trigger condition" +
    " (cost.pay settles an already finalized plan; programs/play.ts still rejects additional-cost fields)"
);
test.todo(
  "unl-028-219 Pyke, Dockside Butcher: [Hidden] expansion (CR 811.1: Hide for [A], facedown zone restrictions and" +
    " the free play from facedown) — the merged cost.hidden declaration has no consumer and the contract ZoneId has no facedown member"
);
test.todo(
  "unl-028-219 Pyke, Dockside Butcher: [Ganking] continuous.movement permission (CR 810.1.b / 144.4.c.1) is read" +
    " by the movement system — movement() is merged but has no caller"
);
test("unl-028-219 Pyke, Dockside Butcher golden: +2 Might registers in the arithmetic layer for the turn", () => {
  const kernel = fixture({ exhausted: true });
  const outcome = resolveChainBody([grantMight], kernel);

  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  // 143.2.a / 475 / 478: Might modifications live in the arithmetic layer.
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 2);
  // 315.4: the printed "this turn" resolves to the end-of-turn expiry.
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  // 355.10.g: "me" is the ability's source, registered by object identity.
  assert.equal(registration.effect.filter.objectId, "pyke");

  const might = createLayerEngine(kernel.objects, kernel.continuousEffects).evaluate(kernel.ref("pyke")).might;
  assert.equal(might, 4);
});

test("unl-028-219 Pyke, Dockside Butcher golden: the +2 expires at end of turn (317.1.a / 468.7.c)", () => {
  const kernel = fixture({ exhausted: false });
  resolveChainBody([grantMight], kernel);
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("pyke")).might, 4);

  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("pyke")).might, 2);
});

test("unl-028-219 Pyke, Dockside Butcher golden: a source that left the Board is ignored (359.3.e.6)", () => {
  const base = world().unit("pyke", { might: 2, zone: "board" }).build();
  const stale = base.ref("pyke");
  base.perform({ type: "move-zone", object: stale, to: "trash" });
  const kernel = base.clone({ sourceSnapshot: base.getObject("pyke") });

  const outcome = resolveChainBody([grantMight], kernel);
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.continuousEffects.length, 0);
});
