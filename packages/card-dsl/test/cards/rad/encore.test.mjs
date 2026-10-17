import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/encore.js";
// The production chain adapter wraps the card DSL's Expr arguments for the
// registered primitive schemas (chain/interpreter-adapter.ts), so the golden
// execution goes through the same path the chain engine uses.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const [play] = program.abilities;
const [chooseTwo] = play.body;
const modes = chooseTwo.args.modes.value;
const [
  damageMode,
  tokenMode,
  mightMode,
  lookMode
] = modes;

const MODE_CHOICE = "encore.choose-two";
// Choice request ids are the URI-encoded execution path (interpreter README).
const slot = (index) => `${MODE_CHOICE}/mode%3A${index}`;
const DAMAGED_UNIT = "encore.damaged-unit";

/**
 * Replay helper: the spell's Finalize-locked target (355.8) is supplied by the
 * kernel, then the card's own body executes with the mode answers supplied.
 */
const runWithAnswers = (kernel, answers) => {
  kernel.setTargets(DAMAGED_UNIT, [kernel.ref("victim")]);
  kernel.setAnswers(answers);
  return resolveChainBody(play.body, kernel);
};

test("rad-152-167 Encore: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(
    program.canonicalCardId,
    "card.hash-3812004b1ace905a5750f12683fd2ae066128769b8d39d3a460ea8a2bce04b99"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "Choose two —\n" +
      "Deal 2 to a unit.Play two 1 :rb_might: Recruit unit tokens." +
      "Give up to two units each +1 :rb_might: this turn." +
      "Look at the top 2 cards of your Main Deck, draw 1 and recycle the other."
  );
});

test("rad-152-167 Encore: judgeReason records mode Finalize, location and ordered picks", () => {
  assert.match(program.judgeReason, /355\.3/);
  assert.match(program.judgeReason, /地点选择纳入模式的 Finalize/);
  assert.match(program.judgeReason, /模式内 zoneSlice 绑定/);
  assert.match(program.judgeReason, /LocationSelector\.choose\.filter/);
  assert.match(program.judgeReason, /condition\.value/);
  assert.match(program.judgeReason, /linked-value/);
  assert.doesNotMatch(program.judgeReason, /动态枚举.*选项数组/);
  assert.doesNotMatch(program.judgeReason, /需已解析 LocationRef/);
});

