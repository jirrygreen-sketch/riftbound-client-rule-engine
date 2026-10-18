import assert from "node:assert/strict";
import test from "node:test";
import gustMonk from "../../../card-dsl/dist/cards/ven/gust-monk.js";
import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import { finalizeOrderedPickPlans, lockedOrderedPicks, pickSpecs } from "../../dist/chain/picks/plan.js";
import { PickSelectionError, resolveNonTargetPick } from "../../dist/target/picks/plan.js";
import { AwaitChoice, runInstruction, world } from "../../dist/effects/testing/index.js";

const ref = (id, zoneEntryId = 1) => ({ id, zoneEntryId });

function object(id, values = {}) {
  return {
    ref: ref(id, values.zoneEntryId ?? 1),
    cardId: values.cardId ?? id,
    name: values.name ?? id,
    types: values.types ?? ["unit"],
    tags: values.tags ?? [],
    keywords: values.keywords ?? [],
    owner: values.owner ?? "A",
    controller: values.controller ?? values.owner ?? "A",
    zone: values.zone ?? "board",
    location: values.location ?? { type: "battlefield", id: "bf1" },
    might: values.might ?? 2,
    energy: values.energy === undefined ? null : values.energy,
    power: values.power === undefined ? null : values.power,
    exhausted: values.exhausted ?? false,
    damage: values.damage ?? 0,
    stunned: values.stunned ?? false,
    buffs: values.buffs ?? 0,
    attachedTo: values.attachedTo ?? null,
    faceDown: values.faceDown ?? false,
    isToken: values.isToken ?? false
  };
}

function contextFor(initialObjects, { linked = {}, answers = {}, source } = {}) {
  let objects = initialObjects.map(item => structuredClone(item));
  const requests = [];
  let targetReads = 0;
  const currentSource = source ?? objects[0] ?? object("source");
  const matches = (item, filter) => Object.entries(filter ?? {}).every(([key, expected]) => {
    if (key === "exclude" && expected === "self") return item.ref.id !== currentSource.ref.id;
    if (key === "type") return item.types.includes(String(expected));
    if (key === "types") return Array.isArray(expected) && expected.every(type => item.types.includes(String(type)));
    if (key === "owner" || key === "controller") {
      const actual = item[key];
      const wanted = expected === "self" ? "A" : expected === "opponent" ? "B" : expected;
      return actual === wanted;
    }
    if (key === "states") return expected === "exhausted" ? item.exhausted : true;
    if (key === "zone" || key === "combatRole" || key === "location") return Object.is(item[key], expected);
    return true;
  });
  const find = candidate => objects.find(item => item.ref.id === candidate.id && item.ref.zoneEntryId === candidate.zoneEntryId) ?? null;
  const ctx = {
    source: currentSource,
    controller: "A",
    timingPoint: "chain-item-resolve",
    object: candidate => find(candidate),
    lastKnown: candidate => objects.find(item => item.ref.id === candidate.id) ?? object(candidate.id, { zoneEntryId: candidate.zoneEntryId }),
    query: filter => objects.filter(item => matches(item, filter)),
    zoneSlice: (player, zone, from, count) => {
      const values = objects.filter(item => item.owner === player && item.zone === zone);
      const limited = count === undefined ? values : values.slice(0, count);
      return from === "top" ? limited : values.slice(Math.max(0, values.length - limited.length));
    },
    targets: () => { targetReads++; return []; },
    picks: () => [],
    player: id => ({ id, energy: 0, power: [], runePool: [], runes: [], xp: 0, score: 0, handSize: 0, handCount: 0, deckSize: 0, deckCount: 0, runeDeckSize: 0, runeDeckCount: 0 }),
    evaluate: expression => {
      if (expression.kind === "constant" || expression.kind === "literal") return expression.value;
      if (expression.kind === "linked" || expression.kind === "linked-value") return linked[expression.key ?? expression.instructionId] ?? null;
      return null;
    },
    test: () => true,
    linked: key => linked[key],
    history: () => 0,
    choose: request => {
      requests.push(request);
      if (!Object.hasOwn(answers, request.id)) throw new Error(`missing answer ${request.id}`);
      return answers[request.id];
    },
    perform: () => ({ status: "done", events: [] }),
    link: () => {},
    addContinuous: () => {},
    registerDelayedTrigger: () => {}
  };
  return {
    ctx,
    requests,
    get targetReads() { return targetReads; },
    replace(next) { objects = next.map(item => structuredClone(item)); },
    current() { return objects.map(item => structuredClone(item)); }
  };
}

test("filter picks query the current restricted set in query order and stay outside target callbacks", () => {
  const a = object("a", { types: ["unit"] });
  const gear = object("gear", { types: ["gear"] });
  const b = object("b", { types: ["unit"] });
  const harness = contextFor([a, gear, b]);
  const result = resolveNonTargetPick(harness.ctx, {
    id: "units",
    options: [],
    filter: { type: "unit", zone: "board" },
    selection: "all"
  });
  assert.deepEqual(result.selected.map(value => value.id), ["a", "b"]);
  assert.equal(result.status, "resolved");
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.targetReads, 0);
});

