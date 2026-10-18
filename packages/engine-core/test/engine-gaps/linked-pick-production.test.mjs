import assert from "node:assert/strict";
import test from "node:test";

import blindFury from "../../../card-dsl/dist/cards/ogn/blind-fury.js";
import scrutinizingScope from "../../../card-dsl/dist/cards/rad/scrutinizing-scope.js";
import ivernNurturer from "../../../card-dsl/dist/cards/unl/ivern-nurturer.js";
import { AwaitChoice } from "../../dist/effects/contract.js";
import { world } from "../../dist/effects/testing/index.js";
import { ChainEngine } from "../../dist/chain/engine.js";
import { pickSpecs } from "../../dist/chain/picks/plan.js";
import { bindResolveContext, createActionPipelineHost } from "../../dist/events/action-adapter.js";
import { createProgramBinding, translateInstructionTargets } from "../../dist/programs/index.js";
import { linkedPickExpression } from "../../dist/target/picks/plan.js";

const c = value => ({ kind: "constant", value });
const refIds = refs => refs.map(ref => ref.id);

const ivernOnPlay = ivernNurturer.abilities[0];
const ivernBody = translateInstructionTargets(ivernOnPlay.body);
const blindBody = blindFury.abilities.find(ability => ability.kind === "play").body;
const scopeBody = scrutinizingScope.abilities[0].body;
const scopeReveal = scopeBody.find(instruction => instruction.id === "scrutinizing-scope.reveal-top");
const scopeDraw = scopeBody.find(instruction => instruction.id === "scrutinizing-scope.draw-if-other");

function runtime(builder, kernel = builder.build()) {
  const answers = new Map();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (answers.has(request.id)) return answers.get(request.id);
    if (request.type === "select-objects" && request.id.includes("target:ivern-nurturer.friendly-unit")) {
      if (request.options.length === 0) throw new AwaitChoice(request);
      return request.options.slice(0, request.min);
    }
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source, controller, timingPoint, choose
    })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
    cleanup: () => false
  });
  return { kernel, engine, answers, requests };
}

function testObject(id, values = {}) {
  const owner = values.owner ?? "A";
  return {
    ref: { id, zoneEntryId: values.zoneEntryId ?? 1 },
    cardId: values.cardId ?? `card:${id}`,
    name: values.name ?? id,
    types: values.types ?? ["unit"],
    tags: values.tags ?? [],
    keywords: values.keywords ?? [],
    owner,
    controller: values.controller ?? owner,
    zone: values.zone ?? "deck",
    location: values.location ?? null,
    combatRole: values.combatRole ?? null,
    might: values.might ?? 1,
    energy: values.energy === undefined ? 1 : values.energy,
    power: values.power === undefined ? ["Fury"] : values.power,
    exhausted: values.exhausted ?? false,
    damage: values.damage ?? 0,
    stunned: values.stunned ?? false,
    buffs: values.buffs ?? 0,
    attachedTo: values.attachedTo ?? null,
    faceDown: values.faceDown ?? false,
    isToken: values.isToken ?? false
  };
}

function start(f, body, sourceId = "source") {
  f.engine.enqueue({
    id: "linked-pick-body", controller: "A", source: f.kernel.getObject(sourceId),
    kind: "triggered", speed: "normal", body
  });
  f.engine.advance();
}

function awaitOnResolve(f, passFirst = true) {
  if (passFirst) f.engine.pass(f.engine.priority);
  let request;
  assert.throws(() => f.engine.pass(f.engine.priority), error => {
    assert.ok(error instanceof AwaitChoice);
    request = error.request;
    return true;
  });
  return request;
}

function finishWithoutChoices(f) {
  for (let guard = 0; f.engine.items.length; guard++) {
    assert.ok(guard < 20, "chain must settle");
    f.engine.pass(f.engine.priority);
  }
}

function timings(f) {
  return f.engine.pipeline.events.map(event => event.timingPoint);
}

test("original linked-value option shapes validate and identical repeat declarations merge", () => {
  const ivernLinked = ivernOnPlay.body[2].args.body.value[0].picks[0];
  const blindLinked = blindBody[1].picks[0];
  const scopeLinked = scopeDraw.picks[0];

  assert.deepEqual(linkedPickExpression(ivernLinked), ivernLinked.options[0]);
  assert.deepEqual(linkedPickExpression(blindLinked), blindLinked.options[0]);
  assert.deepEqual(linkedPickExpression(scopeLinked), scopeLinked.options[0]);

  const merged = pickSpecs(ivernOnPlay.body).find(spec => spec.id === "ivern-nurturer.revealed-unit");
  assert.equal(merged.filter.type, "unit");
  assert.equal(merged.min, 1);
  assert.equal(merged.max, 1);
  assert.equal(merged.selection, "one");

  assert.equal(ivernNurturer.status, "judge-required");
  assert.equal(blindFury.status, "judge-required");
  assert.equal(scrutinizingScope.status, "judge-required");
  for (const program of [ivernNurturer, blindFury, scrutinizingScope]) {
    const admitted = { ...program, status: "executable", judgeReason: undefined };
    const binding = createProgramBinding({ cardPrograms: [admitted] });
    assert.equal(binding.registry.inspect(program.canonicalCardId)?.status, "executable");
  }
});

