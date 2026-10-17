import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/pakaa-protector.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-f4d87dfb750f0f23070558bd76ae0fba7b17e9097fe44c0034f1eb55e6bb564e";
const SOURCE_TEXT =
  "When I move, reveal the top card of your Main Deck. If it's a unit, draw it. Otherwise, put it in your trash and give me +2 :rb_might: this turn.";

const [ability] = program.abilities;
const [revealTop, branch] = ability.body;
const [unitMode, otherwiseMode] = branch.args.modes.value;
const [drawIt] = unitMode.body;
const [intoTrash, mightThisTurn] = otherwiseMode.body;

const resultFor = (outcome, id) => outcome.results.find(result => result.id === id);

/**
 * Run each supported branch independently; automatic selection from the revealed
 * type snapshot remains pending. The execution copy only unwraps reveal's pick
 * argument and supplies already locked PickSpecs, keeping every branch effect.
 */
const executableBody = (modeId) => [
  { id: revealTop.id, op: revealTop.op, args: { pick: revealTop.args.pick.value } },
  ...branch.args.modes.value
    .find(mode => mode.id === modeId)
    .body.map(({ picks, ...instruction }) => instruction)
];

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
  assert.match(program.judgeReason, /effect\.reveal/);
  assert.match(program.judgeReason, /zoneSlice|ordered picks/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /LITERAL_FIELDS/);
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

test("ven-033-166 Pakaa Protector: the deck-top reveal is an ordered pick, never a set query", () => {
  // 425.1 / 425.3.a: reveal exposes the top card; contract 3.6 makes the top of a
  // deck an ordered zoneSlice read, so effect.reveal's own contract demands the
  // ordered pick rather than a query (see judgeReason).
  assert.equal(revealTop.id, "pakaa-protector.reveal-top");
  assert.equal(revealTop.op, "effect.reveal");
  assert.deepEqual(revealTop.args.pick, {
    kind: "constant",
    value: "pakaa-protector.top-card"
  });
  assert.equal(revealTop.targets, undefined);
  assert.equal(revealTop.linkedTo, undefined);
  assert.deepEqual(revealTop.picks, [
    {
      id: "pakaa-protector.top-card",
      options: ["dynamic:main-deck-top-one"],
      min: 1,
      max: 1,
      selection: "any",
      filter: { zone: "deck", owner: "controller" }
    }
  ]);
});