test("linked picks restrict without reordering and ask the chooser privately once", () => {
  const first = object("first", { types: ["gear"], owner: "B", controller: "B" });
  const second = object("second", { types: ["unit"] });
  const third = object("third", { types: ["unit"] });
  const harness = contextFor([first, second, third], {
    linked: { objects: [first.ref, second.ref, third.ref] },
    answers: { "pick:linked-unit": [third.ref] }
  });
  const result = resolveNonTargetPick(harness.ctx, {
    id: "linked-unit",
    options: [],
    linked: { kind: "linked-value", instructionId: "look", key: "objects" },
    filter: { type: "unit", zone: "board" },
    selection: "one"
  });
  assert.deepEqual(result.plan.offered.map(value => value.id), ["second", "third"]);
  assert.deepEqual(result.selected.map(value => value.id), ["third"]);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].visibility, "chooser-only");
  assert.deepEqual(harness.requests[0].options.map(value => value.id), ["second", "third"]);
});

test("Finalize zoneSlice references are consumed in order and stale incarnations are re-tested at Resolve", () => {
  const top = object("top", { zone: "deck" });
  const bottom = object("bottom", { zone: "deck" });
  const harness = contextFor([top, bottom]);
  const spec = {
    id: "slice",
    options: [],
    ordered: true,
    selection: "all",
    zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 2 } }
  };
  const body = [{ id: "look", op: "effect.inspect", args: {}, picks: [spec] }];
  const plans = finalizeOrderedPickPlans(harness.ctx, body);
  const locked = lockedOrderedPicks(plans, "slice");
  assert.deepEqual(locked.map(value => value.id), ["top", "bottom"]);

  harness.replace([object("top", { zone: "deck", zoneEntryId: 2 }), bottom]);
  const result = resolveNonTargetPick(harness.ctx, spec, { source: locked });
  assert.deepEqual(result.selected.map(value => value.id), ["bottom"]);
  assert.deepEqual(result.invalid.map(value => value.id), ["top"]);
  assert.equal(result.status, "partial");
});

test("invalid duplicate answers and mandatory empty candidates fail closed", () => {
  const a = object("a");
  const b = object("b");
  const harness = contextFor([a, b]);
  const spec = { id: "two", options: [], selection: "any", min: 1, max: 2 };
  assert.throws(
    () => resolveNonTargetPick(harness.ctx, spec, { source: [a.ref, b.ref], selected: [a.ref, a.ref] }),
    error => error instanceof PickSelectionError && error.code === "invalid-choice"
  );

  const impossible = resolveNonTargetPick(harness.ctx, {
    id: "missing",
    options: [],
    filter: { type: "gear", zone: "board" },
    selection: "one"
  });
  assert.equal(impossible.status, "impossible");
  assert.equal(impossible.reason, "unavailable");
  assert.deepEqual(impossible.selected, []);
});

test("pick lifecycle walks nested mode bodies while rejecting a repeated Finalize zone binding", () => {
  const nested = {
    id: "nested-pick",
    options: ["runtime"],
    filter: { type: "unit" },
    selection: "one"
  };
  const modeBody = [{ id: "mode-body", op: "effect.ready", args: {}, picks: [nested] }];
  const mode = [{
    id: "mode",
    op: "choice.mode",
    args: { modes: { kind: "constant", value: [{ id: "one", body: modeBody }] } }
  }];
  assert.deepEqual(pickSpecs(mode).map(spec => spec.id), ["nested-pick"]);

  const repeatedSlice = {
    id: "repeat-slice",
    options: [],
    ordered: true,
    selection: "all",
    zoneSlice: { zone: "deck", from: "top" }
  };
  assert.throws(() => pickSpecs([{
    id: "repeat",
    op: "repeat",
    args: { body: { kind: "constant", value: [{ id: "body", op: "effect.inspect", args: {}, picks: [repeatedSlice] }] } }
  }]), /repeated zone slice/);
});

test("a representative card IR uses the production chain adapter, chooser-only visibility, and transactional rollback", () => {
  const banish = gustMonk.abilities[1].body[0];
  const body = [banish];
  const definition = {
    op: "test.production-pick",
    argsSchema: { parse: value => value },
    execute: context => resolveChainBody(body, context)
  };
  const kernel = world().card("trash-card", { zone: "trash", types: ["unit"] }).build();
  const waiting = runInstruction(definition, {}, { world: kernel });
  assert.ok(waiting.asked instanceof AwaitChoice);
  assert.equal(waiting.asked.request.visibility, "chooser-only");
  assert.equal(waiting.asked.request.options[0].id, "trash-card");
  assert.equal(kernel.getObject("trash-card").zone, "trash");
  assert.equal(kernel.events.length, 0);

  const completed = runInstruction(definition, {}, {
    world: kernel,
    answers: { [waiting.asked.request.id]: [waiting.asked.request.options[0]] }
  });
  assert.equal(completed.result.status, "executed");
  assert.equal(kernel.getObject("trash-card").zone, "banishment");
  assert.equal(kernel.events.some(event => event.timingPoint === "became-target"), false);
});
