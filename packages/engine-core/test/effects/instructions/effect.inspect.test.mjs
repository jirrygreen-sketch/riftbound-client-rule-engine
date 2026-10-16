import test from "node:test";
import assert from "node:assert/strict";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";
import inspect from "../../../src/effects/instructions/effect.inspect.ts";

const constant = value => ({ kind: "constant", value });
const selectRequestId = "effect.inspect:select:A:A:deck";
const args = overrides => ({
  player: constant("A"), amount: constant(1), picksSpecId: constant("top"), ...overrides
});
const zoneArgs = overrides => ({ player: constant("A"), ...overrides });
// The reference kernel exposes actual zone order to the test setup. Production
// callers need an upstream ordered pick provider; query insertion order is not it.
const runTop = (kernel, overrides = {}, options = {}) => runInstruction(inspect, args(overrides), {
  world: kernel, picks: { top: kernel.zone("A", "deck") }, ...options
});

// Regressions first: these four assertions failed against e561b42.
test("top scope uses the supplied ordered picks after an order-top action", () => {
  const kernel = world().deck("first-created").deck("second-created").deck("new-top").build();
  const top = kernel.ref("new-top");
  assert.equal(kernel.perform({ type: "order-top", player: "A", objects: [top] }).status, "done");
  const run = runTop(kernel);
  assert.equal(run.result?.status, "executed");
  assert.deepEqual(run.linked["inspected-picked"], [top]);
});

test("top scope without an ordered pick provider is blocked instead of guessing", () => {
  const kernel = world().deck("a").deck("b").build();
  const run = runInstruction(inspect, zoneArgs({ amount: constant(1) }), { world: kernel });
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked, {});
});

test("a choice answer outside the inspected range is rejected transactionally", () => {
  const kernel = world().deck("a").hand("unseen").build();
  const before = kernel.stateForTest();
  assert.throws(() => runTop(kernel, { choose: constant(true) }, {
    answers: { [selectRequestId]: [kernel.ref("unseen")] }
  }), /choice/i);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("insufficient cards for a required choice negate instead of reducing its minimum", () => {
  const kernel = world().deck("a").build();
  const run = runInstruction(inspect, zoneArgs({
    choose: constant(true), chooseCount: constant({ min: 2, max: 2 })
  }), { world: kernel });
  assert.equal(run.result?.status, "negated");
  assert.equal(run.result?.reason, "impossible");
  assert.equal(run.asked, null);
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].action, "look");
  assert.deepEqual(run.linked, {});
});

test("looks at the top card of the deck and links the count", () => {
  const kernel = world().deck("bottom").deck("top").build();
  const top = kernel.ref("top");
  const before = kernel.zone("A", "deck");
  const run = runTop(kernel);
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.inspected, 1);
  assert.deepEqual(run.linked["inspected-picked"], [top]);
  assert.deepEqual(run.result.linkedValues, run.linked);
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].action, "look");
  assert.deepEqual(kernel.zone("A", "deck"), before);
  assert.equal(kernel.player("A").deckSize, 2);
});

test("looking at an empty deck executes with zero cards (432.1.c, no Burn Out)", () => {
  const kernel = world().build();
  const run = runTop(kernel);
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.inspected, 0);
  assert.deepEqual(run.linked["inspected-picked"], []);
  assert.equal(run.events.length, 0);
});

test("amount beyond the deck looks at as many as possible without burning out", () => {
  const kernel = world().deck("bottom").deck("top").build();
  const before = kernel.zone("A", "deck");
  const run = runTop(kernel, { amount: constant(5) });
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.inspected, 2);
  assert.deepEqual(run.linked["inspected-picked"], before);
  assert.deepEqual(kernel.zone("A", "deck"), before);
  assert.equal(kernel.player("A").score, 0);
  assert.equal(kernel.player("B").score, 0);
});