function ivernFixture() {
  const builder = world()
    .player("A")
    .player("B")
    .base("source", { controller: "A", owner: "A", might: 2 })
    .unit("nurturer", { controller: "A", owner: "A", might: 4 })
    .unit("ally", { controller: "A", owner: "A", might: 2 })
    .deck("tail", { owner: "A", types: ["spell"] })
    .deck("top-gear", { owner: "A", types: ["gear"] })
    .deck("second-unit", { owner: "A", types: ["unit"] })
    .deck("top-unit", { owner: "A", types: ["unit"] });
  return runtime(builder, builder.kernel.clone({ controller: "A" }));
}

test("Ivern original IR keeps linked choice in Resolve, privately filters top three, rolls back, and replays", () => {
  const run = () => {
    const f = ivernFixture();
    start(f, ivernBody, "nurturer");

    assert.deepEqual(f.engine.items[0].pickPlans.map(plan => plan.id), ["ivern-nurturer.top-three"]);
    assert.equal(f.kernel.linked("ivern-nurturer.look-top-three.ivern-nurturer.looked-cards"), undefined);
    assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "cards-looked-at").length, 0);
    // The independent card-level Buff target is finalized before Resolve and
    // is not this linked pick. Its single became-target receipt is expected.
    assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 1);

    const optional = awaitOnResolve(f);
    assert.equal(optional.type, "optional");
    assert.equal(optional.chooser, "A");
    f.answers.set(optional.id, true);

    const linked = awaitOnResolve(f, false);
    assert.equal(linked.type, "select-objects");
    assert.equal(linked.chooser, "A");
    assert.equal(linked.visibility, "chooser-only");
    assert.equal(linked.min, 1);
    assert.equal(linked.max, 1);
    assert.deepEqual(refIds(linked.options), ["top-unit", "second-unit"]);
    // The optional body and the private look rolled back while awaiting this
    // linked choice; Finalize never read the future look receipt.
    assert.equal(f.kernel.linked("ivern-nurturer.look-top-three.ivern-nurturer.looked-cards"), undefined);
    assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "cards-looked-at").length, 0);

    const before = f.kernel.stateForTest();
    const events = f.engine.pipeline.events;
    const links = f.kernel.linkedSnapshot();
    f.answers.set(linked.id, [f.kernel.ref("top-gear")]);
    assert.throws(() => f.engine.pass(f.engine.priority), /invalid choice|unavailable|duplicate/i);
    assert.deepEqual(f.kernel.stateForTest(), before);
    assert.deepEqual(f.engine.pipeline.events, events);
    assert.deepEqual(f.kernel.linkedSnapshot(), links);

    f.answers.set(linked.id, [linked.options[1]]);
    f.engine.pass(f.engine.priority);
    finishWithoutChoices(f);

    assert.deepEqual(refIds(f.kernel.zone("A", "hand")), ["second-unit"]);
    assert.equal(f.kernel.getObject("top-unit").zone, "deck");
    assert.equal(f.kernel.getObject("top-gear").zone, "deck");
    assert.equal(f.kernel.getObject("second-unit").zone, "hand");
    assert.deepEqual(refIds(f.kernel.linked("ivern-nurturer.look-top-three.ivern-nurturer.looked-cards")), [
      "top-unit", "second-unit", "top-gear"
    ]);
    assert.deepEqual(refIds(f.kernel.linked("ivern-nurturer.reveal-unit-opt/ivern-nurturer.reveal-unit.revealed")), ["second-unit"]);
    // The Buff instruction's own TargetPlan is the only target event; the
    // linked reveal pick itself produced none.
    assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 1);
    const looked = f.engine.pipeline.events.filter(event => event.timingPoint === "cards-looked-at");
    assert.equal(looked.length, 1);
    assert.equal(looked[0].details.visibility, "A");
    return f;
  };

  const first = run();
  const replay = run();
  assert.deepEqual(replay.kernel.stateForTest(), first.kernel.stateForTest());
  assert.deepEqual(replay.kernel.linkedSnapshot(), first.kernel.linkedSnapshot());
  assert.deepEqual(timings(replay), timings(first));
});

