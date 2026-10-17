import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/rakelstake.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { fixture as chainFixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL =
  "card.hash-1b896afb48233f602257054e1545c35265f320f21b47acd9ff53e914226707f7";
const SOURCE_TEXT =
  "For each player, the first time they play a unit or gear here each turn, they [Predict]. " +
  "(They look at the top card of their Main Deck. They may recycle it.)";

const [ability] = program.abilities;
const [look, recycle] = ability.body;

// effect.inspect issues its select request with a default choice id derived from
// viewer/owner/zone; the interpreter prefixes it with the execution path.
const SELECT_ID = "rakelstake.predict/effect.inspect%3Aselect%3AA%3AA%3Adeck";

test("rad-165-167 Rakelstake: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("rad-165-167 Rakelstake: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /event-player/);
  assert.match(program.judgeReason, /per-player/);
  assert.match(program.judgeReason, /destination|地点|here/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-165-167 Rakelstake: per-turn play trigger for units and gear played here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  // 359/407: playing a card is the event; 053.3 marks the destination, and
  // 383.1.b records the printed "the first time ... each turn" frequency.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    here: true,
    object: { type: ["unit", "gear"] }
  });
  assert.equal(ability.trigger.once, "per-turn");

  // The trigger is the judged part: no event-player selector, no per-player
  // frequency and no play-location payload exist in the frozen IR.
  assert.match(program.judgeReason, /TriggerSpec\.once/);
});

test("rad-165-167 Rakelstake: normal trigger binding drops here before strict validation", () => {
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const registry = new ProgramRegistry([lifted]);
  const source = world()
    .card("rakelstake", {
      cardId: CANONICAL,
      types: ["battlefield"],
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build()
    .getObject("rakelstake");
  const [registration] = triggerRegistrations(registry, source);

  assert.deepEqual(registration.spec.filter, {
    event: "card-played",
    object: { type: ["unit", "gear"] }
  });
  assert.equal(validateTriggerSpec(registration.spec).ok, true);
  // The adapter has registered a valid-looking filter, but the destination
  // Battlefield restriction was discarded during translation.
  assert.equal("here" in registration.spec.filter, false);
});

test("rad-165-167 Rakelstake: Predict is inspect-top-one-then-optionally-recycle", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "rakelstake.predict",
    "rakelstake.recycle"
  ]);

  // 437.1/437.3.a: look at the top card of the Main Deck, choose 0..1 to recycle.
  assert.equal(look.op, "effect.inspect");
  assert.deepEqual(look.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(look.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(look.args.choose, { kind: "constant", value: true });
  assert.deepEqual(look.args.chooseCount, {
    kind: "constant",
    value: { min: 0, max: 1 }
  });
  // "they": the frozen IR has no event-player selector, so the constant is a
  // documented placeholder, not a fabricated seat.
  assert.deepEqual(look.args.player, { kind: "constant", value: "event-player" });
  assert.equal(look.linkedTo, undefined);

  // 417.1.b/417.4: recycle follows the look and consumes its linked result.
  assert.equal(recycle.op, "effect.recycle");
  assert.deepEqual(recycle.args.objects, {
    kind: "linked",
    instructionId: "rakelstake.predict",
    key: "rakelstake-recycle"
  });
  assert.equal(recycle.linkedTo, "rakelstake.predict");
});

test("rad-165-167 Rakelstake: the as-printed body cannot execute (event-player placeholder)", () => {
  const kernel = world().deck(["top", "rest"]).build();

  const outcome = resolveChainBody(ability.body, kernel);

  // The look is negated because "event-player" is not a resolvable viewer; the
  // deck is untouched, so nothing is silently approximated.
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top", "rest"]);
  assert.equal(kernel.events.length, 0);
});

/** Supplying only the missing bindings the judgeReason names: viewer + ordered top picks. */
function predictBodyFor(player) {
  return [
    {
      ...look,
      args: {
        ...look.args,
        player: { kind: "constant", value: player },
        picksSpecId: { kind: "constant", value: "rakelstake-top" }
      }
    },
    recycle
  ];
}

test("rad-165-167 Rakelstake: Predict executes once the viewer is bound (choose to recycle)", () => {
  const kernel = world().deck(["top", "rest"]).build();
  const top = kernel.ref("top");
  kernel.setPicks("rakelstake-top", [top]);
  kernel.setAnswers({ [SELECT_ID]: [top] });

  const outcome = resolveChainBody(predictBodyFor("A"), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["rakelstake.predict", "executed"],
    ["rakelstake.recycle", "executed"]
  ]);
  // 437.1: exactly one card was seen; 417.1.b: the chosen card went to the bottom.
  assert.equal(kernel.getObject("top").zone, "deck");
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["rest", "top"]);
  assert.equal(kernel.events.map(event => event.action).join(","), "look,recycle");
});