test("rad-152-167 Encore: structure — Choose two with four modes in printed order", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map(instruction => instruction.id), ["encore.choose-two"]);

  // "Choose two —" (355.3): one mode node, two distinct selections, bodies
  // executing in declaration order (contract 3.9).
  assert.equal(chooseTwo.op, "choice.mode");
  assert.deepEqual(chooseTwo.args.count, { kind: "constant", value: 2 });
  assert.deepEqual(chooseTwo.args.different, { kind: "constant", value: true });
  assert.equal(chooseTwo.args.modes.kind, "constant");
  assert.deepEqual(modes.map(mode => mode.id), [
    "encore.deal-two-mode",
    "encore.recruit-tokens-mode",
    "encore.grant-might-mode",
    "encore.look-and-recycle-mode"
  ]);
  for (const mode of modes) assert.equal(Array.isArray(mode.body), true);

  // Mode 1: "Deal 2 to a unit" — a target, one unit, merged effect.damage.
  const [dealTwo] = damageMode.body;
  assert.equal(dealTwo.op, "effect.damage");
  assert.deepEqual(dealTwo.args.amount, { kind: "constant", value: 2 });
  assert.equal(dealTwo.targets.length, 1);
  assert.equal(dealTwo.targets[0].id, "encore.damaged-unit");
  assert.deepEqual(dealTwo.targets[0].filter, { type: "unit" });
  assert.equal(dealTwo.targets[0].min, 1);
  assert.equal(dealTwo.targets[0].max, 1);
  assert.equal(dealTwo.targets[0].selection, "one");

  // Mode 2: "Play two 1 Might Recruit unit tokens" — CR 187.1 Recruit. The
  // destination is selected through the merged location selector and then
  // passed to effect.token through a linked value.
  const [chooseRecruitLocation, recruits] = tokenMode.body;
  assert.equal(chooseRecruitLocation.op, "condition.value");
  assert.deepEqual(chooseRecruitLocation.args.value, {
    kind: "location",
    value: {
      kind: "choose",
      id: "encore.recruit-location",
      filter: { type: "any", controller: "controller" }
    }
  });
  assert.deepEqual(chooseRecruitLocation.args.key, { kind: "constant", value: "location" });
  assert.equal(recruits.op, "effect.token");
  assert.equal(recruits.linkedTo, "encore.choose-recruit-location");
  assert.deepEqual(recruits.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(recruits.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(recruits.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(recruits.args.location, {
    kind: "linked-value",
    instructionId: "encore.choose-recruit-location",
    key: "location"
  });

  // Mode 3: "Give up to two units each +1 Might this turn" — zero allowed
  // (355.13), end-of-turn expiry (317.2.c), arithmetic-layer continuous.might
  // reading the Finalize-locked TargetSpec through the symbolic target selector.
  const [grantMight] = mightMode.body;
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(grantMight.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "encore.buffed-units" }
  });
  assert.equal(grantMight.targets.length, 1);
  assert.equal(grantMight.targets[0].id, "encore.buffed-units");
  assert.equal(grantMight.targets[0].min, 0);
  assert.equal(grantMight.targets[0].max, 2);
  assert.equal(grantMight.targets[0].selection, "up-to");

  // Mode 4: look at the top 2, draw 1, recycle the other.
  assert.deepEqual(lookMode.body.map(instruction => instruction.id), [
    "encore.look-controller",
    "encore.look-top-two",
    "encore.draw-one",
    "encore.recycle-other"
  ]);
  const [bindViewer, look] = lookMode.body;
  assert.equal(bindViewer.op, "condition.value");
  assert.deepEqual(bindViewer.args.value, { kind: "object-property", object: "source", property: "controller" });
  assert.deepEqual(bindViewer.args.key, { kind: "constant", value: "controller" });
  assert.equal(look.op, "effect.inspect");
  assert.deepEqual(look.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 2 });
  assert.equal(look.picks.length, 1);
  assert.equal(look.picks[0].id, "encore.top-two");
  assert.deepEqual(look.args.player, { kind: "linked-value", instructionId: "encore.look-controller", key: "controller" });
  assert.deepEqual(look.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(look.picks[0], {
    id: "encore.top-two", options: [], ordered: true, selection: "all",
    zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 2 } }
  });
  const [drawOne, recycleOther] = lookMode.body.slice(2);
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args.amount, { kind: "constant", value: 1 });
  assert.equal(recycleOther.op, "effect.recycle");
  assert.equal(recycleOther.linkedTo, "encore.look-top-two");
  assert.deepEqual(recycleOther.args.objects, {
    kind: "linked-value", instructionId: "encore.look-top-two", key: "inspected-picked"
  });
  for (const [instruction, minimum] of [[drawOne, 1], [recycleOther, 2]]) {
    assert.deepEqual(instruction.condition, {
      kind: "compare",
      left: { kind: "linked-value", instructionId: "encore.look-top-two", key: "inspected" },
      operator: "gte", right: { kind: "constant", value: minimum }
    });
  }
});

test("rad-152-167 Encore: the original Choose two body executes damage and Might modes in printed order", () => {
  for (const selected of [[damageMode, mightMode], [mightMode, damageMode]]) {
    const kernel = world().unit("victim", { owner: "B", might: 4 }).unit("ally", { might: 3 }).build();
    kernel.setTargets("encore.buffed-units", [kernel.ref("ally")]);
    const outcome = runWithAnswers(kernel, { [slot(0)]: selected[0].id, [slot(1)]: selected[1].id });
    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
      ["encore.deal-two", "executed"], ["encore.grant-might", "executed"], ["encore.choose-two", "executed"]
    ]);
    assert.equal(kernel.getObject("victim").damage, 2);
    const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
    assert.equal(layers.evaluate(kernel.ref("ally")).might, 4);
    layers.expireAt("turn-end", "A");
    assert.equal(layers.evaluate(kernel.ref("ally")).might, 3);
  }
});

