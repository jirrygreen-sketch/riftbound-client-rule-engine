import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/pakaa-protector.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import zone from "../../../../engine-core/dist/effects/instructions/effect.zone.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { finalizeOrderedPickPlans } from "../../../../engine-core/dist/chain/picks/plan.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-f4d87dfb750f0f23070558bd76ae0fba7b17e9097fe44c0034f1eb55e6bb564e";
const SOURCE_TEXT =
  "When I move, reveal the top card of your Main Deck. If it's a unit, draw it. Otherwise, put it in your trash and give me +2 :rb_might: this turn.";

const [ability] = program.abilities;
const [revealTop, branch, unitMode, otherwiseMode] = ability.body;
const [drawIt] = unitMode.args.body.value;
const [intoTrash, mightThisTurn] = otherwiseMode.args.body.value;

const resultFor = (outcome, id) => outcome.results.find(result => result.id === id);

// Execute the same source producer as ChainEngine Finalize; never infer deck order from query.
// This helper only supplies the initial source. The reveal -> trash link is resolved by the adapter.
const resolveBody = kernel => {
  for (const plan of finalizeOrderedPickPlans(kernel, ability.body)) kernel.setPicks(plan.id, plan.refs);
  return resolveChainBody(ability.body, kernel);
};

test("ven-033-166 Pakaa Protector: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-033-166 Pakaa Protector: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Finalize/);
  assert.match(program.judgeReason, /Resolve/);
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /linked PickSpec/);
  assert.match(program.judgeReason, /414\.1\.a/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-033-166 Pakaa Protector: 'When I move' subscribes to object-moved scoped to this card", () => {
  // 421.1 / 449.1 / 449.2 / 458: a Move is a permanent changing locations and a
  // Recall is not a Move; the closed object-moved timing point carries the event.
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);
});

test("ven-033-166 Pakaa Protector: reveal records one Main Deck card without claiming query order is deck order", () => {
  assert.equal(revealTop.id, "pakaa-protector.reveal-top");
  assert.equal(revealTop.op, "effect.reveal");
  assert.deepEqual(revealTop.args, {
    pick: { kind: "constant", value: "pakaa-protector.top-card" }
  });
  assert.deepEqual(revealTop.picks, [{
    id: "pakaa-protector.top-card", options: [], ordered: true, selection: "all",
    zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 1 } }
  }]);
  assert.equal(revealTop.targets, undefined);
  assert.equal(revealTop.linkedTo, undefined);
});