test("amount 0 is a deterministic no-op that still executes without an ordered provider", () => {
  const kernel = world().deck("a").build();
  const run = runInstruction(inspect, zoneArgs({ amount: constant(0) }), { world: kernel });
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.inspected, 0);
  assert.deepEqual(run.linked["inspected-picked"], []);
  assert.equal(kernel.events.length, 0);
});

for (const [status, reason] of [["replaced", "replaced"], ["prevented", "skipped"], ["impossible", "impossible"]]) {
  test(`a ${status} hook on the look action negates the instruction`, () => {
    const kernel = world().deck("a").build();
    kernel.addReplacement(action => action.type === "look" ? status : null);
    const run = runTop(kernel, { choose: constant(true) });
    assert.equal(run.result?.status, "negated");
    assert.equal(run.result?.reason, reason);
    assert.equal(run.events.length, 1);
    assert.equal(run.events[0].outcome, status);
    assert.deepEqual(run.result.events, run.events);
    assert.deepEqual(run.linked, {});
    assert.equal(run.asked, null);
  });
}

test("invalid target refs (stale zoneEntryId) make the instruction ignored", () => {
  const kernel = world().deck("a").build();
  const stale = kernel.ref("a");
  assert.equal(kernel.perform({ type: "recycle", object: stale }).status, "done");
  assert.equal(kernel.object(stale), null);
  const run = runInstruction(inspect, zoneArgs({ targetSpecId: constant("t") }), {
    world: kernel, targets: { t: [stale] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked, {});
});

test("wholly invalid targets are ignored before evaluating target-dependent arguments", () => {
  const kernel = world().deck("a").build();
  const stale = kernel.ref("a");
  kernel.perform({ type: "discard", object: stale });
  const run = runInstruction(inspect, zoneArgs({
    player: { kind: "object-property", object: stale, property: "owner" },
    targetSpecId: constant("t")
  }), { world: kernel, targets: { t: [stale] } });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.deepEqual(run.linked, {});
});

test("an empty locked target set is ignored while an empty pick set executes", () => {
  const kernel = world().deck("a").build();
  const target = runInstruction(inspect, zoneArgs({ targetSpecId: constant("t") }), { world: kernel });
  assert.equal(target.result?.status, "ignored");
  const pick = runInstruction(inspect, zoneArgs({ picksSpecId: constant("p") }), { world: kernel });
  assert.equal(pick.result?.status, "executed");
  assert.equal(pick.linked.inspected, 0);
});

test("partially invalid targets inspect only surviving in-range objects", () => {
  const kernel = world().deck("stale").deck("live").hand("outside").build();
  const stale = kernel.ref("stale");
  kernel.perform({ type: "discard", object: stale });
  const live = kernel.ref("live");
  const run = runInstruction(inspect, zoneArgs({ targetSpecId: constant("t") }), {
    world: kernel, targets: { t: [stale, kernel.ref("outside"), live] }
  });
  assert.equal(run.result?.status, "executed");
  assert.deepEqual(run.linked["inspected-picked"], [live]);
});

test("a needed choice suspends without an answer and leaves the world untouched", () => {
  const kernel = world().deck("bottom").deck("middle").deck("top").build();
  const before = kernel.stateForTest();
  const run = runTop(kernel, { amount: constant(2), choose: constant(true) });
  assert.equal(run.result, null);
  assert.ok(run.asked);
  assert.deepEqual(run.asked.request, {
    id: selectRequestId, type: "select-objects", chooser: "A", visibility: "chooser-only",
    options: [kernel.ref("top"), kernel.ref("middle")], min: 0, max: 2
  });
  assert.deepEqual(run.events, []);
  assert.deepEqual(run.linked, {});
  assert.deepEqual(kernel.stateForTest(), before);
});

test("replaying with an answer commits deterministically (sfd-065-221 Forecaster, M1 Rumble)", () => {
  // Forecaster: "Your Mechs have [Vision]. (When you play us, look at the top
  // card of your Main Deck. You may recycle it.)" This tests accepting the pick;
  // the linked ref goes to a separate recycle instruction, never a fixture move.
  const kernel = world().deck("rest").deck("forecaster-top").build();
  const top = kernel.ref("forecaster-top");
  const initial = kernel.clone();
  const unanswered = runTop(kernel, { choose: constant(true) });
  assert.equal(unanswered.result, null);
  const options = { answers: { [unanswered.asked.request.id]: [top] } };
  const first = runTop(kernel, { choose: constant(true) }, options);
  const replay = runTop(initial, { choose: constant(true) }, options);
  assert.equal(first.result?.status, "executed");
  assert.deepEqual(first.linked["inspected-picked"], [top]);
  assert.deepEqual(first.linked["inspected-pick"], [top]);
  assert.deepEqual(replay.result, first.result);
  assert.deepEqual(replay.events, first.events);
  assert.deepEqual(initial.stateForTest(), kernel.stateForTest());
});

test("sfd-065-221 Forecaster (M1 Rumble): declining Vision keeps the same top card", () => {
  // CR 817.2: multiple Vision triggers are separate; declining the first pick
  // leaves the same top card available for the next trigger's inspection.
  const kernel = world().deck("rest").deck("top").build();
  const top = kernel.ref("top");
  const declined = runTop(kernel, { choose: constant(true), choiceId: constant("vision-1") }, {
    answers: { "vision-1": [] }
  });
  assert.equal(declined.result?.status, "executed");
  assert.deepEqual(declined.linked["inspected-pick"], []);
  assert.deepEqual(declined.linked["inspected-picked"], [top]);
  const second = runTop(kernel, { choose: constant(true), choiceId: constant("vision-2") });
  assert.deepEqual(second.asked?.request.options, [top]);
  assert.equal(second.asked?.request.id, "vision-2");
  assert.deepEqual(kernel.zone("A", "deck"), [top, kernel.ref("rest")]);
});

test("unl-136-219 Scryer's Bloom Predict 2: look at two, choose any privately", () => {
  // Task example / M1 reserve Vex: "[Predict 2], then draw 1. Gain 1 XP."
  // 437.1.a: inspect two and pick any number; draw, XP, recycle and order follow.
  const kernel = world().deck("third").deck("second").deck("top").build();
  const refs = [kernel.ref("top"), kernel.ref("second")];
  const overrides = {
    amount: constant(2), choose: constant(true), chooseCount: constant({ min: 0, max: 2 }),
    linkedKey: constant("predict-count"), pickedKey: constant("predict-picked"),
    choosePicksKey: constant("predict-chosen")
  };
  const before = kernel.stateForTest();
  const asked = runTop(kernel, overrides);
  assert.equal(asked.result, null);
  assert.deepEqual(asked.asked.request.options, refs);
  assert.equal(asked.asked.request.max, 2);
  assert.deepEqual(kernel.stateForTest(), before);
  const answered = runTop(kernel, overrides, { answers: { [selectRequestId]: [refs[1]] } });
  assert.equal(answered.result?.status, "executed");
  assert.equal(answered.linked["predict-count"], 2);
  assert.deepEqual(answered.linked["predict-picked"], refs);
  assert.deepEqual(answered.linked["predict-chosen"], [refs[1]]);
  assert.equal(kernel.player("A").deckSize, 3);
});

test("unl-211-219 Forgotten Library Predict 1: may recycle the top card", () => {
  // Task example: "...if you spent [4] or more, [Predict]. (Look at the top
  // card of your Main Deck. You may recycle it.)" The trigger/cost test is upstream.
  const kernel = world().deck("second").deck("top").build();
  const overrides = { choose: constant(true), chooseCount: constant({ min: 0, max: 1 }) };
  const declined = runTop(kernel, overrides, { answers: { [selectRequestId]: [] } });
  assert.equal(declined.result?.status, "executed");
  assert.equal(declined.linked.inspected, 1);
  assert.deepEqual(declined.linked["inspected-pick"], []);
  const top = kernel.ref("top");
  const taken = runTop(kernel, overrides, { answers: { [selectRequestId]: [top] } });
  assert.equal(taken.result?.status, "executed");
  assert.deepEqual(taken.linked["inspected-pick"], [top]);
});

test("searching a private zone only offers the upstream matching cards and may fail to find", () => {
  // CR 128.6: the quality selector belongs to target.query; this is a generic
  // hidden-hand search, not Baited Hook (ogn-242-298 actually looks at deck top 5).
  const kernel = world().hand("foe-unit", { owner: "B", types: ["unit"] })
    .hand("foe-spell", { owner: "B", types: ["spell"] }).build();
  const match = kernel.ref("foe-unit");
  const requestId = "effect.inspect:select:A:B:hand";
  const searchArgs = zoneArgs({
    zone: constant({ owner: "B", zone: "hand" }), picksSpecId: constant("match"),
    choose: constant(true), chooseCount: constant({ min: 0, max: 1 })
  });
  const before = kernel.zone("B", "hand");
  const asked = runInstruction(inspect, searchArgs, { world: kernel, picks: { match: [match] } });
  assert.equal(asked.result, null);
  assert.deepEqual(asked.asked.request.options, [match]);
  assert.equal(asked.asked.request.visibility, "chooser-only");
  const answered = runInstruction(inspect, searchArgs, {
    world: kernel, picks: { match: [match] }, answers: { [requestId]: [] }
  });
  assert.equal(answered.result?.status, "executed");
  assert.equal(answered.linked.inspected, 1);
  assert.deepEqual(answered.linked["inspected-pick"], []);
  assert.deepEqual(kernel.zone("B", "hand"), before);
});

test("whole-zone queries inspect every card only in the requested owner's zone", () => {
  const kernel = world().deck("z").deck("a").deck("other", { owner: "B" }).hand("hand").build();
  const run = runInstruction(inspect, zoneArgs(), { world: kernel });
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.inspected, 2);
  assert.deepEqual(run.linked["inspected-picked"], [kernel.ref("a"), kernel.ref("z")]);
});

test("picks exclude stale refs, other zones, other owners and duplicates without widening", () => {
  const kernel = world().deck("valid").deck("stale").deck("other", { owner: "B" }).hand("hand").build();
  const stale = kernel.ref("stale");
  kernel.perform({ type: "discard", object: stale });
  const valid = kernel.ref("valid");
  const run = runInstruction(inspect, zoneArgs({ picksSpecId: constant("p") }), {
    world: kernel, picks: { p: ["A", stale, kernel.ref("other"), kernel.ref("hand"), valid, valid] }
  });
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.inspected, 1);
  assert.deepEqual(run.linked["inspected-picked"], [valid]);
});