test("Blind Fury original reveal and linked option banish one card without a target plan", () => {
  const reveal = structuredClone(blindBody[0]);
  // Only the unresolved each-opponent fan-out is bound to one concrete opponent
  // for this production seam. The card's own linked pick is unchanged.
  reveal.picks[0].zoneSlice.player = c("B");
  const body = [reveal, structuredClone(blindBody[1])];
  const f = runtime(world()
    .player("A")
    .player("B")
    .base("source", { controller: "A", owner: "A", might: 2 })
    .deck(["b-top", "b-second"], { owner: "B" }));

  start(f, body);
  assert.deepEqual(f.engine.items[0].pickPlans.map(plan => plan.id), ["blind-fury.revealed"]);
  assert.deepEqual(f.engine.items[0].targetPlans, []);
  assert.equal(f.kernel.linked("blind-fury.reveal-top-card-of-each-opponent.revealed"), undefined);
  f.engine.pass(f.engine.priority);
  f.engine.pass(f.engine.priority);
  finishWithoutChoices(f);

  assert.equal(f.kernel.getObject("b-top").zone, "banishment");
  assert.equal(f.kernel.getObject("b-second").zone, "deck");
  assert.deepEqual(refIds(f.kernel.linked("blind-fury.reveal-top-card-of-each-opponent.revealed")), ["b-top"]);
  assert.deepEqual(refIds(f.kernel.linked("blind-fury.banish-chosen.banished").objects), ["b-top"]);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 0);
});

function linkedSource(id, instructionId, key = "revealed") {
  return { id, options: [{ kind: "linked-value", instructionId, key }] };
}

test("linked filter and bounds preserve receipt order, exclude outside identities, and reject bad answers atomically", () => {
  const body = [
    {
      id: "show", op: "effect.reveal", args: { pick: c("shown") },
      picks: [{ id: "shown", options: [], ordered: true, selection: "all",
        zoneSlice: { zone: "deck", from: "top", count: c(3) } }]
    },
    {
      id: "choose-units", op: "effect.reveal", args: { pick: c("chosen") },
      picks: [{
        ...linkedSource("chosen", "show"),
        filter: { type: "unit", zone: "deck" }, min: 1, max: 2, selection: "up-to"
      }]
    }
  ];
  const builder = world()
    .player("A")
    .player("B")
    .base("source", { controller: "A", owner: "A", might: 2 });
  // The fourth matching unit is outside the three-card linked source.
  for (const [id, values] of [
    ["outside-unit", { types: ["unit"] }],
    ["second-unit", { types: ["unit"] }],
    ["first-unit", { types: ["unit"] }],
    ["top-gear", { types: ["gear"] }]
  ]) builder.kernel.addObject(testObject(id, values), "deck");
  const f = runtime(builder);
  assert.equal(f.engine.commit({ type: "order-top", player: "A", objects: [
    f.kernel.ref("top-gear"), f.kernel.ref("first-unit"), f.kernel.ref("second-unit"), f.kernel.ref("outside-unit")
  ] }).status, "done");

  start(f, body);
  assert.deepEqual(f.engine.items[0].pickPlans.map(plan => plan.id), ["shown"]);
  assert.equal(f.kernel.linked("show.revealed"), undefined);
  const request = awaitOnResolve(f);
  assert.equal(request.visibility, "chooser-only");
  assert.equal(request.chooser, "A");
  assert.equal(request.min, 1);
  assert.equal(request.max, 2);
  assert.deepEqual(refIds(request.options), ["first-unit", "second-unit"]);
  // The first reveal is part of the same rolled-back Resolve transaction.
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "card-revealed").length, 0);
  assert.equal(f.kernel.linked("show.revealed"), undefined);

  const before = f.kernel.stateForTest();
  f.answers.set(request.id, [f.kernel.ref("top-gear")]);
  assert.throws(() => f.engine.pass(f.engine.priority), /invalid choice|unavailable/i);
  assert.deepEqual(f.kernel.stateForTest(), before);

  f.answers.set(request.id, [request.options[1]]);
  f.engine.pass(f.engine.priority);
  finishWithoutChoices(f);
  assert.deepEqual(refIds(f.kernel.linked("show.revealed")), ["top-gear", "first-unit", "second-unit"]);
  assert.deepEqual(refIds(f.kernel.linked("choose-units.revealed")), ["second-unit"]);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 0);
});

