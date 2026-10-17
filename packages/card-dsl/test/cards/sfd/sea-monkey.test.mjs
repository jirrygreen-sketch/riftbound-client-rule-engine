import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/sea-monkey.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";

const CARD_ID = "card.hash-8b94882b556c55cce216445bf3c9f8b69b9e4c725571f25e890a951c67bb05c6";
const SOURCE_TEXT =
  "You may pay :rb_energy_1: as an additional cost to play me.\n" +
  "When you play me, if you paid the additional cost, buff me. (Give me a +1 :rb_might: buff if I don't already have one.)";

const [additionalCost, playTrigger] = program.abilities;
const [buffInstruction] = playTrigger.body;
const [selfSpec] = buffInstruction.targets;

/** The kernel binds "self" to the context source, so Sea Monkey is the source. */
function monkeyWorld({ buffs = 0 } = {}) {
  const kernel = world().unit("sea-monkey", { might: 2, buffs }).build();
  return kernel.clone({ source: kernel.ref("sea-monkey"), sourceSnapshot: kernel.getObject("sea-monkey") });
}

test("sfd-098-221 Sea Monkey: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-098-221 Sea Monkey: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-098-221 Sea Monkey: judgeReason names the additional-cost and paid-receipt gaps", () => {
  assert.match(program.judgeReason, /356\.2\.b/);
  assert.match(program.judgeReason, /cost\.additional/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /Condition kind "result"/);
  assert.match(program.judgeReason, /item\.payment/);
  assert.match(program.judgeReason, /MissingInformation/);
  // The three live dependencies: no CardProgram -> CostPlanInput consumer, no
  // receipt delivery to the card-played trigger, and no self-anchor consumption
  // in the filter adapters. The merged RIFT-261/RIFT-359 work is not listed as
  // a gap anymore, and the card data must not approximate any half.
  assert.match(program.judgeReason, /additional costs are not bound/i);
  assert.match(program.judgeReason, /cost\.additional has no layer mapping/);
  assert.match(program.judgeReason, /OBJECT_FILTER_ANCHORS/);
  assert.doesNotMatch(program.judgeReason, /进行中的 RIFT-261/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
});

test("sfd-098-221 Sea Monkey: the optional additional cost is 1 Energy on a passive ability", () => {
  // 356.2.b / 356.2.b.1: Optional Additional Cost imposed by a Passive Ability
  // of the card being played; the decision is made in step 2 (355.1.a).
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal(additionalCost.effect.id, "sea-monkey.additional-cost");
  assert.equal(additionalCost.effect.appliesTo, "self");
  assert.equal(additionalCost.effect.optional, true);
  assert.equal(additionalCost.effect.stage, "optional-additional");
  assert.deepEqual(additionalCost.effect.payments, [
    { kind: "energy", amount: { kind: "constant", value: 1 } }
  ]);
});

test("sfd-098-221 Sea Monkey: card-played self trigger whose body buffs the host", () => {
  assert.equal(playTrigger.kind, "triggered");
  assert.equal(playTrigger.trigger.at, "card-played");
  assert.deepEqual(playTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  // 383.2.a.1 + 356.4.f.1: "if you paid the additional cost" is part of the
  // Trigger Condition and reads the finalized optional-cost decision; the IR
  // spells it with the merged `result` predicate, never an always-true
  // condition.
  assert.deepEqual(playTrigger.trigger.condition, {
    kind: "result",
    result: "additional-cost-paid",
    id: "sea-monkey.additional-cost"
  });
  assert.equal(playTrigger.optional, false);

  assert.equal(playTrigger.body.length, 1);
  assert.equal(buffInstruction.id, "sea-monkey.buff-me");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "sea-monkey.self" }
  });
  // 355.10.d.1: "me" is programmatically selected and is never a choice; the
  // contract 3.6 "self" selector binds the host at runtime.
  assert.deepEqual(selfSpec, {
    id: "sea-monkey.self",
    filter: { object: "self", type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(buffInstruction.linkedTo, undefined);
});

test("sfd-098-221 Sea Monkey golden: the buff body places one Buff on the host (702.2.a)", () => {
  const kernel = monkeyWorld();
  // The reference kernel compares the filter's raw values and ignores the
  // contract 3.6 "object" anchor (the merged target-plan work does not consume
  // OBJECT_FILTER_ANCHORS), so the golden pins the already-Finalize-locked host
  // reference itself.
  kernel.setTargets("sea-monkey.self", [kernel.ref("sea-monkey")]);
  const outcome = resolveChainBody(playTrigger.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["sea-monkey.buff-me", "executed"]
  ]);
  assert.equal(kernel.getObject("sea-monkey").buffs, 1);
  assert.deepEqual(outcome.events.map(event => event.action), ["buff"]);
});

test("sfd-098-221 Sea Monkey golden: a second buff is a no-op (702.3.a, 427.1.c)", () => {
  const kernel = monkeyWorld({ buffs: 1 });
  kernel.setTargets("sea-monkey.self", [kernel.ref("sea-monkey")]);
  const outcome = resolveChainBody(playTrigger.body, kernel);
  assert.deepEqual(outcome.results.map(entry => [entry.result.status, entry.result.reason]), [
    ["negated", "skipped"]
  ]);
  assert.equal(kernel.getObject("sea-monkey").buffs, 1);
  assert.deepEqual(outcome.events, []);
});

test("sfd-098-221 Sea Monkey: the declared additional cost and self anchor are not approximated", () => {
  // Durable data-level guards for the two remaining dependencies (see
  // judgeReason): the card must keep the printed additional cost on a static
  // cost declaration (never rewritten as a resolution-time effect), and the
  // "me" anchor must stay the contract 3.6 self selector rather than a
  // hard-coded ObjectRef. The merged CardProgram adapter cannot bind the anchor
  // yet, which is why the binding path stops there.
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal("op" in additionalCost.effect, false);
  assert.deepEqual(additionalCost.effect.payments, [
    { kind: "energy", amount: { kind: "constant", value: 1 } }
  ]);
  assert.deepEqual(selfSpec.filter.object, "self");
  assert.equal(selfSpec.filter.objectId, undefined);

  // The merged programs/filters.ts adapter is the only bridge into the engine
  // query. It must never silently drop the anchor (that would buff a wrong
  // set): it either translates the body preserving the host-bound target, or it
  // fails closed with the judge-required reason. This stays true when the
  // anchor lands.
  let translated = null;
  try {
    translated = translateInstructionTargets(playTrigger.body);
  } catch (error) {
    assert.equal(error.code, "judge-required");
    assert.match(error.message, /filter field object/);
  }
  if (translated !== null) {
    const [anchor] = translated[0].targets;
    assert.deepEqual(anchor.filter.object, "self");
  }
});

test.todo(
  "sfd-098-221 Sea Monkey: the CardProgram binding must accept the body's `object: \"self\"` target anchor " +
    "(programs/filters.ts translateObjectFilter rejects it as an unsupported filter field, and " +
    "layers/filter.ts matchesObjectFilter does not consume OBJECT_FILTER_ANCHORS)"
);
test.todo(
  "sfd-098-221 Sea Monkey: no merged consumer turns the card's static cost.additional declaration into " +
    "CostPlanInput, and the played card's item.payment receipt never reaches the card-played trigger's " +
    "Resolve inputs (the same wiring gap recorded by sfd/zaun-punk)"
);
// Direct evidence for the recorded gaps: the "me" anchor is rejected by the
// production filter adapters, and the production static binder cannot map the
// cost.additional declaration. The paid-decision gate itself is merged
// (RIFT-359) and its real receipt run lives further below.
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

test("sfd-098-221 Sea Monkey golden: the trigger condition reads the real paid/declined receipt (356.4.f.1)", () => {
  // 383.2.a.1 + 356.4.f.1: the shipped IR carries the merged `result` predicate,
  // and the receipt itself comes from a genuine buildCostPlan/payCostPlan run of
  // the declared optional charge (the production adapter that would supply it
  // from the CardProgram declaration is the gap recorded in judgeReason).
  const base = world()
    .player("A", { energy: 5 })
    .unit("monkey", { cardId: CARD_ID, types: ["unit"], energy: 2, power: null, might: 2, owner: "A", controller: "A" })
    .build();
  const context = base.clone({ source: base.ref("monkey"), sourceSnapshot: base.getObject("monkey") });
  const planFor = (selected) => buildCostPlan(context, {
    id: "sea-monkey:play",
    cost: { kind: "printed" },
    optionalAdditional: [{
      id: "sea-monkey.additional-cost",
      kind: "additional",
      selected,
      cost: { payments: [{ kind: "energy", amount: { kind: "constant", value: 1 } }] }
    }]
  });
  const condition = playTrigger.trigger.condition;
  const environment = (plan, receipt) => ({
    context: bindResolveContext(base, { source: base.getObject("monkey"), controller: "A", cost: { plan, receipt } }),
    event: { timingPoint: "card-played" },
    cost: { plan, receipt },
    linked: (key) => base.linked(key),
    canLookBack: () => true,
    isIgnored: () => false
  });

  const paidPlan = planFor(true);
  const paidReceipt = payCostPlan(context.clone(), paidPlan);
  assert.deepEqual(paidPlan.total.energy, 3);
  assert.deepEqual(paidPlan.selectedAdditional, [{ id: "sea-monkey.additional-cost", kind: "additional" }]);
  assert.deepEqual(paidReceipt.additional, [{ id: "sea-monkey.additional-cost", kind: "additional", paid: true }]);
  assert.equal(evaluateCondition(condition, environment(paidPlan, paidReceipt)), true);

  // 356.4.f.1: the decision, not the amount, decides "paid" — declines are false
  // even though the base cost was still paid in full.
  const declinedPlan = planFor(false);
  const declinedReceipt = payCostPlan(context.clone(), declinedPlan);
  assert.deepEqual(declinedPlan.declinedAdditional, ["sea-monkey.additional-cost"]);
  assert.equal(evaluateCondition(condition, environment(declinedPlan, declinedReceipt)), false);
});

test("sfd-098-221 Sea Monkey: the production filter adapter rejects the body's self anchor", () => {
  assert.throws(
    () => translateObjectFilter(selfSpec.filter),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Unsupported filter field object/);
      return true;
    }
  );
});