test("rune-deck inspection uses its own ordered pool without touching the Main Deck", () => {
  const kernel = world().deck("main").rune("bottom").rune("top").build();
  const top = kernel.ref("top");
  const run = runTop(kernel, { zone: constant("rune-deck") }, {
    picks: { top: kernel.zone("A", "rune-deck") }
  });
  assert.equal(run.result?.status, "executed");
  assert.deepEqual(run.linked["inspected-picked"], [top]);
  assert.equal(kernel.player("A").runeDeckSize, 2);
  assert.equal(kernel.player("A").deckSize, 1);
});

test("dynamic Expr reads earlier links at resolution and never converts null printed values", () => {
  const kernel = world().deck("bottom").deck("top", { energy: null, power: null }).build();
  const run = runTop(kernel, {
    amount: { kind: "linked", instructionId: "previous", key: "n" },
    player: { kind: "object-property", object: kernel.ref("top"), property: "owner" }
  }, { linked: { n: 2 } });
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.inspected, 2);
  assert.equal(kernel.object(kernel.ref("top")).energy, null);
  assert.equal(kernel.object(kernel.ref("top")).power, null);
});

test("empty optional choices and max 0 execute without asking", () => {
  for (const kernel of [world().build(), world().deck("a").build()]) {
    const run = runTop(kernel, { choose: constant(true), chooseCount: constant({ min: 0, max: 0 }) });
    assert.equal(run.result?.status, "executed");
    assert.equal(run.asked, null);
    assert.deepEqual(run.linked["inspected-pick"], []);
  }
});