test("a linked filter can consume a preceding object selector without widening the receipt set", () => {
  const body = [
    {
      id: "show", op: "effect.reveal", args: { pick: c("shown") },
      picks: [{ id: "shown", options: [], ordered: true, selection: "all",
        zoneSlice: { zone: "deck", from: "top", count: c(3) } }]
    },
    {
      id: "choose", op: "effect.reveal", args: { pick: c("chosen") },
      picks: [{
        ...linkedSource("chosen", "show"),
        filter: { type: "unit", zone: "deck", relation: { relation: "same-controller", object: "source" } },
        min: 1, max: 1, selection: "one"
      }]
    }
  ];
  const f = runtime(world()
    .player("A")
    .player("B")
    .base("source", { controller: "A", owner: "A", might: 2 })
    .deck("b-unit", { owner: "B", types: ["unit"] })
    .deck("a-unit", { owner: "A", types: ["unit"] })
    .deck("gear", { owner: "A", types: ["gear"] }));

  start(f, body);
  f.engine.pass(f.engine.priority);
  try { f.engine.pass(f.engine.priority); } catch {}
  const request = f.requests.find(candidate => candidate.type === "select-objects");
  assert.ok(request);
  assert.deepEqual(refIds(request.options), ["a-unit"]);
  f.answers.set(request.id, [request.options[0]]);
  f.engine.pass(f.engine.priority);
  finishWithoutChoices(f);
  assert.deepEqual(refIds(f.kernel.linked("choose.revealed")), ["a-unit"]);
  assert.equal(f.kernel.getObject("b-unit").zone, "deck");
});

test("explicit linked ordered source supports a filtered and bounded Resolve pick", () => {
  const body = [
    {
      id: "show", op: "effect.reveal", args: { pick: c("shown") },
      picks: [{ id: "shown", options: [], ordered: true, selection: "all",
        zoneSlice: { zone: "deck", from: "top", count: c(3) } }]
    },
    {
      id: "choose", op: "effect.reveal", args: { pick: c("chosen") },
      picks: [{
        id: "chosen", options: [], ordered: true,
        linked: { kind: "linked-value", instructionId: "show", key: "revealed" },
        filter: { type: "unit", zone: "deck" }, min: 1, max: 1, selection: "one"
      }]
    }
  ];
  const f = runtime(world()
    .player("A")
    .player("B")
    .base("source", { controller: "A", owner: "A", might: 2 })
    .deck("unit-b", { owner: "B", types: ["unit"] })
    .deck("unit-a", { owner: "A", types: ["unit"] })
    .deck("gear", { owner: "A", types: ["gear"] }));

  start(f, body);
  f.engine.pass(f.engine.priority);
  let request;
  try { f.engine.pass(f.engine.priority); } catch {}
  request = f.requests.find(candidate => candidate.type === "select-objects");
  assert.ok(request);
  assert.deepEqual(refIds(request.options), ["unit-a"]);
  f.answers.set(request.id, [request.options[0]]);
  f.engine.pass(f.engine.priority);
  finishWithoutChoices(f);
  assert.deepEqual(refIds(f.kernel.linked("choose.revealed")), ["unit-a"]);
});

test("an empty filtered linked set fails closed without asking or widening to a global query", () => {
  const body = [
    {
      id: "show", op: "effect.reveal", args: { pick: c("shown") },
      picks: [{ id: "shown", options: [], ordered: true, selection: "all",
        zoneSlice: { zone: "deck", from: "top", count: c(2) } }]
    },
    {
      id: "choose-spell", op: "effect.reveal", args: { pick: c("chosen") },
      picks: [{ ...linkedSource("chosen", "show"), filter: { type: "spell", zone: "deck" }, min: 1, max: 1, selection: "one" }]
    }
  ];
  const f = runtime(world()
    .player("A")
    .player("B")
    .base("source", { controller: "A", owner: "A", might: 2 }));
  const builder = world();
  builder.kernel.addObject(testObject("outside-spell", { types: ["spell"] }), "deck");
  builder.kernel.addObject(testObject("gear", { types: ["gear"] }), "deck");
  builder.kernel.addObject(testObject("unit", { types: ["unit"] }), "deck");
  f.kernel.addObject(testObject("outside-spell", { types: ["spell"] }), "deck");
  f.kernel.addObject(testObject("gear", { types: ["gear"] }), "deck");
  f.kernel.addObject(testObject("unit", { types: ["unit"] }), "deck");

  start(f, body);
  f.engine.pass(f.engine.priority);
  f.engine.pass(f.engine.priority);
  finishWithoutChoices(f);
  assert.equal(f.requests.some(request => request.id.includes("pick:chosen")), false);
  // The top-two source produces two reveal actions. The later empty linked set
  // produces no reveal action; the extra event is its negated instruction receipt.
  const reveals = f.engine.pipeline.events.filter(event => event.timingPoint === "card-revealed");
  assert.equal(reveals.length, 2);
  assert.deepEqual(reveals.map(event => event.object?.ref.id), ["unit", "gear"]);
  assert.equal(f.kernel.getObject("gear").zone, "deck");
  assert.deepEqual(f.kernel.linked("choose-spell.revealed"), []);
  assert.equal(f.kernel.getObject("outside-spell").zone, "deck");
});