test("ven-033-166 Pakaa Protector: the two modes are 'draw it' and 'trash it, then +2 Might this turn'", () => {
  assert.equal(branch.op, "choice.mode");
  assert.equal(branch.linkedTo, "pakaa-protector.reveal-top");
  assert.deepEqual(branch.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(branch.args.different, { kind: "constant", value: true });
  assert.deepEqual(branch.args.modes.value.map(entry => entry.id), [
    "pakaa-protector.unit-mode",
    "pakaa-protector.otherwise-mode"
  ]);

  // "If it's a unit, draw it": 414.1 adds the card to the hand; the deck top is
  // not a public-zone target (355.10.a) and the revealed ref travels as a pick.
  assert.equal(drawIt.op, "effect.zone");
  assert.deepEqual(drawIt.args.to, { kind: "constant", value: "hand" });
  // The pick's min/max (1/1) already fixes the count: no amount argument, which
  // would also be the wrong shape for the primitive's declared move semantics.
  assert.equal(drawIt.args.amount, undefined);
  assert.equal(drawIt.picks[0].min, 1);
  assert.equal(drawIt.picks[0].max, 1);
  assert.equal(drawIt.targets, undefined);
  assert.deepEqual(drawIt.picks[0].options, [
    { kind: "linked-value", instructionId: "pakaa-protector.reveal-top", key: "revealed" }
  ]);

  // "Otherwise, put it in your trash": an effect zone change of that card, not a
  // Burn by count; effect.mill only burns N cards from the deck top (441.1).
  assert.equal(intoTrash.op, "effect.zone");
  assert.deepEqual(intoTrash.args.to, { kind: "constant", value: "trash" });
  assert.deepEqual(intoTrash.picks[0].options, [
    { kind: "linked-value", instructionId: "pakaa-protector.reveal-top", key: "revealed" }
  ]);

  // "and give me +2 Might this turn": a temporary arithmetic-layer Might change
  // (143.2.a), deliberately not a Buff counter (702/703).
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

test("ven-033-166 Pakaa Protector golden: the unit mode moves the revealed card into hand", () => {
  const kernel = world().deck(["top-unit", "second-card"]).build();
  const ordered = kernel.zoneSlice("A", "deck", "top", 1).map(object => object.ref);
  kernel.setPicks("pakaa-protector.top-card", ordered);
  kernel.setPicks("pakaa-protector.revealed-card", ordered);

  const outcome = resolveChainBody(executableBody("pakaa-protector.unit-mode"), kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(resultFor(outcome, "pakaa-protector.reveal-top").result.status, "executed");
  assert.equal(resultFor(outcome, "pakaa-protector.draw-it").result.status, "executed");
  assert.deepEqual(outcome.linkedValues["pakaa-protector.reveal-top.revealed"], ordered);
  assert.equal(kernel.getObject("top-unit").zone, "hand");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-unit"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second-card"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["reveal", "return-to-hand"]);
});

test("ven-033-166 Pakaa Protector golden: the otherwise branch trashes the reveal and gives the host +2 Might this turn", () => {
  const base = world().unit("pakaa", { might: 2 }).unit("other", { might: 3 })
    .deck(["top-spell", "second-card"]).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("pakaa") });
  const ordered = kernel.zoneSlice("A", "deck", "top", 1).map(object => object.ref);
  kernel.setPicks("pakaa-protector.top-card", ordered);
  kernel.setPicks("pakaa-protector.revealed-card", ordered);

  const outcome = resolveChainBody(executableBody("pakaa-protector.otherwise-mode"), kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(resultFor(outcome, "pakaa-protector.into-trash").result.status, "executed");
  assert.equal(resultFor(outcome, mightThisTurn.id).result.status, "executed");
  assert.equal(kernel.getObject("top-spell").zone, "trash");
  assert.deepEqual(kernel.zone("A", "trash").map(ref => ref.id), ["top-spell"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second-card"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["reveal", "move-zone"]);
  assert.equal(kernel.continuousEffects.length, 1);
  assert.deepEqual(outcome.linkedValues[`${mightThisTurn.id}.affected.objects`], [kernel.ref("pakaa")]);
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("pakaa")).might, 4);
  assert.equal(layers.evaluate(kernel.ref("pakaa")).buffs, 0);
  assert.equal(layers.evaluate(kernel.ref("other")).might, 3);
  assert.equal(layers.advance({ id: "turn-end" }).length, 1);
  assert.equal(layers.evaluate(kernel.ref("pakaa")).might, 2);
});

test("ven-033-166 Pakaa Protector golden: a revealed card that already left the deck is dropped by the zone move", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();
  const stale = kernel.ref("top-card");
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setPicks("pakaa-protector.revealed-card", [stale]);

  const outcome = resolveChainBody(executableBody("pakaa-protector.unit-mode"), kernel);

  // 359.3.e.7 / §124: a stale zone entry is not rebound; the pick yields no
  // legal object and the instruction is ignored rather than moving a new object.
  assert.equal(resultFor(outcome, "pakaa-protector.draw-it").result.status, "ignored");
  assert.equal(resultFor(outcome, "pakaa-protector.draw-it").result.reason, "mistargeted");
  assert.equal(kernel.getObject("top-card").zone, "hand");
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
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

test.todo(
  "ven-033-166 Pakaa Protector: produce the locked Main Deck top-card ordered pick (425.1, RIFT-358); " +
    "zoneSlice ordering must reach the card selection path"
);

test.todo(
  "ven-033-166 Pakaa Protector: select the printed branch automatically from the revealed type snapshot " +
    "(contract 3.4 Show Off, RIFT-359); a player-selected choice.mode cannot replace this condition"
);

test.todo(
  "ven-033-166 Pakaa Protector: unwrap effect.reveal's pick Expr in the chain interpreter adapter " +
    "so the original body can consume the ordered pick without a test-boundary argument conversion"
);