for (const [name, answer] of [
  ["duplicates", refs => [refs[0], refs[0]]],
  ["too few", () => []],
  ["too many", refs => refs],
  ["wrong shape", () => "top"],
  ["stale identity", refs => [{ ...refs[0], zoneEntryId: refs[0].zoneEntryId + 1 }]]
]) {
  test(`invalid choice answer (${name}) is rejected without committing look events`, () => {
    const kernel = world().deck("bottom").deck("top").build();
    const before = kernel.stateForTest();
    assert.throws(() => runTop(kernel, {
      amount: constant(2), choose: constant(true), chooseCount: constant({ min: 1, max: 1 })
    }, { answers: { [selectRequestId]: answer(kernel.zone("A", "deck")) } }), /choice/i);
    assert.deepEqual(kernel.stateForTest(), before);
  });
}

test("a valid mandatory choice keeps its minimum and caps only its maximum", () => {
  const kernel = world().deck("top").build();
  const overrides = { choose: constant(true), chooseCount: constant({ min: 1, max: 9 }) };
  const asked = runTop(kernel, overrides);
  assert.equal(asked.asked.request.min, 1);
  assert.equal(asked.asked.request.max, 1);
  const answered = runTop(kernel, overrides, { answers: { [selectRequestId]: [kernel.ref("top")] } });
  assert.equal(answered.result?.status, "executed");
  assert.deepEqual(answered.linked["inspected-pick"], [kernel.ref("top")]);
});

