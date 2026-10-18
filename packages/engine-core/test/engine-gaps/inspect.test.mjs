import assert from "node:assert/strict";
import test from "node:test";

import dazzlingAurora from "../../../card-dsl/dist/cards/ogn/dazzling-aurora.js";
import calledShot from "../../../card-dsl/dist/cards/sfd/called-shot.js";
import candlelitSanctum from "../../../card-dsl/dist/cards/ogn/the-candlelit-sanctum.js";
import { AwaitChoice, world } from "../../dist/effects/testing/index.js";
import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import { disclosedRefs } from "../../dist/effects/instructions/effect.inspect.js";
import { fixture, resolveAll } from "../chain/helpers.mjs";

const c = value => ({ kind: "constant", value });
const revealUntil = dazzlingAurora.abilities[0].body[0];
const calledShotBody = calledShot.abilities.find(ability => ability.kind === "play").body;
const sanctumBody = candlelitSanctum.abilities.find(ability => ability.body).body;

function ids(refs) {
  return refs.map(ref => ref.id);
}

function start(f, body, id = "inspect-case") {
  f.engine.enqueue(f.draft(id, { kind: "triggered", body }));
  f.engine.advance();
}

function ask(f) {
  f.engine.pass("A");
  let request;
  assert.throws(() => f.engine.pass("B"), error => {
    assert.ok(error instanceof AwaitChoice);
    request = error.request;
    return true;
  });
  return request;
}

function resolveWithoutChoice(f) {
  f.engine.pass("A");
  f.engine.pass("B");
}

function filteredInspect(filter, min = 0) {
  return [{
    id: "look",
    op: "effect.inspect",
    args: {
      player: { kind: "object-property", object: "source", property: "controller" },
      scope: c("top"), amount: c(3), picksSpecId: c("top"),
      choose: c(true), chooseCount: c({ min, max: 1 }), filter: c(filter)
    },
    picks: [{
      id: "top", options: [], ordered: true, selection: "all",
      zoneSlice: { zone: "deck", from: "top", count: c(3) }
    }]
  }];
}

function filteredFixture() {
  const f = fixture({ cards: [
    { id: "eligible-gear", types: ["gear"], energy: 1, power: [] },
    { id: "opponent-gear", types: ["gear"], controller: "B" },
    { id: "outside-gear", types: ["gear"] }
  ] });
  for (const id of ["eligible-gear", "opponent-gear"]) {
    assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "deck-top" }).status, "done");
  }
  assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref("outside-gear"), to: "deck-bottom" }).status, "done");
  f.engine.advance();
  return f;
}

function auroraDeck() {
  return world()
    .deck("rest", { types: ["spell"] })
    .deck("unit", { types: ["unit"] })
    .deck("spell-b", { types: ["spell"] })
    .deck("spell-a", { types: ["spell"] })
    .build();
}

test("ogn-160-298 Dazzling Aurora original IR reveals the ordered prefix and links its result set", () => {
  const kernel = auroraDeck();
  const before = kernel.zone("A", "deck");
  const outcome = resolveChainBody([revealUntil], kernel);
  const result = outcome.results[0].result;

  assert.equal(result.status, "executed");
  assert.deepEqual(ids(result.linkedValues.revealed), ["spell-a", "spell-b", "unit"]);
  assert.equal(result.linkedValues.revealedCount, 3);
  assert.deepEqual(result.linkedValues.revealedMatch, kernel.ref("unit"));
  assert.deepEqual(result.linkedValues.revealedUnit, kernel.ref("unit"));
  assert.deepEqual(ids(result.linkedValues.revealedRest), ["spell-a", "spell-b"]);
  assert.equal(result.events.length, 3);
  assert.deepEqual(kernel.zone("A", "deck"), before);
  assert.equal(kernel.player("A").score, 0);
  assert.equal(outcome.linkedValues["dazzling-aurora.reveal-until-unit.revealedCount"], 3);
});

test("reveal-until stops at the first matching card and leaves later cards undisclosed", () => {
  const kernel = auroraDeck();
  const outcome = resolveChainBody([revealUntil], kernel);
  const revealed = outcome.results[0].result.linkedValues.revealed;
  assert.deepEqual(ids(revealed), ["spell-a", "spell-b", "unit"]);
  assert.equal(kernel.events.filter(event => event.action === "reveal").length, 3);
  assert.equal(kernel.history({ action: "reveal", object: kernel.ref("rest") }), 0);
});

