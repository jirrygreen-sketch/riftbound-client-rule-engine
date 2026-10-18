import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/scryers-bloom.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", ENGINE));
const { finalizeOrderedPickPlans } = await import(new URL("chain/picks/plan.js", ENGINE));
const { buildCostPlan } = await import(new URL("cost/cost-plan.js", ENGINE));
const { payCostPlan } = await import(new URL("cost/payment.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));
const { bindReplacement } = await import(new URL("replacement/index.js", ENGINE));
const { EventPipeline } = await import(new URL("events/pipeline.js", ENGINE));
const { createActionPipelineHost, bindResolveContext } = await import(new URL("events/action-adapter.js", ENGINE));

const CANONICAL_ID =
  "card.hash-12391b1b0c8fa259528e28974f6a47bd51892b5b66931b7c3529759298d8deb7";
const SOURCE_TEXT =
  "This enters exhausted.\n" +
  "Kill this, :rb_energy_1:, :rb_exhaust:: [Predict 2], then draw 1. Gain 1 XP.  " +
  "(To Predict 2, look at the top two cards of your Main Deck. Recycle any of them and put the rest back in any order.)";

const [replacement, activated] = program.abilities;
const [enterExhausted] = replacement.with;
const [viewer, look, recycle, putBack, draw, gainXp] = activated.body;

// effect.inspect issues its select request with the choiceId the card declares;
// the interpreter prefixes it with the execution path.
const SELECT_ID = "scryers-bloom.predict-look/scryers-bloom.predict";
/** effect.order 的排序请求 id（原语固定形状：effect.order:<destination>:<player>）。 */
const PUT_BACK_ORDER_ID = "scryers-bloom.predict-put-back/effect.order%3Atop%3AA";

test("unl-136-219 Scryer's Bloom: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-136-219 Scryer's Bloom: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  // RIFT-358 landed the ordered zone-slice lifecycle: the remaining cited gap
  // ("programs/ 与 chain/ 没有从真实牌库 zoneSlice 自动提供这组 top-2 picks 的路径")
  // is closed, so the program is executable and carries no judgeReason.
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-136-219 Scryer's Bloom: 'This enters exhausted' is an entry-state rewrite, not an exhaust action", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(replacement.kind, "replacement");
  // 149.1 / 359.2.d: non-unit Gear enters ready; the printed text rewrites it.
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  assert.equal(replacement.condition, undefined);
  assert.equal(replacement.with.length, 1);
  assert.equal(enterExhausted.id, "scryers-bloom.enter-exhausted");
  assert.equal(enterExhausted.op, "replacement.enter");
  assert.deepEqual(enterExhausted.args.state, { kind: "constant", value: "exhausted" });
  assert.deepEqual(enterExhausted.args.zone, { kind: "constant", value: "board" });
});

test("unl-136-219 Scryer's Bloom: the activation cost is Kill this, 1 Energy, and the exhaust symbol", () => {
  assert.equal(activated.kind, "activated");
  // 151 / 151.2: Gear activated abilities default to action speed.
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost.energy, { kind: "constant", value: 1 });
  // 357.2 lets non-standard costs be paid in any order; only exhaust-then-kill can
  // complete, because killing the source first invalidates the exhaust payment
  // (415.4 requires the exhaust cost to be completable).
  assert.deepEqual(activated.cost.payments, [{ kind: "exhaust" }, { kind: "kill" }]);
});