test("argsSchema validates every expression and reports malformed IR through safeParse", () => {
  for (const value of [
    null, {}, { player: "A" }, { player: {} }, zoneArgs({ amount: 1 }),
    zoneArgs({ choose: { kind: "unsupported" } }), zoneArgs({ scope: constant(Infinity) }),
    zoneArgs({ typo: constant(true) }),
    zoneArgs({ targetSpecId: constant("t"), picksSpecId: constant("p") })
  ]) {
    assert.equal(inspect.argsSchema.safeParse(value).success, false);
    assert.throws(() => inspect.argsSchema.parse(value), /effect.inspect/);
  }
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(inspect.argsSchema.safeParse(zoneArgs({ zone: constant(cyclic) })).success, false);
  const valid = args();
  assert.equal(inspect.argsSchema.safeParse(valid).success, true);
  assert.deepEqual(inspect.argsSchema.parse(valid), valid);
});

test("invalid evaluated arguments fail before any action or choice", () => {
  for (const overrides of [
    { player: constant(null) }, { zone: constant("typo") }, { zone: constant({ zone: "deck" }) },
    { scope: constant("typo") }, { scope: constant("zone") }, { amount: constant(-1) },
    { amount: constant(1.5) }, { amount: constant(null) }, { choose: constant("false") },
    { chooseCount: constant({ min: 3, max: 1 }) }, { chooseCount: constant({ min: 0, max: null }) },
    { chooseCount: constant(null) }, { chooseCount: constant({ min: 0, max: -1 }) },
    { linkedKey: constant("") }, { linkedKey: constant("inspected-picked") },
    { choose: constant(true), choosePicksKey: constant("inspected") }
  ]) {
    const kernel = world().deck("top").build();
    assert.throws(() => runTop(kernel, overrides), /effect.inspect/);
    assert.deepEqual(kernel.events, []);
  }
});

test("missing scope prerequisites are rejected rather than silently querying the whole zone", () => {
  for (const value of [
    zoneArgs({ scope: constant("top") }), zoneArgs({ scope: constant("picks") }),
    zoneArgs({ targetSpecId: constant("t"), amount: constant(1) })
  ]) {
    const kernel = world().deck("a").build();
    assert.throws(() => runInstruction(inspect, value, {
      world: kernel, targets: { t: [kernel.ref("a")] }
    }), /effect.inspect/);
  }
});