test("reveal-until with no match reveals the whole available prefix and links null match", () => {
  const kernel = world()
    .deck("last", { types: ["spell"] })
    .deck("middle", { types: ["gear"] })
    .deck("top", { types: ["spell"] })
    .build();
  const outcome = resolveChainBody([revealUntil], kernel);
  const result = outcome.results[0].result;

  assert.equal(result.status, "executed");
  assert.deepEqual(ids(result.linkedValues.revealed), ["top", "middle", "last"]);
  assert.equal(result.linkedValues.revealedMatch, null);
  assert.equal(result.linkedValues.revealedUnit, null);
  assert.deepEqual(ids(result.linkedValues.revealedRest), ["top", "middle", "last"]);
  assert.equal(result.events.length, 3);
});

test("reveal-until on an empty deck executes without a reveal action or Burn Out", () => {
  const kernel = world().build();
  const outcome = resolveChainBody([revealUntil], kernel);
  const result = outcome.results[0].result;

  assert.equal(result.status, "executed");
  assert.deepEqual(result.linkedValues.revealed, []);
  assert.equal(result.linkedValues.revealedCount, 0);
  assert.equal(result.linkedValues.revealedMatch, null);
  assert.deepEqual(result.linkedValues.revealedRest, []);
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.player("A").score, 0);
});

for (const [hookStatus, reason] of [
  ["replaced", "replaced"],
  ["prevented", "skipped"],
  ["impossible", "impossible"]
]) {
  test(`reveal-until maps a ${hookStatus} reveal outcome without exposing an unperformed card`, () => {
    const kernel = auroraDeck();
    kernel.addReplacement(action => action.type === "reveal" ? hookStatus : null);
    const outcome = resolveChainBody([revealUntil], kernel);
    const result = outcome.results[0].result;

    assert.deepEqual(result, {
      status: "negated",
      reason,
      events: outcome.events
    });
    assert.equal(outcome.events.filter(event => event.action === "reveal").length, 4);
    assert.deepEqual(outcome.linkedValues[`${revealUntil.id}.revealed`], []);
    assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["spell-a", "spell-b", "unit", "rest"]);
  });
}

test("unknown reveal-until predicates remain judge-required and fail closed before any action", () => {
  const kernel = auroraDeck();
  const invalid = {
    ...revealUntil,
    args: { ...revealUntil.args, until: c({ type: "unit", unknownRelation: "guess" }) }
  };
  assert.throws(() => resolveChainBody([invalid], kernel), /Unsupported filter field unknownRelation/);
  assert.deepEqual(kernel.events, []);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["spell-a", "spell-b", "unit", "rest"]);
});

test("an illegal effect.order answer aborts the enclosing ChainEngine transaction", () => {
  const orderBody = [{
    id: "order-two",
    op: "effect.order",
    args: { destination: c("top"), count: c(2) }
  }];
  const engineFixture = fixture({
    choose: request => request.type === "order" ? [request.options[0]] : undefined
  });
  engineFixture.engine.enqueue(engineFixture.draft("invalid-order", {
    kind: "triggered",
    body: orderBody
  }));
  engineFixture.engine.advance();
  const beforeState = engineFixture.kernel.stateForTest();
  const beforeItems = engineFixture.engine.items;

  assert.throws(() => resolveAll(engineFixture.engine), /exact permutation/);
  assert.deepEqual(engineFixture.kernel.stateForTest(), beforeState);
  assert.deepEqual(engineFixture.engine.items, beforeItems);
});

test("Dazzling Aurora original reveal IR reads resolution-time deck order through ChainEngine and reveals publicly", () => {
  const f = fixture({ cards: [
    { id: "spell-a", types: ["spell"], energy: null, power: null },
    { id: "spell-b", types: ["spell"] }
  ] });
  for (const id of ["spell-b", "spell-a"]) {
    assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "deck-top" }).status, "done");
  }
  start(f, [revealUntil]);
  const prefix = ["spell-b", "spell-a", "A:deck:2"].map(id => f.kernel.ref(id));
  assert.equal(f.engine.commit({ type: "order-top", player: "A", objects: prefix }).status, "done");
  const before = f.kernel.zone("A", "deck");
  f.engine.advance();
  resolveAll(f.engine);

  assert.deepEqual(f.kernel.linked(`${revealUntil.id}.revealed`), prefix);
  assert.deepEqual(f.kernel.linked(`${revealUntil.id}.revealedRest`), prefix.slice(0, 2));
  assert.deepEqual(f.kernel.linked(`${revealUntil.id}.revealedUnit`), prefix[2]);
  assert.deepEqual(f.kernel.zone("A", "deck"), before);
  const events = f.engine.pipeline.events.filter(event => event.timingPoint === "card-revealed");
  assert.deepEqual(events.map(event => event.object.ref), prefix);
  assert.ok(events.every(event => event.details.visibility === "all"));
  assert.equal(f.kernel.getObject("spell-a").energy, null);
  assert.equal(f.kernel.getObject("spell-a").power, null);
});