test("ven-033-166 Pakaa Protector: a saved type predicate selects exactly one printed branch", () => {
  assert.deepEqual(ability.body.map(step => step.id), [
    "pakaa-protector.reveal-top", "pakaa-protector.branch",
    "pakaa-protector.unit-mode", "pakaa-protector.otherwise-mode"
  ]);
  assert.equal(branch.op, "condition.predicate");
  assert.equal(branch.linkedTo, revealTop.id);
  assert.deepEqual(branch.args.condition, {
    kind: "constant",
    value: {
      kind: "compare",
      left: { kind: "constant", value: "unit" },
      operator: "in",
      right: {
        kind: "object-property", object: { linked: revealTop.id }, property: "types"
      }
    }
  });
  assert.equal(unitMode.op, "sequence");
  assert.equal(otherwiseMode.op, "sequence");
  assert.equal(unitMode.linkedTo, branch.id);
  assert.equal(otherwiseMode.linkedTo, branch.id);
  assert.deepEqual(unitMode.condition, {
    kind: "expression",
    value: { kind: "linked-value", instructionId: branch.id, key: "value" }
  });
  assert.deepEqual(otherwiseMode.condition, { kind: "not", condition: unitMode.condition });
  assert.deepEqual(unitMode.args.body.value.map(step => step.id), ["pakaa-protector.draw-it"]);
  assert.deepEqual(otherwiseMode.args.body.value.map(step => step.id), [
    "pakaa-protector.into-trash", "pakaa-protector.might-this-turn"
  ]);

  // 414.1/414.1.a: the unchanged top card is drawn, preserving the draw action.
  assert.equal(drawIt.op, "effect.draw");
  assert.deepEqual(drawIt.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawIt.targets, undefined);
  assert.equal(drawIt.picks, undefined);

  assert.equal(intoTrash.op, "effect.zone");
  assert.deepEqual(intoTrash.args.to, { kind: "constant", value: "trash" });
  assert.deepEqual(intoTrash.args.pick, { kind: "constant", value: "pakaa-protector.revealed-card" });
  assert.equal(intoTrash.args.amount, undefined);
  assert.equal(intoTrash.targets, undefined);
  assert.equal(intoTrash.linkedTo, revealTop.id);
  assert.deepEqual(intoTrash.picks, [{
    id: "pakaa-protector.revealed-card",
    options: [], ordered: true, selection: "all",
    linked: { kind: "linked-value", instructionId: revealTop.id, key: "revealed" }
  }]);
  assert.equal(mightThisTurn.op, "continuous.might");
  assert.deepEqual(mightThisTurn.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(mightThisTurn.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(mightThisTurn.args.objects, { kind: "constant", value: { kind: "source" } });
});

test("ven-033-166 Pakaa Protector golden: the merged reveal primitive displays the locked top card and leaves it in the deck", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();
  const ordered = kernel.zoneSlice("A", "deck", "top", 1).map(object => object.ref);
  assert.deepEqual(ordered.map(ref => ref.id), ["top-card"]);

  const run = runInstruction(
    reveal,
    { pick: "pakaa-protector.top-card" },
    { world: kernel, picks: { "pakaa-protector.top-card": ordered } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.revealed, ordered);
  assert.equal(run.linked.revealedCount, 1);
  // 425.1.a.2: the revealed card stays in its zone with the deck order intact.
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top-card", "second-card"]);
  assert.deepEqual(run.events.map(event => event.action), ["reveal"]);
});

test("ven-033-166 Pakaa Protector golden: the original body automatically draws a revealed unit", () => {
  // A one-card deck follows the same ordered binding as a longer deck.
  const base = world().unit("pakaa", { might: 4 })
    .deck(["top-unit"], { types: ["unit"] }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("pakaa") });
  const revealed = kernel.ref("top-unit");
  const outcome = resolveBody(kernel);

  assert.equal(outcome.status, "partial");
  assert.equal(resultFor(outcome, revealTop.id).result.status, "executed");
  assert.equal(resultFor(outcome, drawIt.id).result.status, "executed");
  assert.deepEqual(resultFor(outcome, otherwiseMode.id).result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(outcome.linkedValues[`${branch.id}.value`], true);
  assert.deepEqual(outcome.linkedValues[`${revealTop.id}.revealed`], [revealed]);
  assert.equal(outcome.linkedValues[`${unitMode.id}/${drawIt.id}.drawn`], 1);
  assert.equal(kernel.getObject("top-unit").zone, "hand");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-unit"]);
  assert.deepEqual(kernel.zone("A", "deck"), []);
  assert.deepEqual(outcome.events.map(event => event.action), ["reveal", "draw"]);
  assert.deepEqual(kernel.continuousEffects, []);
  assert.equal(kernel.getObject("pakaa").might, 4);
});

test("ven-033-166 Pakaa Protector golden: the original otherwise branch trashes the reveal and grants +2 Might", () => {
  const base = world().unit("pakaa", { might: 2 }).unit("other", { might: 3 })
    .deck(["top-spell"], { types: ["spell"] }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("pakaa") });
  const outcome = resolveBody(kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(resultFor(outcome, unitMode.id).result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(outcome.linkedValues[`${branch.id}.value`], false);
  assert.equal(resultFor(outcome, intoTrash.id).result.status, "executed");
  assert.equal(resultFor(outcome, mightThisTurn.id).result.status, "executed");
  assert.equal(kernel.getObject("top-spell").zone, "trash");
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["top-spell"]);
  assert.deepEqual(kernel.zone("A", "deck"), []);
  assert.deepEqual(kernel.zone("A", "hand"), []);
  assert.deepEqual(outcome.events.map(event => event.action), ["reveal", "move-zone"]);
  assert.equal(kernel.continuousEffects.length, 1);
  assert.deepEqual(outcome.linkedValues[`${otherwiseMode.id}/${mightThisTurn.id}.affected.objects`], [kernel.ref("pakaa")]);
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("pakaa")).might, 4);
  assert.equal(layers.evaluate(kernel.ref("pakaa")).buffs, 0);
  assert.equal(layers.evaluate(kernel.ref("other")).might, 3);
  assert.equal(layers.advance({ id: "turn-end" }).length, 1);
  assert.equal(layers.evaluate(kernel.ref("pakaa")).might, 2);
});

