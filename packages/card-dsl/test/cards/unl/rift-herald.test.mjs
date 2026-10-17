import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/rift-herald.js";
import recycle from "../../../../engine-core/dist/effects/instructions/effect.recycle.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { finalizeOrderedPickPlans } from "../../../../engine-core/dist/chain/picks/plan.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-3a0b70431fa51262d1b6a8b6d9998f8531df9a50ab7dbe01cf460fe93f9ffff3";
const SOURCE_TEXT =
  "When I move to a battlefield, look at the top 3 cards of your Main Deck. You may reveal a unit from among them and draw it. Recycle the rest.\n" +
  "[Deathknell][>] Play a unit from your hand to your base, ignoring its Energy cost. (When I die, get the effect. You must still pay its Power cost.)";

const [moveTrigger, deathknell, deathknellTrigger] = program.abilities;
const [bindController, lookTopThree, mayRevealAndDraw, recycleRest] = moveTrigger.body;
const [revealUnit, drawRevealed] = mayRevealAndDraw.args.body.value;
const [playFromHand] = deathknellTrigger.body;
const [topThreePick] = lookTopThree.picks;
const [revealedPick] = revealUnit.picks;
const [handPick] = playFromHand.picks;

const resultFor = (outcome, id) => outcome.results.find(entry => entry.id === id);

test("unl-179-219 Rift Herald: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-179-219 Rift Herald: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The ordered top-3 look is no longer a gap: the merged zone-slice lifecycle
  // covers it, and the reason now records the three live gaps instead.
  assert.match(program.judgeReason, /trigger\.leave/);
  assert.match(program.judgeReason, /unit 收窄|按 unit/);
  assert.match(program.judgeReason, /356\.1\.b\.2/);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /zoneSlice/);
});

test("unl-179-219 Rift Herald: the top-3 look declares the merged ordered zone slice, not a query", () => {
  // 437.1 / contract 3.6: the card's own ordered source; the finalize lifecycle
  // locks the real deck top and never infers order from query().
  assert.deepEqual(topThreePick, {
    id: "rift-herald.top-three",
    options: [],
    ordered: true,
    selection: "all",
    zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 3 } }
  });
});

test("unl-179-219 Rift Herald: 'When I move to a battlefield' subscribes to object-moved with a battlefield destination", () => {
  // 421.1 / 449.1 / 449.2: a Move is defined by origin and destination; 458
  // excludes Recall. The trigger is scoped to this card with the battlefield\n  // destination recorded on the event pattern.
  assert.equal(moveTrigger.kind, "triggered");
  assert.equal(moveTrigger.trigger.at, "object-moved");
  assert.deepEqual(moveTrigger.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" },
    toZone: "battlefield"
  });
  assert.equal(moveTrigger.optional, false);
});