test("unl-136-219 Scryer's Bloom: Predict 2 orders only the inspected cards that were not recycled", () => {
  assert.deepEqual(activated.body.map(instruction => instruction.id), [
    "scryers-bloom.viewer",
    "scryers-bloom.predict-look",
    "scryers-bloom.predict-recycle",
    "scryers-bloom.predict-put-back",
    "scryers-bloom.draw",
    "scryers-bloom.gain-xp"
  ]);

  // 437.1 / 437.1.a: look at the top 2 and choose any of them to recycle.
  assert.equal(look.op, "effect.inspect");
  assert.equal(look.args.scope.value, "top");
  assert.deepEqual(look.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(look.args.choose, { kind: "constant", value: true });
  assert.deepEqual(look.args.chooseCount, { kind: "constant", value: { min: 0, max: 2 } });
  // 190.6.d: bind the controller through the interpreter before inspect's Expr schema.
  assert.equal(viewer.op, "condition.value");
  assert.deepEqual(viewer.args.value, {
    kind: "object-property", object: "source", property: "controller"
  });
  assert.deepEqual(look.args.player, {
    kind: "linked-value", instructionId: viewer.id, key: "value"
  });
  // 437.1.a / contract 3.6: the ordered top-2 source is the card's own explicit
  // zone slice, locked by the merged chain Finalize (RIFT-358).
  assert.deepEqual(look.args.picksSpecId, {
    kind: "constant",
    value: "scryers-bloom.predict-top-2"
  });
  const [topTwoPick] = look.picks;
  assert.deepEqual(topTwoPick, {
    id: "scryers-bloom.predict-top-2",
    options: [],
    ordered: true,
    selection: "all",
    zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 2 } }
  });
  assert.equal(look.linkedTo, undefined);

  // 417.1.b / 417.4: recycle the chosen cards; choosing none is a successful no-op.
  assert.equal(recycle.op, "effect.recycle");
  assert.deepEqual(recycle.args.objects, {
    kind: "linked",
    instructionId: "scryers-bloom.predict-look",
    key: "predict-recycle"
  });
  assert.equal(recycle.linkedTo, "scryers-bloom.predict-look");

  // 437.1.a: put the rest back on top in any order; the count is computed, not
  // hard-coded (actually inspected - actually recycled).
  assert.equal(putBack.op, "effect.order");
  assert.equal(putBack.linkedTo, "scryers-bloom.predict-recycle");
  assert.deepEqual(putBack.args.destination, { kind: "constant", value: "top" });
  assert.deepEqual(putBack.args.count, {
    kind: "arithmetic",
    operator: "sub",
    operands: [
      { kind: "linked-value", instructionId: "scryers-bloom.predict-look", key: "inspected" },
      {
        kind: "linked-value",
        instructionId: "scryers-bloom.predict-recycle",
        key: "recycledCount"
      }
    ]
  });
  assert.deepEqual(putBack.args.chooseOrder, { kind: "constant", value: true });

  // 414.3 / 730.1: "then draw 1" and "Gain 1 XP" are independent sentences.
  assert.equal(draw.op, "effect.draw");
  assert.deepEqual(draw.args.amount, { kind: "constant", value: 1 });
  assert.equal(draw.linkedTo, undefined);
  assert.equal(gainXp.op, "effect.xp");
  assert.deepEqual(gainXp.args.amount, { kind: "constant", value: 1 });
  assert.equal(gainXp.linkedTo, undefined);
});

test("unl-136-219 Scryer's Bloom golden: the printed cost is payable through the merged cost pipeline", () => {
  const kernel = world()
    .player("A", { energy: 1 })
    .unit("scryers-bloom", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      controller: "A",
      owner: "A",
      exhausted: false
    })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("scryers-bloom") });
  const plan = buildCostPlan(context, { id: "scryers-bloom:predict", cost: activated.cost });
  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.total.power, []);
  assert.deepEqual(plan.total.actions.map(cost => cost.action.type), ["exhaust", "kill"]);

  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.equal(context.player("A").energy, 0);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust", "kill"]);
  // 429: the cost kills the source. Its pre-kill reference is a stale Board
  // identity (the card's Trash identity carries a new zoneEntryId), and the
  // source snapshot stays the last known Board information (359.3.e.13).
  assert.equal(context.object(context.source.ref), null);
  assert.equal(context.lastKnown(context.source.ref).zone, "board");
  assert.equal(context.getObject("scryers-bloom").zone, "trash");
});

function bloomWorld(cards, owner = "A") {
  const base = world()
    .player(owner, { energy: 1 })
    .unit("scryers-bloom", { types: ["gear"], cardId: CANONICAL_ID, owner, controller: owner })
    .deck(cards, { owner })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("scryers-bloom"), controller: owner });
}