test("ven-033-166 Pakaa Protector golden: an empty reveal ignores both branches without granting Might", () => {
  const kernel = world().unit("pakaa", { might: 4 }).build();
  const outcome = resolveBody(kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(resultFor(outcome, revealTop.id).result.status, "negated");
  assert.deepEqual(resultFor(outcome, branch.id).result, { status: "ignored", reason: "mistargeted" });
  for (const step of [unitMode, otherwiseMode]) {
    assert.deepEqual(resultFor(outcome, step.id).result, { status: "ignored", reason: "linked-ignored" });
  }
  assert.deepEqual(outcome.events, []);
  assert.deepEqual(kernel.continuousEffects, []);
  assert.deepEqual(kernel.zone("A", "hand"), []);
});

test("ven-033-166 Pakaa Protector golden: the supported draw and trash effects preserve a second deck card", () => {
  for (const isUnit of [true, false]) {
    const kernel = world().deck(["top-card", "second-card"], { types: [isUnit ? "unit" : "spell"] }).build();
    const ordered = kernel.zoneSlice("A", "deck", "top", 1).map(object => object.ref);
    const revealed = runInstruction(reveal, { pick: "ordered-top" }, {
      world: kernel, picks: { "ordered-top": ordered }
    });
    assert.equal(revealed.result.status, "executed");
    assert.deepEqual(revealed.linked.revealed, ordered);
    const moved = isUnit
      ? runInstruction(draw, drawIt.args, { world: kernel })
      : runInstruction(zone, { pick: "pakaa-protector.revealed-card", to: intoTrash.args.to }, {
          world: kernel, picks: { "pakaa-protector.revealed-card": revealed.linked.revealed }
        });
    assert.equal(moved.result.status, "executed");
    assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second-card"]);
    assert.equal(kernel.getObject("top-card").zone, isUnit ? "hand" : "trash");
    assert.deepEqual(kernel.events.map(event => event.action), ["reveal", isUnit ? "draw" : "move-zone"]);
  }
});

test("ven-033-166 Pakaa Protector golden: a revealed card that already left the deck is dropped by the zone move", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();
  const stale = kernel.ref("top-card");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  const outcome = runInstruction(zone, { pick: "pakaa-protector.revealed-card", to: intoTrash.args.to }, {
    world: kernel, picks: { "pakaa-protector.revealed-card": [stale] }
  });
  assert.deepEqual(outcome.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("top-card").zone, "hand");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second-card"]);
});