test("sfd-098-221 Sea Monkey: the production static binder cannot map the cost.additional declaration", () => {
  // The registry refuses judge-required programs, so the binding path is
  // exercised against the same abilities with the status lifted for this
  // scenario only; the shipped program keeps judge-required.
  const lifted = { ...program, canonicalCardId: "card.synthetic-sea-monkey", status: "executable", judgeReason: undefined };
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const board = fixture({
    cards: [{ id: "monkey", cardId: lifted.canonicalCardId, types: ["unit"], energy: 2, power: [], might: 2 }],
    describePlay: binding.describePlay
  });
  const errors = [];
  binding.attachLifecycle(board.engine, (error) => errors.push(error));
  board.engine.commit({
    type: "move-zone",
    object: board.kernel.ref("monkey"),
    to: "battlefield",
    location: { type: "battlefield", id: "bf-1" }
  });
  board.engine.layers.setObjects(board.kernel.objects);

  // Both static abilities fail closed through the default engine binder: the
  // additional-cost declaration has no layer mapping, and the buff body's
  // self anchor is refused by the same production filter adapter.
  const messages = errors.map((error) => String(error.message));
  assert.ok(
    messages.some((message) => /Static ability kind cost\.additional has no layer mapping/.test(message)),
    "expected the cost.additional mapping rejection, got: " + JSON.stringify(messages)
  );
  assert.ok(
    messages.some((message) => /Unsupported filter field object/.test(message)),
    "expected the self-anchor rejection, got: " + JSON.stringify(messages)
  );
});