test("unl-179-219 Rift Herald: look at the top 3, may reveal and draw one, then recycle the rest", () => {
  assert.deepEqual(moveTrigger.body.map(instruction => [instruction.id, instruction.op]), [
    ["rift-herald.bind-controller", "condition.value"],
    ["rift-herald.look-top-three", "effect.inspect"],
    ["rift-herald.may-reveal-and-draw", "choice.optional"],
    ["rift-herald.recycle-rest", "effect.recycle"]
  ]);
  // 437.1/437.3.a private top-3 look; contract 3.6 requires an ordered upstream
  // pick (query order is not deck order) — the placeholder names that intent.
  assert.deepEqual(lookTopThree.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(lookTopThree.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(lookTopThree.args.choose, { kind: "constant", value: false });
  assert.deepEqual(lookTopThree.args.picksSpecId, { kind: "constant", value: "rift-herald.top-three" });
  // "your Main Deck": the viewer is the ability controller (190.6.d), bound from
  // the source snapshot and read back through the linked value.
  assert.deepEqual(bindController.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.deepEqual(lookTopThree.args.player, {
    kind: "linked-value",
    instructionId: "rift-herald.bind-controller",
    key: "controller"
  });
  assert.equal(lookTopThree.linkedTo, "rift-herald.bind-controller");
  // (the ordered source shape itself is asserted in its own test above)

  // Contract 3.9: "You may reveal …" wraps the chosen instructions in body.
  assert.equal(mayRevealAndDraw.op, "choice.optional");
  assert.equal(mayRevealAndDraw.linkedTo, "rift-herald.look-top-three");
  assert.deepEqual(mayRevealAndDraw.args.body.value.map(entry => entry.id), [
    "rift-herald.reveal-unit",
    "rift-herald.draw-revealed"
  ]);

  // 425.1/425.2.a reveal of the chosen card; 414.1 "draw it" = add to hand.
  assert.equal(revealUnit.op, "effect.reveal");
  assert.deepEqual(revealUnit.args.pick, { kind: "constant", value: "rift-herald.revealed-unit" });
  assert.equal(revealedPick.selection, "one");
  assert.deepEqual(revealedPick.filter, { type: "unit" });
  assert.equal(drawRevealed.op, "effect.zone");
  assert.equal(drawRevealed.linkedTo, "rift-herald.reveal-unit");
  assert.deepEqual(drawRevealed.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(drawRevealed.args.amount, { kind: "constant", value: 1 });

  // 417.1/417.1.a: the rest of the looked-at cards go to the bottom of their
  // owner's Main Deck, driven by the linked look result.
  assert.equal(recycleRest.op, "effect.recycle");
  assert.equal(recycleRest.linkedTo, "rift-herald.look-top-three");
  assert.deepEqual(recycleRest.args.objects, {
    kind: "linked-value",
    instructionId: "rift-herald.look-top-three",
    key: "rift-herald.looked"
  });
});

test("unl-179-219 Rift Herald: [Deathknell] plays a unit from hand to base, ignoring only its Energy cost", () => {
  // 808.1.c + 808.1.d: "When I die" effect attached as an object-killed trigger.
  assert.deepEqual(deathknell, { kind: "keyword", keyword: "deathknell" });
  assert.equal(deathknellTrigger.trigger.at, "object-killed");
  assert.deepEqual(deathknellTrigger.trigger.filter, {
    event: "object-killed",
    filter: { source: "self" }
  });
  assert.equal(deathknellTrigger.optional, false);

  // 420.3 / 420.3.b.1 + 355.7/355.10.a example: a unit in your hand is a
  // non-target pick (hand is a private zone).
  assert.equal(playFromHand.op, "effect.play");
  assert.deepEqual(playFromHand.args.pick, { kind: "constant", value: "rift-herald.unit-in-hand" });
  assert.deepEqual(handPick.filter, { zone: "hand", owner: "controller", type: "unit" });
  // 356.1.b.2: only the Energy part is ignored (the card text keeps the printed
  // Power cost); the finalized plan is produced by the cost pipeline, so no
  // printed value is hard-coded here and null is never rewritten to 0.
  assert.deepEqual(playFromHand.args.cost.kind, "constant");
  assert.equal(playFromHand.args.cost.value.energy, 0);
  assert.equal(playFromHand.args.cost.value.ignoreEnergyOfSelectedCard, true);
  assert.deepEqual(playFromHand.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
});

test("unl-179-219 Rift Herald golden: declining the reveal still recycles the looked-at cards", () => {
  // A one-card Main Deck keeps the look well-defined for the reference kernel
  // (the ordered top-3 provisioning is recorded as a todo below).
  const base = world().unit("rift-herald").card("top-card", { owner: "A", zone: "deck" }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("rift-herald") });
  kernel.setPicks(topThreePick.id, [kernel.ref("top-card")]);
  kernel.setAnswers({ "rift-herald.may-reveal-and-draw/optional": false });

  // effect.inspect validates Expr nodes itself, so the body runs through the
  // chain's interpreter adapter (chain/interpreter-adapter.ts), which wraps each
  // registered primitive's arguments the way production does.
  const outcome = resolveChainBody(moveTrigger.body, kernel);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["rift-herald.bind-controller", "executed", undefined],
    ["rift-herald.look-top-three", "executed", undefined],
    ["rift-herald.may-reveal-and-draw", "negated", "skipped"],
    ["rift-herald.recycle-rest", "executed", undefined]
  ]);
  // 417.1.a: the single looked-at card went to the bottom of the Main Deck.
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(outcome.linkedValues["rift-herald.recycle-rest.recycledCount"], 1);
});

test("unl-179-219 Rift Herald golden: 'Recycle the rest' drops references that already left (359.3.e.6)", () => {
  const kernel = world().deck(["first", "second", "third"]).build();
  const looked = kernel.zoneSlice("A", "deck", "top", 3).map(entry => entry.ref);
  // One of the looked-at cards was taken to hand (the reveal/draw half); only the
  // remaining cards are still recyclable.
  kernel.perform({ type: "move-zone", object: looked[0], to: "hand" });
  const run = runInstruction(
    recycle,
    { objects: { kind: "linked-value", instructionId: "rift-herald.look-top-three", key: "rift-herald.looked" } },
    { world: kernel, linked: { "rift-herald.looked": looked } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.recycledCount, 2);
  // "first" went to hand above; only the two remaining looked-at cards recycle.
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second", "third"]);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["first"]);
});

test("unl-179-219 Rift Herald golden: the production chain Finalize locks the real Main Deck top 3 (RIFT-358)", () => {
  // 437.1 / contract 3.6: chain/picks/plan.ts is the sole ordering authority.
  const base = world().deck(["first", "second", "third", "fourth"], { owner: "A" }).build();
  const context = bindResolveContext(base, { source: base.getObject("first"), controller: "A" });
  const plans = finalizeOrderedPickPlans(context, moveTrigger.body);
  assert.equal(plans.length, 1);
  const [plan] = plans;

  // 437.4: exactly the top three of the real Main Deck, in zone order.
  assert.deepEqual(plan.refs.map(ref => ref.id), ["first", "second", "third"]);
  assert.deepEqual(plan.refs, base.zoneSlice("A", "deck", "top", 3).map(entry => entry.ref));
});

test("unl-179-219 Rift Herald golden: declining the reveal after a locked top-3 slice still recycles the looked-at cards", () => {
  const base = world().deck(["first", "second", "third", "fourth"], { owner: "A" }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("first") });
  const context = bindResolveContext(base, { source: base.getObject("first"), controller: "A" });
  const [plan] = finalizeOrderedPickPlans(context, moveTrigger.body);
  kernel.setPicks(plan.id, plan.refs);
  kernel.setAnswers({ "rift-herald.may-reveal-and-draw/optional": false });

  const outcome = resolveChainBody(moveTrigger.body, kernel);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
    ["rift-herald.bind-controller", "executed", undefined],
    ["rift-herald.look-top-three", "executed", undefined],
    ["rift-herald.may-reveal-and-draw", "negated", "skipped"],
    ["rift-herald.recycle-rest", "executed", undefined]
  ]);
  // 417.1.a: all three looked-at cards go to the bottom of the Main Deck, in
  // the locked slice order; the untouched fourth card stays above them.
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["fourth", "first", "second", "third"]);
  assert.equal(outcome.linkedValues["rift-herald.recycle-rest.recycledCount"], 3);
});
test.todo(
  "unl-179-219 Rift Herald: narrow the looked-at set to unit cards for the optional reveal — ObjectFilter type matching is a per-object test, " +
    "PickSpec.filter has no consumer for linked sources (effect.reveal reads the already-provided pick set)"
);
test.todo(
  "unl-179-219 Rift Herald: generate the finalized zero-Energy / printed-Power cost plan for the chosen hand card (356.1.b.2) — " +
    "cost.printed / cost.pay primitives are merged (cost.pay settles an already finalized " +
    "CostPlan), but no producer builds or submits the finalized zero-Energy plan for the chosen hand card"
);
test.todo(
  "unl-179-219 Rift Herald: [Deathknell] KeywordDef expansion and its trigger.leave instruction must be " +
    "registered (effects/instructions/registry.generated.ts has no trigger.leave op) and connected to the " +
    "object-killed chain path (CR 808.1.d.1-.3)"
);