test("a prevented matching card is excluded, then reveal-until continues to the next successfully revealed unit", () => {
  const kernel = world()
    .deck("tail", { types: ["spell"] })
    .deck("next-unit", { types: ["unit"] })
    .deck("prevented-unit", { types: ["unit"] })
    .deck("top", { types: ["spell"] })
    .build();
  kernel.addReplacement(action => action.type === "reveal" && action.object.id === "prevented-unit" ? "prevented" : null);
  const outcome = resolveChainBody([revealUntil], kernel);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(ids(outcome.linkedValues[`${revealUntil.id}.revealed`]), ["top", "next-unit"]);
  assert.deepEqual(outcome.linkedValues[`${revealUntil.id}.revealedUnit`], kernel.ref("next-unit"));
  assert.deepEqual(ids(outcome.linkedValues[`${revealUntil.id}.revealedRest`]), ["top"]);
  assert.equal(kernel.history({ action: "reveal", object: kernel.ref("tail") }), 0);
});

test("reveal-until does not let a replacement shorten or reorder its captured physical prefix", () => {
  const kernel = world()
    .deck("tail", { types: ["spell"] })
    .deck("unit", { types: ["unit"] })
    .deck("spell", { types: ["spell"] })
    .build();
  kernel.addReplacement(action => action.type === "reveal" && action.object.id === "spell" ? "replaced" : null);
  const outcome = resolveChainBody([revealUntil], kernel);
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "replaced");
  assert.deepEqual(ids(outcome.linkedValues[`${revealUntil.id}.revealed`]), ["unit"]);
  assert.deepEqual(outcome.linkedValues[`${revealUntil.id}.revealedMatch`], kernel.ref("unit"));
  assert.deepEqual(outcome.linkedValues[`${revealUntil.id}.revealedRest`], []);
  assert.equal(kernel.history({ action: "reveal", object: kernel.ref("tail") }), 0);
});

test("Called Shot original complete effect body privately picks one of the locked top two, draws it, and recycles the other", () => {
  const f = fixture();
  const initial = f.kernel.zone("A", "deck");
  start(f, calledShotBody);
  const request = ask(f);
  assert.deepEqual(request.options, initial.slice(0, 2));
  assert.equal(request.visibility, "chooser-only");
  assert.equal(request.chooser, "A");
  f.answers.set(request.id, [request.options[1]]);
  f.engine.pass("B");

  assert.equal(f.engine.items.length, 0);
  assert.equal(f.kernel.getObject(initial[1].id).zone, "hand");
  assert.deepEqual(ids(f.kernel.zone("A", "deck")), [initial[2].id, initial[3].id, initial[0].id]);
  assert.deepEqual(f.kernel.linked("called-shot.look-top-two.looked"), initial.slice(0, 2));
  const looked = f.engine.pipeline.events.filter(event => event.timingPoint === "cards-looked-at");
  assert.equal(looked.length, 1);
  assert.equal(looked[0].details.visibility, "A");
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 0);
});

test("Called Shot rejects an unseen choice, rolls back disclosure and linked results, and accepts a correct retry", () => {
  const f = fixture();
  start(f, calledShotBody);
  const request = ask(f);
  const before = f.kernel.stateForTest();
  const events = f.engine.pipeline.events;
  const items = f.engine.items;
  f.answers.set(request.id, [f.kernel.ref("A:deck:4")]);
  assert.throws(() => f.engine.pass("B"), /invalid choice answer/);
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.deepEqual(f.engine.pipeline.events, events);
  assert.deepEqual(f.engine.items, items);
  assert.equal(f.kernel.linked("called-shot.look-top-two.looked"), undefined);
  f.answers.set(request.id, [request.options[0]]);
  f.engine.pass("B");
  assert.equal(f.kernel.getObject(request.options[0].id).zone, "hand");
  assert.equal(f.engine.items.length, 0);
});