test("unl-136-219 Scryer's Bloom golden: Predict 2 runs the merged inspect/recycle/order with ordered top picks", () => {
  const kernel = bloomWorld(["top", "second", "third"]);
  const top = kernel.ref("top");
  kernel.setPicks("scryers-bloom.predict-top-2", [top, kernel.ref("second")]);
  // 437.1.a: "Recycle any of them" — here the player recycles exactly the top card.
  kernel.setAnswers({ [SELECT_ID]: [top], [PUT_BACK_ORDER_ID]: [kernel.ref("second")] });

  const body = activated.body.slice(0, 4);
  const outcome = resolveChainBody(body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["scryers-bloom.viewer", "executed"],
    ["scryers-bloom.predict-look", "executed"],
    ["scryers-bloom.predict-recycle", "executed"],
    ["scryers-bloom.predict-put-back", "executed"]
  ]);
  // 437.1.a: two cards were looked at; 417.1.b: the chosen one went to the bottom;
  // the remaining card was put back on top (417.5.a / effect.order).
  assert.deepEqual(kernel.events.map(event => event.action), ["look", "recycle", "order-top"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second", "third", "top"]);
  assert.equal(outcome.linkedValues["scryers-bloom.predict-look.inspected"], 2);
  assert.equal(outcome.linkedValues["scryers-bloom.predict-recycle.recycledCount"], 1);
});

test("unl-136-219 Scryer's Bloom golden: declining to recycle keeps both predicted cards, then draws 1 and gains 1 XP", () => {
  const kernel = bloomWorld(["top", "second", "third", "fourth"]);
  kernel.setPicks("scryers-bloom.predict-top-2", [kernel.ref("top"), kernel.ref("second")]);
  kernel.setAnswers({
    [SELECT_ID]: [],
    [PUT_BACK_ORDER_ID]: [kernel.ref("top"), kernel.ref("second")]
  });

  const outcome = resolveChainBody(activated.body, kernel);

  assert.equal(outcome.status, "executed");
  // 437.1.a: nothing was recycled, so both predicted cards were put back on top
  // in the chosen order; "then draw 1" then takes the topmost one (414.1) and
  // "Gain 1 XP" is an independent sentence (414.3 / 730.1).
  assert.equal(kernel.getObject("top").zone, "hand");
  assert.equal(kernel.getObject("second").zone, "deck");
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second", "third", "fourth"]);
  assert.equal(kernel.player("A").deckSize, 3);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").xp, 1);
  assert.deepEqual(kernel.events.map(event => event.action), ["look", "order-top", "draw", "gain-xp"]);
});

test("unl-136-219 Scryer's Bloom golden: a one-card Main Deck predicts as much as possible and still draws and gains XP (437.4)", () => {
  const kernel = bloomWorld(["only-card"]);
  kernel.setPicks("scryers-bloom.predict-top-2", [kernel.ref("only-card")]);
  kernel.setAnswers({
    [SELECT_ID]: [],
    [PUT_BACK_ORDER_ID]: [kernel.ref("only-card")]
  });

  const outcome = resolveChainBody(activated.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").deckSize, 0);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").xp, 1);
});

test("unl-136-219 Scryer's Bloom golden: the original body keeps controller B after its source dies as a cost", () => {
  const kernel = bloomWorld(["b-top", "b-second", "b-third"], "B");
  const top = kernel.ref("b-top");
  const second = kernel.ref("b-second");
  kernel.setPicks("scryers-bloom.predict-top-2", [top, second]);
  kernel.setAnswers({
    [SELECT_ID]: [top],
    "scryers-bloom.predict-put-back/effect.order%3Atop%3AB": [second]
  });
  const receipt = payCostPlan(kernel, buildCostPlan(kernel, { id: "bloom:activate", cost: activated.cost }));
  assert.equal(receipt.paid, true);
  assert.equal(kernel.getObject("scryers-bloom").zone, "trash");
  const outcome = resolveChainBody(activated.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["scryers-bloom.viewer.value"], "B");
  assert.equal(outcome.linkedValues["scryers-bloom.predict-look.inspected"], 2);
  assert.equal(kernel.getObject("b-second").zone, "hand");
  assert.deepEqual(kernel.zone("B", "deck").map(ref => ref.id), ["b-third", "b-top"]);
  assert.equal(kernel.player("B").xp, 1);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").xp, 0);
});

test("unl-136-219 Scryer's Bloom golden: the card's replacement enters exhausted through the event pipeline (149.1/359.2.d)", () => {
  const kernel = world().hand("scryers-bloom", { types: ["gear"], exhausted: false }).build();
  const context = (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint });
  const host = createActionPipelineHost({
    checkpoint: () => kernel.snapshot(),
    restore: state => kernel.restore(state),
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context
  });
  const pipeline = new EventPipeline(host, ["A", "B"], "A");
  bindReplacement(replacement, kernel.ref("scryers-bloom"), {
    host: { object: ref => kernel.object(ref), objects: () => kernel.objects, context },
    pipeline
  });
  assert.equal(pipeline.commit({ type: "move-zone", object: kernel.ref("scryers-bloom"), to: "chain" }).status, "done");
  const result = pipeline.commit({
    type: "move-zone", object: kernel.ref("scryers-bloom"), to: "base", location: { type: "base", player: "A" }
  });
  assert.equal(result.status, "replaced");
  assert.equal(kernel.getObject("scryers-bloom").zone, "board");
  assert.equal(kernel.getObject("scryers-bloom").exhausted, true);
  const entry = pipeline.events.find(event => event.timingPoint === "object-enters-board");
  assert.equal(entry.object.exhausted, true);
  assert.equal(pipeline.events.some(event => event.timingPoint === "object-exhausted"), false);
});

