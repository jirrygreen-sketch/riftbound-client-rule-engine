import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/flame-chompers.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-0f5f84f75dbe0744c93412016da28963e78fa05c747a4b3163be7cfef5f26cc9";
const TRIGGERED = program.abilities[0];
const CHOICE = TRIGGERED.body[0];
const ACCEPT_BODY = CHOICE.args.body.value;

test("flame-chompers: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("flame-chompers: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /self\/source Trash/);
  assert.match(program.judgeReason, /Fury/);
  assert.match(program.judgeReason, /385\.1\/385\.2/);
  assert.match(program.judgeReason, /activeZones/);
  assert.match(program.judgeReason, /383\.3\.a/);
  assert.match(program.judgeReason, /383\.3\.b\/383\.3\.b\.1/);
  assert.match(program.judgeReason, /TriggerRegistration\.cost\/mayAtFinalize/);
  assert.equal(program.sourceText, "When you discard me, you may pay :rb_rune_fury: to play me.");
});

test("flame-chompers: 'When you discard me' subscribes to card-discarded filtered to the source (423.1.b)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(TRIGGERED.kind, "triggered");
  assert.equal(TRIGGERED.trigger.at, "card-discarded");
  assert.deepEqual(TRIGGERED.trigger.filter, { event: "card-discarded", filter: { source: "self" } });
  assert.equal(TRIGGERED.trigger.condition, undefined);
  assert.equal(TRIGGERED.trigger.once, undefined);
  assert.equal(TRIGGERED.optional, true);
});

test("flame-chompers: 'you may ...' is choice.optional wrapping the selected body (contract 3.9)", () => {
  assert.equal(TRIGGERED.body.length, 1);
  assert.equal(CHOICE.id, "flame-chompers.opt-in");
  assert.equal(CHOICE.op, "choice.optional");
  assert.equal(CHOICE.args.body.kind, "constant");
  assert.deepEqual(CHOICE.args.prompt, {
    kind: "constant",
    value: "Pay :rb_rune_fury: to play Flame Chompers from your trash?"
  });
  // The selected instructions live inside body, never as choice + linkedTo.
  assert.equal(CHOICE.linkedTo, undefined);
  assert.deepEqual(ACCEPT_BODY.map(instruction => instruction.id), ["flame-chompers.play"]);
});

test("flame-chompers: the blocked draft declares a finalized 1-Fury-Power play of the trash card (420.3)", () => {
  const [play] = ACCEPT_BODY;
  assert.equal(play.op, "effect.play");
  assert.equal(play.linkedTo, undefined);
  assert.deepEqual(play.args.target, { kind: "constant", value: "flame-chompers.self" });
  assert.deepEqual(play.args.cost, {
    kind: "constant",
    // Draft override only: CR 383.3.b requires the leading Fury cost on the
    // triggered ability's Finalize instead. Printed Energy remains unchanged.
    value: { finalized: true, power: ["Fury"] }
  });
  assert.deepEqual(play.args.location, { kind: "constant", value: { type: "base", player: "controller" } });
  assert.equal(play.targets.length, 1);
  const [target] = play.targets;
  assert.equal(target.id, "flame-chompers.self");
  // Contract 3.6: the card program points at itself with the symbolic selector.
  assert.deepEqual(target.filter, { source: "self", zone: "trash" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
});

test("flame-chompers: declining skips the whole accepted body and leaves the trash alone", () => {
  const kernel = world().card("flame-chompers", { owner: "A", zone: "trash" }).build();
  kernel.setAnswers({ "flame-chompers.opt-in/optional": false });
  const outcome = resolveChainBody(TRIGGERED.body, kernel);
  assert.deepEqual(outcome.results.map(result => result.id), ["flame-chompers.opt-in"]);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.events, []);
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["flame-chompers"]);
  assert.equal(kernel.zone("A", "board").length, 0);
});

test("flame-chompers: the 'play me' half runs as a real play of the trash card (420.3)", () => {
  // Sub-effect evidence only: this scenario supplies no cost plan and isolates
  // play movement. The merged finalized-cost override is separate from the
  // remaining Trash registration, leading trigger cost and nested target gaps.
  // The cost test below supplies plan/receipt evidence, not a Fury pool debit.
  const base = world().card("flame-chompers", { owner: "A", zone: "trash" }).build();
  const kernel = base.clone({
    source: base.ref("flame-chompers"),
    sourceSnapshot: base.getObject("flame-chompers")
  });
  // Finalize locks targets before resolution (interpreter README); the golden
  // supplies the locked target for the declared "flame-chompers.self" spec.
  kernel.setTargets("flame-chompers.self", [kernel.ref("flame-chompers")]);
  const [play] = ACCEPT_BODY;
  const { cost: _omitted, ...argsWithoutCost } = play.args;
  const outcome = resolveChainBody([{ ...play, args: argsWithoutCost }], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.events.map(event => event.action), ["play"]);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.played, 1);
  const board = kernel.zone("A", "board");
  assert.equal(board.length, 1);
  assert.deepEqual(board[0], kernel.ref("flame-chompers"));
});