function controlledBattlefieldWorld() {
  const builder = world();
  const kernel = builder.build();
  const battlefield = { type: "battlefield", id: "encore-controlled-battlefield" };
  // Location state is represented by a battlefield object with no location;
  // the occupant supplies the concrete battlefield ref that the selector
  // enumerates.
  kernel.addObject({
    ref: { id: "encore-controlled-battlefield", zoneEntryId: 1 },
    owner: "A",
    controller: "A",
    types: ["battlefield"],
    zone: "board",
    location: null
  });
  builder.unit("encore-battlefield-anchor", { location: battlefield });
  return { kernel, battlefield };
}

function assertRecruitModePlayed(kernel, destination) {
  kernel.setAnswers({ "encore.choose-recruit-location/encore.recruit-location": destination });
  const outcome = resolveChainBody(tokenMode.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["encore.choose-recruit-location", "executed"],
    ["encore.recruit-tokens", "executed"]
  ]);
  const recruits = kernel.objects.filter(object => object.isToken);
  assert.equal(recruits.length, 2);
  for (const recruit of recruits) {
    assert.equal(recruit.name, "Recruit");
    assert.equal(recruit.might, 1);
    assert.equal(recruit.energy, null);
    assert.equal(recruit.power, null);
    assert.deepEqual(recruit.location, destination);
  }
  assert.deepEqual(kernel.events.map(event => event.action), [
    "create-token", "play", "create-token", "play"
  ]);
  assert.deepEqual(kernel.pendingItems, []);
}

test("rad-152-167 Encore: Recruit mode selects the controller's Base through condition.value", () => {
  const kernel = world().build();
  assertRecruitModePlayed(kernel, { type: "base", player: "A" });
});

test("rad-152-167 Encore: Recruit mode selects a controlled Battlefield through the location filter", () => {
  const { kernel, battlefield } = controlledBattlefieldWorld();
  assertRecruitModePlayed(kernel, battlefield);
});

test("rad-152-167 Encore: the +1 Might mode registers an end-of-turn arithmetic effect for the chosen units", () => {
  const kernel = world().unit("u1", { might: 3 }).unit("u2", { might: 3 }).unit("u3", { might: 3 }).build();
  kernel.setTargets("encore.buffed-units", [kernel.ref("u1"), kernel.ref("u2")]);

  const outcome = resolveChainBody(mightMode.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [["encore.grant-might", "executed"]]
  );
  // CR 143.2.a / 475-478: the merged layers engine really applies the +1 in the
  // arithmetic layer, and the effect carries the printed end-of-turn duration
  // (317.2.c). The third unit was not chosen and keeps its printed Might.
  const engine = createLayerEngine(
    kernel.query({}),
    kernel.snapshot().continuous.map(entry => ({ effect: entry.effect, duration: entry.duration }))
  );
  assert.deepEqual(
    engine.evaluateAll().map(object => [object.ref.id, object.might]),
    [["u1", 4], ["u2", 4], ["u3", 3]]
  );
  assert.deepEqual(kernel.snapshot().continuous.map(entry => entry.duration), [
    { type: "end-of-turn" },
    { type: "end-of-turn" }
  ]);
});

test("rad-152-167 Encore: choosing zero units is a legal no-op for the Might mode (CR 355.13)", () => {
  const kernel = world().unit("u1", { might: 3 }).build();
  kernel.setTargets("encore.buffed-units", []);

  const outcome = resolveChainBody(mightMode.body, kernel);

  // "up to two" allows choosing none: the locked set is empty, so the merged
  // primitive reports the selection as mistargeted (the same zero-selection
  // convention the merged effect.damage/bilgewater-tracker path uses), and no
  // continuous effect may be registered.
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.snapshot().continuous.length, 0);
  assert.equal(kernel.getObject("u1").might, 3);
});

