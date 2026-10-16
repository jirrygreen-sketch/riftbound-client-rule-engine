import test from "node:test";
import assert from "node:assert/strict";
import { runInstruction, world } from "../../../dist/effects/testing/index.js";
import inspect from "../../../dist/effects/instructions/effect.inspect.js";

const constant = value => ({ kind: "constant", value });

const args = overrides => ({
  player: constant("A"),
  amount: constant(1),
  ...overrides
});

const selectRequestId = "effect.inspect:select:A:A:deck";

// The reference kernel's query() has no zone order; runInstruction clones the world,
// so probe the clone for the deterministic insertion-ordered object list it sees.
const probe = kernel => runInstruction(inspect, { player: constant("A"), scope: constant("zone") }, { world: kernel }).linked["inspected-picked"];

const refOf = (kernel, id) => kernel.ref(id);

test("looks at the top card of the deck and links the count", () => {
  const kernel = world().deck("top").deck("second").build();
  const top = probe(kernel)[0];
  const run = runInstruction(inspect, args(), { world: kernel });
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.inspected, 1);
  assert.deepEqual(run.linked["inspected-picked"], [top]);
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].action, "look");
  // CR v1.5 432.1.c Reminder: cards stay in their zone while being looked at.
  assert.equal(kernel.player("A").deckSize, 2);
});

test("looking at an empty deck executes with zero cards (432.1.c, no Burn Out)", () => {
  const kernel = world().build();
  const run = runInstruction(inspect, args(), { world: kernel });
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.inspected, 0);
  assert.deepEqual(run.linked["inspected-picked"], []);
  assert.equal(run.events.length, 0);
});

test("amount beyond the deck looks at as many as possible without burning out", () => {
  const kernel = world().deck("a").deck("b").build();
  const run = runInstruction(inspect, args({ amount: constant(5) }), { world: kernel });
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.inspected, 2);
  assert.deepEqual(run.linked["inspected-picked"], probe(kernel));
  assert.equal(kernel.player("A").deckSize, 2);
});

test("amount 0 is a deterministic no-op that still executes", () => {
  const kernel = world().deck("a").build();
  const run = runInstruction(inspect, args({ amount: constant(0) }), { world: kernel });
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked.inspected, 0);
  assert.deepEqual(run.linked["inspected-picked"], []);
  assert.equal(kernel.events.length, 0);
});

test("a replacement hook on the look action negates the instruction", () => {
  const kernel = world().deck("a").build();
  kernel.addReplacement(action => (action.type === "look" ? "replaced" : null));
  const run = runInstruction(inspect, args(), { world: kernel });
  assert.equal(run.result?.status, "negated");
  assert.equal(run.result?.reason, "replaced");
  assert.equal(run.linked.inspected, undefined);
});

test("invalid target refs (stale zoneEntryId) make the instruction ignored", () => {
  const kernel = world().deck("a").build();
  const stale = kernel.ref("a");
  kernel.perform({ type: "recycle", object: stale });
  assert.equal(kernel.object(stale), null);
  const run = runInstruction(
    inspect,
    { player: constant("A"), targetSpecId: constant("t") },
    { world: kernel, targets: { t: [stale] } }
  );
  assert.equal(run.result?.status, "ignored");
  assert.equal(run.result?.reason, "mistargeted");
});

test("a needed choice suspends without an answer and leaves the world untouched", () => {
  const kernel = world().deck("a").deck("b").deck("c").build();
  const run = runInstruction(inspect, args({ amount: constant(3), choose: constant(true) }), { world: kernel });
  assert.equal(run.result, null);
  assert.ok(run.asked);
  assert.equal(run.asked.request.id, selectRequestId);
  assert.equal(run.asked.request.type, "select-objects");
  assert.equal(run.asked.request.chooser, "A");
  assert.equal(run.asked.request.visibility, "chooser-only");
  const baselineEvents = kernel.events.length;
  assert.deepEqual(run.asked.request.options, probe(kernel));
  // Rollback: the probe above adds its own look event; the suspended run adds none.
  assert.equal(kernel.events.length, baselineEvents + 1);
});

test("replaying with an answer commits deterministically (sfd-065-221 Forecaster)", () => {
  // M1 Rumble deck, sfd-065-221 Forecaster: "Your Mechs have [Vision]. (When you
  // play us, look at the top card of your Main Deck. You may recycle it.)"
  // effect.inspect covers the "look at the top card" step; recycle is a follow-up
  // instruction on the linked pick.
  const kernel = world().deck("forecaster-top").deck("rest").build();
  const top = probe(kernel)[0];
  const answers = { [selectRequestId]: [top] };
  const first = runInstruction(inspect, args({ choose: constant(true) }), { world: kernel, answers });
  assert.equal(first.result?.status, "executed");
  assert.deepEqual(first.linked["inspected-picked"], [top]);
  assert.deepEqual(first.linked["inspected-pick"], [top]);
  // Deterministic replay: same world state and answer produce the same result.
  const second = runInstruction(inspect, args({ choose: constant(true) }), { world: kernel, answers });
  assert.deepEqual(second.linked["inspected-picked"], first.linked["inspected-picked"]);
});