test("flame-chompers golden: real cost primitives record the 1-Fury-Power draft plan and payment receipt (357)", () => {
  // buildCostPlan and cost.pay provide plan/receipt evidence for the draft;
  // neither lifts this cost to the trigger's Finalize under CR 383.3.b.
  // The reference kernel does not deduct Power, so this proves no Fury debit.
  const base = world()
    .player("A", { power: ["Fury"] })
    .card("flame-chompers", { owner: "A", zone: "trash", energy: 3 })
    .build();
  const context = base.clone({ sourceSnapshot: base.getObject("flame-chompers") });
  const declared = ACCEPT_BODY[0].args.cost.value;
  const plan = buildCostPlan(context, {
    id: "flame-chompers.play:cost",
    cost: {
      kind: "activated",
      energy: { kind: "constant", value: declared.energy ?? 0 },
      payments: (declared.power ?? []).map(domain => ({ kind: "power", allowedDomains: [domain] }))
    }
  });
  assert.equal(plan.printed.energy, 3);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: ["Fury"] }]);
  assert.equal(plan.total.energy, 0);
  const run = runInstruction(costPay, { cost: { kind: "constant", value: plan } }, { world: context });
  assert.equal(run.result.status, "executed");
  const receipt = run.result.linkedValues.payment;
  assert.equal(receipt.paid, true);
  // The reference kernel's pay action keeps the allocation, not a per-domain
  // pool deduction, so the receipt is the payment evidence.
  assert.deepEqual(receipt.actions[0].action.plan.power, ["Fury"]);
});

test("flame-chompers: real discard emits its new Trash incarnation and the translated self filter matches only this card (423.1.b, 385.2)", () => {
  const kernel = world()
    .card("flame-chompers", { owner: "A", zone: "hand", cardId: CARD_ID, energy: 3 })
    .card("other-chompers", { owner: "A", zone: "hand", cardId: CARD_ID, energy: 3 })
    .build();
  const handRef = kernel.ref("flame-chompers");
  const otherRef = kernel.ref("other-chompers");
  const host = createActionPipelineHost({
    checkpoint: () => kernel.snapshot(),
    restore: snapshot => kernel.restore(snapshot),
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const pipeline = new EventPipeline(host, ["A", "B"], "A");
  const filter = translateTriggerFilter(TRIGGERED.trigger.filter, handRef.id, TRIGGERED.trigger.at);
  assert.deepEqual(filter, { event: "card-discarded", object: { objectId: handRef.id } });

  assert.equal(pipeline.commit({ type: "discard", object: handRef, player: "A" }).status, "done");
  const discarded = pipeline.events.filter(event => event.timingPoint === TRIGGERED.trigger.at);
  assert.equal(discarded.length, 1);
  const [event] = discarded;
  assert.deepEqual(event.action, { type: "discard", object: handRef, player: "A" });
  assert.equal(event.player, "A");
  assert.equal(event.object.zone, "trash");
  assert.equal(event.object.energy, 3);
  assert.deepEqual(event.object.ref, kernel.ref("flame-chompers"));
  assert.notEqual(event.object.ref.zoneEntryId, handRef.zoneEntryId);
  assert.equal(kernel.object(handRef), null);
  assert.equal(matchesTriggerEvent(filter, event, "A"), true);
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["flame-chompers"]);

  assert.equal(pipeline.commit({ type: "discard", object: otherRef, player: "A" }).status, "done");
  const otherEvent = pipeline.events.filter(event => event.timingPoint === TRIGGERED.trigger.at)[1];
  assert.equal(matchesTriggerEvent(filter, otherEvent, "A"), false);
  // This proves event production and filter translation, not trigger registration
  // or the unsupported Trash/leading-cost Finalize lifecycle.
});

test("flame-chompers: the 1-Fury-Power draft plan cannot be paid with Energy or another domain (357)", () => {
  for (const power of [[], ["Calm"]]) {
    const base = world()
      .player("A", { energy: 3, power })
      .card("flame-chompers", { owner: "A", zone: "trash", energy: 3 })
      .build();
    const context = base.clone({ sourceSnapshot: base.getObject("flame-chompers") });
    const declared = ACCEPT_BODY[0].args.cost.value;
    const plan = buildCostPlan(context, {
      id: "flame-chompers.play:cost",
      cost: {
        kind: "activated",
        energy: { kind: "constant", value: declared.energy ?? 0 },
        payments: declared.power.map(domain => ({ kind: "power", allowedDomains: [domain] }))
      }
    });
    const before = context.stateForTest();
    assert.throws(
      () => runInstruction(costPay, { cost: { kind: "constant", value: plan } }, { world: context }),
      error => error.reason === "cannot-pay-cost"
    );
    assert.deepEqual(context.stateForTest(), before);
    assert.deepEqual(context.events, []);
    assert.deepEqual(context.zone("A", "trash").map(ref => ref.id), ["flame-chompers"]);
  }
});

test.todo("flame-chompers: register the post-discard Trash incarnation through programs/lifecycle (383.2.c.1, 385.2, 423.1.b)");
test.todo("flame-chompers: choose and pay the leading Fury cost during trigger Finalize, then bind the nested self Play (383.3.a/b, 420.3)");