test("ven-033-166 Pakaa Protector golden: a real move emission matches only the bound host", () => {
  const { kernel, host } = fixture();
  const pattern = translateTriggerFilter(ability.trigger.filter, "source", ability.trigger.at);
  assert.deepEqual(pattern, { event: "object-moved", object: { objectId: "source" } });
  const moved = host.execute({
    type: "move-location", object: kernel.ref("source"),
    to: { type: "battlefield", id: "bf-1" }
  });
  assert.equal(moved.outcome.status, "done");
  const emission = moved.emissions.find(event => event.timingPoint === "object-moved");
  assert.ok(emission);
  assert.equal(emission.object.ref.id, "source");
  assert.deepEqual(emission.object.location, { type: "battlefield", id: "bf-1" });
  assert.equal(matchesTriggerEvent(pattern, emission, "A"), true);
  const other = host.execute({
    type: "move-location", object: kernel.ref("enemy"),
    to: { type: "battlefield", id: "bf-2" }
  });
  assert.equal(other.outcome.status, "done");
  const otherEmission = other.emissions.find(event => event.timingPoint === "object-moved");
  assert.ok(otherEmission);
  assert.equal(matchesTriggerEvent(pattern, otherEmission, "A"), false);
});

test("ven-033-166 Pakaa Protector golden: the original body resolves automatic ordered and linked picks through the ChainEngine", () => {
  for (const isUnit of [true, false]) {
    const initial = world().unit("pakaa", { cardId: CANONICAL_ID, might: 4,
      location: { type: "base", player: "A" } })
      .deck(["top-card", "second-card"], { types: [isUnit ? "unit" : "spell"] }).build();
    const kernel = initial.clone({ sourceSnapshot: initial.getObject("pakaa") });
    const host = createActionPipelineHost({
      checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
      restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
      objects: () => kernel.objects, perform: action => kernel.perform(action),
      choose: request => { throw new AwaitChoice(request); },
      context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
    });
    const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
      cleanup: chain => {
        chain.layers.setObjects(kernel.objects);
        const lethal = chain.layers.evaluateAll().filter(object => object.zone === "board" &&
          object.types.includes("unit") && object.might !== null && (object.might <= 0 || object.damage >= object.might));
        for (const object of lethal) chain.commit({ type: "kill", object: object.ref });
        return lethal.length > 0;
      }
    });
    const f = { engine, kernel };
    const deckBefore = f.kernel.zoneSlice("A", "deck", "top").map(object => object.ref.id);
    const source = f.kernel.getObject("pakaa");
    const top = f.kernel.ref("top-card");
    // The move event's matcher is covered separately; its production registration remains blocked.
    // Here the original body runs on the actual chain with the real card as source.
    f.engine.execute({ id: "pakaa-body", source, controller: "A", kind: "activated", speed: "reaction", body: ability.body });
    assert.deepEqual(f.engine.items[0].pickPlans[0].refs, [top]);
    assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "card-revealed"), false);
    resolveAll(f.engine);
    assert.equal(f.kernel.getObject("top-card").zone, isUnit ? "hand" : "trash");
    assert.deepEqual(f.kernel.zoneSlice("A", "deck", "top").map(object => object.ref.id), deckBefore.slice(1));
    assert.deepEqual(f.kernel.linked(`${revealTop.id}.revealed`), [top]);
    assert.equal(f.kernel.linked(`${branch.id}.value`), isUnit);
    assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "card-revealed").length, 1);
    assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 0);
    f.engine.layers.setObjects(f.kernel.objects);
    assert.equal(f.engine.layers.evaluate(source.ref).might, isUnit ? 4 : 6);
    assert.equal(f.engine.layers.evaluate(source.ref).buffs, 0);
    if (!isUnit) {
      assert.equal(f.engine.layers.advance({ id: "turn-end" }).length, 1);
      assert.equal(f.engine.layers.evaluate(source.ref).might, 4);
    }
  }
});

test.todo(
  "ven-033-166 Pakaa Protector: read the current top card at Resolve, after an intervening response " +
    "changes deck order; Finalize zoneSlice currently locks the earlier top (425.1 / 414.1.a / 359.3)"
);

test.todo(
  "ven-033-166 Pakaa Protector: register the source-scoped object-moved event pattern; " +
    "events/trigger-spec.ts EVENT_PATTERN_TYPES does not admit the producer's event name (383.1 / 421.1)"
);