test("rad-152-167 Encore: a unit that left the board before resolution cancels only the Might mode", () => {
  const kernel = world().unit("u1", { might: 3 }).build();
  const stale = kernel.ref("u1");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  kernel.setTargets("encore.buffed-units", [stale]);

  const outcome = resolveChainBody(mightMode.body, kernel);

  // 359.3.e.6: every target ref is stale, so the instruction is ignored and no
  // effect is registered.
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.snapshot().continuous.length, 0);
});

test.todo("Encore: choose modes during Finalize and bind only the selected modes' targets (CR 355.3)");
test("Encore: the original look mode locks ordered top two, draws the top card and recycles only the other", () => {
  const f = fixture();
  // Give the deck a real order different from set-query insertion order.
  const order = ["A:deck:3", "A:deck:1", "A:deck:4", "A:deck:2"];
  assert.equal(f.engine.commit({ type: "order-top", player: "A", objects: order.map(id => f.kernel.ref(id)) }).status, "done");
  f.engine.advance();
  const inspected = order.slice(0, 2).map(id => f.kernel.ref(id));
  // Execute only this original mode body through the real chain. Full-card
  // mode selection at Finalize remains pending above; no program status changes.
  f.engine.execute(f.draft("encore-look-mode", { body: lookMode.body }));
  assert.deepEqual(f.engine.items[0].pickPlans, [{ id: "encore.top-two", refs: inspected }]);
  assert.equal(f.kernel.events.some(event => event.action === "look"), false);
  resolveAll(f.engine);
  assert.deepEqual(f.kernel.linked("encore.look-top-two.inspected-picked"), inspected);
  assert.equal(f.kernel.linked("encore.look-top-two.inspected"), 2);
  assert.equal(f.kernel.linked("encore.draw-one.drawn"), 1);
  assert.deepEqual(f.kernel.linked("encore.recycle-other.recycled"), [inspected[1]]);
  assert.equal(f.kernel.getObject(order[0]).zone, "hand");
  assert.equal(f.kernel.object(inspected[0]), null, "the drawn incarnation is never recycled from hand");
  assert.deepEqual(f.kernel.zoneSlice("A", "deck", "top").map(object => object.ref.id), [order[2], order[3], order[1]]);
  assert.deepEqual(f.kernel.events.map(event => event.action), ["order-top", "look", "draw", "recycle"]);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "became-target"), false);
});

test("Encore: a short looked-at set draws as much as possible without recycling an uninspected card or burning out", () => {
  for (const size of [0, 1]) {
    const f = fixture();
    assert.equal(f.engine.commit({ type: "mill", player: "A", amount: 4 - size }).status, "done");
    f.engine.advance();
    const before = f.kernel.zoneSlice("A", "deck", "top").map(object => object.ref);
    const trash = f.kernel.zoneSlice("A", "trash", "top").map(object => object.ref);
    f.engine.execute(f.draft(`encore-short-${size}`, { body: lookMode.body }));
    assert.deepEqual(f.engine.items[0].pickPlans, [{ id: "encore.top-two", refs: before }]);
    resolveAll(f.engine);
    assert.equal(f.kernel.linked("encore.look-top-two.inspected"), size);
    assert.deepEqual(f.kernel.linked("encore.look-top-two.inspected-picked"), before);
    assert.equal(f.kernel.player("A").handSize, size);
    assert.deepEqual(f.kernel.zoneSlice("A", "deck", "top"), []);
    assert.deepEqual(f.kernel.zoneSlice("A", "trash", "top").map(object => object.ref), trash);
    assert.equal(f.kernel.events.some(event => event.action === "recycle"), false);
    assert.equal(f.kernel.events.filter(event => event.action === "draw").length, size);
    assert.equal(f.kernel.player("A").score, 0);
    assert.equal(f.kernel.player("B").score, 0);
  }
});