test("Called Shot does not replace a stale locked card with a new deck-top object", () => {
  const f = fixture();
  start(f, calledShotBody);
  const locked = f.engine.items[0].pickPlans[0].refs;
  assert.equal(f.engine.commit({ type: "move-zone", object: locked[0], to: "hand" }).status, "done");
  assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref(locked[0].id), to: "deck-top" }).status, "done");
  f.engine.advance();
  resolveAll(f.engine);
  assert.deepEqual(f.kernel.linked("called-shot.look-top-two.looked"), [locked[1]]);
  assert.equal(f.kernel.getObject(locked[1].id).zone, "hand");
  assert.equal(f.kernel.zone("A", "deck")[0].id, locked[0].id);
  assert.notEqual(f.kernel.ref(locked[0].id).zoneEntryId, locked[0].zoneEntryId);
});

test("Candlelit Sanctum original body supports declining to recycle and rejects an incomplete remaining-card order", () => {
  const f = fixture();
  const initial = f.kernel.zone("A", "deck");
  start(f, sanctumBody);
  const select = ask(f);
  f.answers.set(select.id, []);
  let order;
  assert.throws(() => f.engine.pass("B"), error => {
    assert.ok(error instanceof AwaitChoice);
    order = error.request;
    return true;
  });
  assert.equal(order.type, "order");
  assert.deepEqual(order.options, initial.slice(0, 2));
  const before = f.kernel.stateForTest();
  f.answers.set(order.id, [order.options[0]]);
  assert.throws(() => f.engine.pass("B"), /exact permutation/);
  assert.deepEqual(f.kernel.stateForTest(), before);
  assert.equal(f.kernel.linked("candlelit-sanctum.look.candlelit-sanctum-looked"), undefined);
  f.answers.set(order.id, [...order.options].reverse());
  f.engine.pass("B");
  assert.deepEqual(f.kernel.zone("A", "deck"), [initial[1], initial[0], ...initial.slice(2)]);
  assert.equal(f.kernel.linked("candlelit-sanctum.recycle.recycledCount"), 0);
});

test("production inspect intersects type and relative predicates with only this inspection's ordered set", () => {
  const f = filteredFixture();
  start(f, filteredInspect({ type: "gear", relation: { relation: "same-controller", object: "source" } }));
  const inspected = f.engine.items[0].pickPlans[0].refs;
  const request = ask(f);
  assert.deepEqual(ids(request.options), ["eligible-gear"]);
  assert.equal(request.visibility, "chooser-only");
  assert.equal(request.chooser, "A");
  // A gear elsewhere in the same deck is legal for the predicate, but unseen.
  f.answers.set(request.id, [f.kernel.ref("outside-gear")]);
  assert.throws(() => f.engine.pass("B"), /invalid choice answer/);
  // The revealed opponent gear is in the inspected set, but fails the relation.
  f.answers.set(request.id, [f.kernel.ref("opponent-gear")]);
  assert.throws(() => f.engine.pass("B"), /invalid choice answer/);
  // A unit in the inspected set fails the type predicate.
  f.answers.set(request.id, [f.kernel.ref("A:deck:1")]);
  assert.throws(() => f.engine.pass("B"), /invalid choice answer/);
  f.answers.set(request.id, [request.options[0]]);
  f.engine.pass("B");
  assert.deepEqual(f.kernel.linked("look.inspected-picked"), inspected);
  assert.deepEqual(f.kernel.linked("look.inspected-pick"), request.options);
});

test("inspect filter accepts the shared legacy selector spellings and still constrains the inspected set", () => {
  const f = filteredFixture();
  start(f, filteredInspect({ role: "other-friendly", type: "gear" }));
  const request = ask(f);
  assert.deepEqual(ids(request.options), ["eligible-gear"]);
  assert.equal(request.visibility, "chooser-only");
  assert.equal(request.chooser, "A");
});

test("inspect filter resolves source-location and self selectors without widening the inspected set", () => {
  const f = filteredFixture();
  start(f, filteredInspect({ type: "gear", location: "source-location" }));
  resolveWithoutChoice(f);
  assert.deepEqual(f.kernel.linked("look.inspected-pick"), []);
});