test("malformed linked receipts fail atomically and a departed incarnation is not rebound", () => {
  const malformed = runtime(world().player("A").player("B").base("source", { controller: "A", owner: "A" }));
  start(malformed, [
    { id: "bad-source", op: "condition.value", args: { value: c([{ id: "incomplete" }]), key: c("revealed") } },
    { id: "consume-bad", op: "effect.reveal", args: { pick: c("chosen") },
      picks: [linkedSource("chosen", "bad-source")] }
  ]);
  malformed.engine.pass(malformed.engine.priority);
  const beforeMalformed = malformed.kernel.stateForTest();
  const eventsBeforeMalformed = malformed.engine.pipeline.events;
  const linksBeforeMalformed = malformed.kernel.linkedSnapshot();
  assert.throws(() => malformed.engine.pass(malformed.engine.priority), /complete object references|invalid-result/i);
  assert.deepEqual(malformed.kernel.stateForTest(), beforeMalformed);
  assert.deepEqual(malformed.engine.pipeline.events, eventsBeforeMalformed);
  assert.deepEqual(malformed.kernel.linkedSnapshot(), {});
  assert.deepEqual(malformed.kernel.linkedSnapshot(), linksBeforeMalformed);

  const stale = runtime(world()
    .player("A")
    .player("B")
    .base("source", { controller: "A", owner: "A" })
    .deck(["first", "second"], { owner: "B", types: ["unit"] }));
  start(stale, [
    {
      id: "show-two", op: "effect.reveal", args: { pick: c("shown") },
      picks: [{ id: "shown", options: [], ordered: true, selection: "all",
        zoneSlice: { player: c("B"), zone: "deck", from: "top", count: c(2) } }]
    },
    {
      id: "move-first", op: "effect.zone",
      args: { objects: { kind: "constant", value: { linked: "show-two.revealed" } }, to: c("hand"), amount: c(1) }
    },
    {
      id: "show-remaining", op: "effect.reveal", args: { pick: c("chosen") },
      picks: [{ ...linkedSource("chosen", "show-two"), filter: { type: "unit", zone: "deck" }, min: 1, max: 1, selection: "one" }]
    }
  ]);
  const locked = stale.engine.items[0].pickPlans[0].refs;
  stale.engine.pass(stale.engine.priority);
  stale.engine.pass(stale.engine.priority);
  finishWithoutChoices(stale);
  assert.deepEqual(refIds(stale.kernel.linked("show-two.revealed")), ["first", "second"]);
  assert.deepEqual(refIds(stale.kernel.linked("show-remaining.revealed")), ["second"]);
  assert.equal(stale.kernel.getObject("first").zone, "hand");
  assert.equal(stale.kernel.getObject("second").zone, "deck");
  assert.notEqual(stale.kernel.ref("first").zoneEntryId, locked[0].zoneEntryId);
  assert.equal(stale.engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 0);
});

test("Scrutinizing Scope draw-if-other uses its original linked option rather than a target or global query", () => {
  // Supply the already-resolved guess receipt only to make the otherwise
  // unrelated missing hidden-guess primitive skip the condition. The reveal and
  // draw instruction's own linked pick shape are taken verbatim from the card.
  const guess = {
    id: "scrutinizing-scope.guess-type", op: "condition.value",
    args: { value: c("spell"), key: c("guessedType") }
  };
  const f = runtime(world()
    .player("A")
    .player("B")
    .base("source", { controller: "A", owner: "A" })
    .deck(["top-unit", "second"], { owner: "A", types: ["unit"] }));
  start(f, [guess, structuredClone(scopeReveal), structuredClone(scopeDraw)]);
  f.engine.pass(f.engine.priority);
  f.engine.pass(f.engine.priority);
  finishWithoutChoices(f);

  assert.deepEqual(refIds(f.kernel.linked("scrutinizing-scope.reveal-top.revealed")), ["top-unit"]);
  assert.deepEqual(refIds(f.kernel.zone("A", "hand")), ["top-unit"]);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 0);
  assert.deepEqual(linkedPickExpression(scopeDraw.picks[0]), scopeDraw.picks[0].options[0]);
});