test("rad-165-167 Rakelstake: declining to recycle keeps the predicted card on top", () => {
  const kernel = world().deck(["top", "rest"]).build();
  const top = kernel.ref("top");
  kernel.setPicks("rakelstake-top", [top]);
  kernel.setAnswers({ [SELECT_ID]: [] });

  const outcome = resolveChainBody(predictBodyFor("A"), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top", "rest"]);
  // Nothing was recycled, so the only committed game action is the look
  // (417.4: recycling zero cards is a successful no-op, not an event).
  assert.deepEqual(kernel.events.map(event => event.action), ["look"]);
  assert.equal(kernel.getObject("top").zone, "deck");
});

test("rad-165-167 Rakelstake: an empty Main Deck predicts nothing without Burn Out (437.4)", () => {
  const kernel = world().build();
  kernel.setPicks("rakelstake-top", []);
  kernel.setAnswers({ [SELECT_ID]: [] });

  const outcome = resolveChainBody(predictBodyFor("A"), kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").deckSize, 0);
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "rad-165-167 Rakelstake: bind 'they' to the player who played the card (event-player selector, " +
    "contract change request) and gate the trigger to that player's first unit-or-gear play at this " +
    "Battlefield each turn (per-player once frequency + play-location payload) — the frozen " +
    "TriggerSpec.once scopes are keyed to one source, and no payload names the play's destination"
);

test("rad-165-167 Rakelstake: the card-played payload carries no play destination", () => {
  // CR 359 / 407 / 053.3: the closed card-played emission (chain/engine.ts
  // resolve()) supplies object + player only, so no filter or condition can name
  // "played here". Combined with the per-source frequency key, the printed
  // "first time they play a unit or gear here each turn" cannot be scoped.
  const fixture = chainFixture();
  const events = [];
  fixture.engine.pipeline.onEvent = event => events.push(event);
  fixture.engine.pipeline.emit({
    timingPoint: "card-played",
    object: fixture.kernel.getObject("source"),
    player: "B"
  });
  const [event] = events;
  assert.equal(event.timingPoint, "card-played");
  assert.equal(event.player, "B");
  // Neither the emission nor the recorded event exposes a destination/location.
  assert.equal("location" in event, false);
  assert.equal(event.details, undefined);
  assert.equal(event.object.ref.id, "source");
});

test("rad-165-167 Rakelstake: the per-turn frequency key is scoped to one registration+source", () => {
  // events/pipeline.ts frequencyKey() keys TriggerSpec.once by registration.id +
  // source ref + clock phase; the scan/consume step has no per-event-player
  // component, so the printed "the first time each player plays" cannot be
  // expressed — a single registration covers the whole turn, not one chance per
  // player. The two committed hits below are exactly that defect: the second
  // player also reaches the trigger, and only the later consume() would clamp.
  const fixture = chainFixture();
  const source = fixture.kernel.getObject("source");
  fixture.engine.pipeline.registerTrigger({
    id: "rakelstake-once",
    source,
    controller: "A",
    spec: { at: "card-played", filter: {}, once: "per-turn" },
    body: [{ id: "noop", op: "condition.value", args: { value: { kind: "constant", value: 1 } } }],
    optional: false,
    activeZones: ["board", "chain"]
  });

  const hits = [];
  fixture.engine.pipeline.onTrigger = trigger => hits.push(trigger.controller);
  for (const player of ["A", "B"]) {
    fixture.engine.pipeline.emit({ timingPoint: "card-played", object: source, player });
  }
  // The frequency key has no player component, so both plays produce the same
  // hit set and only one shared per-turn slot exists.
  assert.deepEqual(hits, ["A", "A"]);
});