test("inspect filter maps self/other/here anchors through the same closed query vocabulary", () => {
  const f = fixture({ cards: [
    { id: "self-gear", types: ["gear"] },
    { id: "other-gear", types: ["gear"] },
    { id: "here-gear", types: ["gear"] }
  ] });
  assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref("here-gear"), to: "deck-top" }).status, "done");
  f.engine.advance();
  start(f, filteredInspect({ type: "gear", self: true }));
  resolveWithoutChoice(f);
  assert.deepEqual(f.kernel.linked("look.inspected-pick"), []);

  const g = fixture({ cards: [
    { id: "self-gear", types: ["gear"] },
    { id: "other-gear", types: ["gear"] }
  ] });
  assert.equal(g.engine.commit({ type: "move-zone", object: g.kernel.ref("other-gear"), to: "deck-top" }).status, "done");
  const otherGear = g.kernel.ref("other-gear");
  assert.equal(g.engine.commit({ type: "move-zone", object: otherGear, to: "base", location: { type: "battlefield", id: "battlefield-2" } }).status, "done");
  g.engine.advance();
  start(g, filteredInspect({ type: "gear", other: true }));
  resolveWithoutChoice(g);
  assert.deepEqual(g.kernel.linked("look.inspected-pick"), []);

  const h = fixture({ cards: [{ id: "other-gear", types: ["gear"] }] });
  assert.equal(h.engine.commit({ type: "move-zone", object: h.kernel.ref("other-gear"), to: "deck-top" }).status, "done");
  h.engine.advance();
  start(h, filteredInspect({ type: "gear", here: true }));
  resolveWithoutChoice(h);
  assert.deepEqual(h.kernel.linked("look.inspected-pick"), []);
});

test("a numeric result-set restriction preserves null printed costs and offers only a known cost", () => {
  const f = fixture({ cards: [
    { id: "no-printed-cost", types: ["gear"], energy: null, power: null },
    { id: "zero-printed-cost", types: ["gear"], energy: 0, power: [] }
  ] });
  for (const id of ["zero-printed-cost", "no-printed-cost"]) {
    assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "deck-top" }).status, "done");
  }
  f.engine.advance();
  start(f, filteredInspect({ type: "gear", energyMax: 0, powerMax: 0 }));
  const request = ask(f);
  assert.deepEqual(ids(request.options), ["zero-printed-cost"]);
  f.answers.set(request.id, request.options);
  f.engine.pass("B");
  assert.equal(f.kernel.getObject("no-printed-cost").energy, null);
  assert.equal(f.kernel.getObject("no-printed-cost").power, null);
});

for (const filter of [
  { type: "gear", unsupported: true },
  { type: "gear", pick: "source" },
  { relation: { relation: "same-controller", object: "source", unsupported: true } },
  { relation: { relation: "unknown-relation", object: "source" } },
  { characteristics: null }
]) {
  test(`inspect rejects an unsupported filter before disclosure: ${JSON.stringify(filter)}`, () => {
    const f = filteredFixture();
    start(f, filteredInspect(filter));
    const before = f.kernel.stateForTest();
    assert.throws(() => resolveAll(f.engine), /filter/);
    assert.deepEqual(f.kernel.stateForTest(), before);
    assert.equal(f.kernel.linked("look.inspected-picked"), undefined);
  });
}

test("disclosure receipts may narrow membership but cannot reorder, duplicate or widen the captured range", () => {
  const refs = ["first", "second", "third"].map(id => ({ id, zoneEntryId: 1 }));
  assert.deepEqual(disclosedRefs(refs, { status: "done", events: [], result: [refs[2], refs[0]] }), [refs[0], refs[2]]);
  assert.deepEqual(disclosedRefs(refs, { status: "done", events: [], result: [] }), []);
  for (const result of [[refs[0], refs[0]], [{ id: "outside", zoneEntryId: 1 }], [{ ...refs[0], zoneEntryId: 2 }], 3]) {
    assert.throws(() => disclosedRefs(refs, { status: "done", events: [], result }), /invalid disclosure receipt/);
  }
});

test("bottom order keeps successful moves and continues after a prevented card", () => {
  const f = fixture();
  const initial = f.kernel.zone("A", "deck");
  f.kernel.addReplacement(action => action.type === "move-zone" && action.object.id === initial[1].id ? "prevented" : null);
  start(f, [{ id: "bottom", op: "effect.order", args: { destination: c("bottom"), count: c(3), chooseOrder: c(false) } }]);
  resolveAll(f.engine);
  assert.deepEqual(ids(f.kernel.zone("A", "deck")), [initial[1].id, initial[3].id, initial[0].id, initial[2].id]);
  assert.equal(f.kernel.linked("bottom.ordered"), 2);
  assert.equal(f.kernel.ref(initial[1].id).zoneEntryId, initial[1].zoneEntryId);
});