test("unl-136-219 Scryer's Bloom golden: recycling the only inspected card leaves no cards to order (437.4)", () => {
  const kernel = bloomWorld(["only-card"]);
  const only = kernel.ref("only-card");
  kernel.setPicks("scryers-bloom.predict-top-2", [only]);
  kernel.setAnswers({ [SELECT_ID]: [only] });
  const outcome = resolveChainBody(activated.body.slice(0, 4), kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["scryers-bloom.predict-look.inspected"], 1);
  assert.equal(outcome.linkedValues["scryers-bloom.predict-recycle.recycledCount"], 1);
  assert.equal(outcome.linkedValues["scryers-bloom.predict-put-back.ordered"], 0);
  assert.deepEqual(kernel.events.map(event => event.action), ["look", "recycle"]);
});

test("unl-136-219 Scryer's Bloom golden: the production chain Finalize locks the real Main Deck top 2 for Predict (RIFT-358)", () => {
  // 437.1.a / contract 3.6: chain/picks/plan.ts is the sole ordering authority.
  // The card's own zoneSlice declaration is locked against the real Main Deck,
  // not an unordered query and not a hand-provided pick set.
  const kernel = bloomWorld(["top", "second", "third"]);
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("scryers-bloom"),
    controller: "A"
  });
  const plans = finalizeOrderedPickPlans(context, activated.body);

  assert.equal(plans.length, 1);
  const [plan] = plans;
  assert.equal(plan.id, "scryers-bloom.predict-top-2");
  // The locked slice is the real top two of the Main Deck, in zone order.
  assert.deepEqual(plan.refs.map(ref => ref.id), ["top", "second"]);
  assert.deepEqual(plan.refs, kernel.zoneSlice("A", "deck", "top", 2).map(entry => entry.ref));

  // The locked references are what Resolve reads back through ctx.picks: run
  // the whole printed body against them and assert the real zone churn.
  kernel.setPicks(plan.id, plan.refs);
  kernel.setAnswers({ [SELECT_ID]: [plan.refs[0]], [PUT_BACK_ORDER_ID]: [plan.refs[1]] });
  const outcome = resolveChainBody(activated.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["scryers-bloom.predict-look.inspected"], 2);
  assert.equal(outcome.linkedValues["scryers-bloom.predict-recycle.recycledCount"], 1);
  assert.deepEqual(kernel.events.map(event => event.action), ["look", "recycle", "order-top", "draw", "gain-xp"]);
  // The recycled card went to the bottom of its owner's Main Deck (417.1.a /
  // 417.1.b); the other looked-at card was put back on top (437.1.a) and then
  // drawn by the independent "then draw 1" sentence (414.3).
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["third", "top"]);
  assert.equal(kernel.getObject("second").zone, "hand");
  assert.equal(kernel.player("A").xp, 1);
});

test("unl-136-219 Scryer's Bloom golden: a short Main Deck locks the available slice and Predict does as much as possible (437.4)", () => {
  const kernel = bloomWorld(["only-card"]);
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("scryers-bloom"),
    controller: "A"
  });
  const [plan] = finalizeOrderedPickPlans(context, activated.body);

  // 437.4.a: an undersized deck does not Burn Out; the slice holds what exists.
  assert.deepEqual(plan.refs.map(ref => ref.id), ["only-card"]);
  kernel.setPicks(plan.id, plan.refs);
  kernel.setAnswers({ [SELECT_ID]: [], [PUT_BACK_ORDER_ID]: plan.refs });
  const outcome = resolveChainBody(activated.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["scryers-bloom.predict-look.inspected"], 1);
  assert.deepEqual(kernel.events.map(event => event.action), ["look", "order-top", "draw", "gain-xp"]);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").xp, 1);
});

test("unl-136-219 Scryer's Bloom golden: an empty Main Deck locks an empty slice without Burn Out", () => {
  const kernel = bloomWorld([]);
  const context = bindResolveContext(kernel, {
    source: kernel.getObject("scryers-bloom"),
    controller: "A"
  });
  const [plan] = finalizeOrderedPickPlans(context, activated.body);

  assert.deepEqual(plan.refs, []);
  kernel.setPicks(plan.id, plan.refs);
  const outcome = resolveChainBody(activated.body, kernel);

  assert.equal(outcome.status, "executed");
  // 437.4 / 432.1.c: nothing was looked at, nothing was recycled or ordered;
  // "then draw 1" is still attempted (the reference kernel records the draw
  // action and draws 0 of the requested 1 card) and "Gain 1 XP" remains an
  // independent sentence (414.3 / 730.1).
  assert.equal(outcome.linkedValues["scryers-bloom.predict-look.inspected"], 0);
  assert.equal(outcome.linkedValues["scryers-bloom.predict-recycle.recycledCount"], 0);
  assert.equal(outcome.linkedValues["scryers-bloom.draw.drawn"], 0);
  assert.deepEqual(kernel.events.map(event => event.action), ["draw", "gain-xp"]);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").xp, 1);
});