test("unl-136-219 Scryer's Bloom Predict 2: look at two, choose any privately", () => {
  // M1 Vex deck, unl-136-219 Scryer's Bloom: "[Predict 2], then draw 1. Gain 1 XP.
  // (To Predict 2, look at the top two cards of your Main Deck. Recycle any of them
  // and put the rest back in any order.)" — the inspect step sees exactly two cards
  // and the player privately picks any number of them ("recycle any of them").
  const kernel = world().deck("top").deck("second").deck("third").build();
  const refs = probe(kernel);
  const baselineEvents = kernel.events.length;
  const inspectArgs = args({
    amount: constant(2),
    choose: constant(true),
    chooseCount: constant({ min: 0, max: 2 }),
    linkedKey: constant("predict-count"),
    pickedKey: constant("predict-picked"),
    choosePicksKey: constant("predict-chosen")
  });
  const asked = runInstruction(inspect, inspectArgs, { world: kernel });
  assert.equal(asked.result, null);
  assert.equal(asked.asked?.request.id, selectRequestId);
  assert.equal(asked.asked?.request.options.length, 2);
  assert.equal(asked.asked?.request.max, 2);
  assert.equal(kernel.events.length, baselineEvents);
  const answered = runInstruction(inspect, inspectArgs, {
    world: kernel,
    answers: { [selectRequestId]: [refs[1]] }
  });
  assert.equal(answered.result?.status, "executed");
  assert.equal(answered.linked["predict-count"], 2);
  // The linked pool keeps pool order (the two looked cards, top first); the chosen card is linked separately.
  assert.deepEqual(answered.linked["predict-picked"], refs.slice(0, 2));
  assert.deepEqual(answered.linked["predict-chosen"], [refs[1]]);
  assert.equal(kernel.player("A").deckSize, 3);
});

test("unl-211-219 Forgotten Library Predict 1: may recycle the top card", () => {
  // unl-211-219 Forgotten Library: "if you spent 4 or more, [Predict]. (Look at the
  // top card of your Main Deck. You may recycle it.)" — min 0, max 1: the player
  // may decline, in which case nothing is picked and the rest of the instruction
  // sees an empty choice.
  const kernel = world().deck("top").deck("second").build();
  const inspectArgs = args({ choose: constant(true), chooseCount: constant({ min: 0, max: 1 }) });
  const declined = runInstruction(inspect, inspectArgs, {
    world: kernel,
    answers: { [selectRequestId]: [] }
  });
  assert.equal(declined.result?.status, "executed");
  assert.equal(declined.linked.inspected, 1);
  assert.deepEqual(declined.linked["inspected-pick"], []);
  const refs = probe(kernel);
  const taken = runInstruction(inspect, inspectArgs, {
    world: kernel,
    answers: { [selectRequestId]: [refs[0]] }
  });
  assert.equal(taken.result?.status, "executed");
  assert.deepEqual(taken.linked["inspected-pick"], [refs[0]]);
});

test("searching a private zone only offers the matching cards (ogn-242-298 pattern)", () => {
  // RIFT-9 survey example ogn-242-298: searching a hidden zone for a named quality.
  // CR v1.5 128.6: a player cannot be compelled to act on private cards by quality —
  // so the chooser only ever sees the matching options and may fail to find (min 0).
  const kernel = world()
    .hand("foe-unit", { owner: "B", types: ["unit"] })
    .hand("foe-spell", { owner: "B", types: ["spell"] })
    .build();
  const match = refOf(kernel, "foe-unit");
  const requestId = "effect.inspect:select:A:B:hand";
  const searchArgs = {
    player: constant("A"),
    zone: constant({ owner: "B", zone: "hand" }),
    scope: constant("picks"),
    picksSpecId: constant("match"),
    choose: constant(true),
    chooseCount: constant({ min: 0, max: 1 })
  };
  const asked = runInstruction(inspect, searchArgs, { world: kernel, picks: { match: [match] } });
  assert.equal(asked.result, null);
  assert.deepEqual(asked.asked?.request.options, [match]);
  assert.equal(asked.asked?.request.visibility, "chooser-only");
  const answered = runInstruction(inspect, searchArgs, {
    world: kernel,
    picks: { match: [match] },
    answers: { [requestId]: [match] }
  });
  assert.equal(answered.result?.status, "executed");
  assert.deepEqual(answered.linked["inspected-pick"], [match]);
  // The opponent's cards never left their hand.
  assert.equal(kernel.player("B").handSize, 2);
});
