import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/forgotten-relic.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import millDefinition from "../../../../engine-core/dist/effects/instructions/effect.mill.js";

const CARD_ID = "card.hash-15ff48d601dbbf88a4e20335d5fed2db90642596b505780338ee6d79f6623847";
const SOURCE_TEXT =
  "When you play this or at the start of your Beginning Phase, [Burn 1]. " +
  "When you burn a unit this way, do this: Give a friendly unit +:rb_might: equal to the burned card's Might this turn. " +
  "(To Burn 1, put the top card of your Main Deck into your trash.)";

const [onPlay, atBeginning] = program.abilities;
const [onPlayBurn, onPlayReflexive] = onPlay.body;
const [atBeginningBurn, atBeginningReflexive] = atBeginning.body;

const deckIds = (kernel) => kernel.zoneSlice("A", "deck", "top").map((object) => object.ref.id);
const trashIds = (kernel) => kernel.zoneSlice("A", "trash", "top").map((object) => object.ref.id);

test("ven-108-166 Forgotten Relic: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-108-166 Forgotten Relic: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // The reason names the two real gaps: the reflexive trigger and the result binding.
  assert.match(program.judgeReason, /trigger\.reflexive/);
  assert.match(program.judgeReason, /condition\.result/);
  assert.match(program.judgeReason, /388\.1/);
  assert.match(program.judgeReason, /355\.5\.b/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ven-108-166 Forgotten Relic: two trigger sources (card-played and beginning-start), each a Burn 1", () => {
  assert.equal(program.abilities.length, 2);

  // 383.4.a: "When you play this" is a Play Effect on this card.
  assert.equal(onPlay.kind, "triggered");
  assert.equal(onPlay.optional, false);
  assert.deepEqual(onPlay.trigger, {
    at: "card-played",
    filter: { event: "card-played", filter: { source: "self" } }
  });

  // 315.2.a.1 / 190.6.d: "at the start of your Beginning Phase" is the controller's.
  assert.equal(atBeginning.kind, "triggered");
  assert.equal(atBeginning.optional, false);
  assert.deepEqual(atBeginning.trigger, {
    at: "beginning-start",
    filter: { event: "beginning-start", player: "self" }
  });

  // 441.2/441.4: "[Burn 1]" is the mill action, one card, as many as possible.
  for (const [instruction, id] of [
    [onPlayBurn, "forgotten-relic.burn-on-play"],
    [atBeginningBurn, "forgotten-relic.burn-at-beginning"]
  ]) {
    assert.equal(instruction.id, id);
    assert.equal(instruction.op, "effect.mill");
    assert.deepEqual(instruction.args, { amount: { kind: "constant", value: 1 } });
    assert.equal(instruction.targets, undefined);
    assert.equal(instruction.picks, undefined);
    assert.equal(instruction.linkedTo, undefined);
  }
});

test("ven-108-166 Forgotten Relic: the 'do this' clause is recorded as a reflexive trigger, not a plain follow-up", () => {
  // 388.1 / 389.1 / 355.5.b: "do this:" creates a new Pending Item whose choices are
  // made when the reflexive item finalizes. No merged opcode implements it, so the
  // shape is recorded verbatim and stays non-executable (see judgeReason).
  for (const [reflexive, burnId, bodyId] of [
    [onPlayReflexive, "forgotten-relic.burn-on-play", "forgotten-relic.reflexive-on-play"],
    [atBeginningReflexive, "forgotten-relic.burn-at-beginning", "forgotten-relic.reflexive-at-beginning"]
  ]) {
    assert.equal(reflexive.id, bodyId);
    assert.equal(reflexive.op, "trigger.reflexive");
    // The burn event is observed after the burn happened (441.1.a).
    assert.deepEqual(reflexive.args.at, { kind: "constant", value: "card-burned" });
    // "a unit" + "this way": only the unit actually burned by THAT instruction.
    assert.deepEqual(reflexive.args.filter, {
      kind: "constant",
      value: { event: "card-burned", type: "unit" }
    });
    // "this way" reads the burn receipt of the instruction it belongs to (441.1.a).
    assert.deepEqual(reflexive.args.burned, {
      kind: "linked-value",
      instructionId: burnId,
      key: "burnedCard"
    });
    assert.deepEqual(reflexive.args.link, {
      kind: "constant",
      value: "forgotten-relic.burned-card"
    });
    // The clause cannot be flattened into the burn instruction's own body: every
    // target of a reflexive item is chosen when it finalizes (355.5.b).
    assert.equal(reflexive.linkedTo, undefined);
    assert.equal(reflexive.targets, undefined);

    const [give] = reflexive.args.body.value;
    assert.equal(give.id, "forgotten-relic.give-might");
    // The Might modification is a layers effect (317.2.c expiry), not a Buff (CR 702).
    assert.equal(give.op, "continuous.might");
    assert.deepEqual(give.args.amount, {
      kind: "object-property",
      object: { linked: "forgotten-relic.burned-card" },
      property: "might"
    });
    assert.deepEqual(give.args.duration, { kind: "constant", value: "end-of-turn" });
    assert.deepEqual(give.args.objects, {
      kind: "constant", value: { kind: "target", id: "forgotten-relic.friendly-unit" }
    });
    // The friendly unit is chosen when the reflexive item finalizes (355.5.b).
    assert.deepEqual(give.targets, [{
      id: "forgotten-relic.friendly-unit",
      filter: { type: "unit", controller: "self", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }]);
  }
});

test("ven-108-166 Forgotten Relic golden: the declared Burn 1 really moves the Main Deck top card to the trash", () => {
  const kernel = world().deck(["top", "second", "third"]).build();

  const outcome = resolveChainBody([onPlayBurn], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["forgotten-relic.burn-on-play", "executed"]
  ]);
  // 441.1: the top card only, in top-to-bottom order.
  assert.deepEqual(trashIds(kernel), ["top"]);
  assert.deepEqual(deckIds(kernel), ["second", "third"]);
  assert.deepEqual(kernel.events.map((event) => event.action), ["mill"]);
  // The receipt names the burned card, which is what "the burned card" reads
  // (441.1.a / 359.3.e.13); the Might value itself is a layer lookup, not here.
  assert.equal(outcome.results[0].result.linkedValues.burnedCount, 1);
  assert.deepEqual(outcome.results[0].result.linkedValues.burned.map((ref) => ref.id), ["top"]);
  assert.deepEqual(outcome.results[0].result.linkedValues.burnedCard, { id: "top", zoneEntryId: 1 });
});

test("ven-108-166 Forgotten Relic golden: a short Main Deck burns as many as possible (441.4)", () => {
  const kernel = world().deck(["only-card"]).build();

  const outcome = resolveChainBody([atBeginningBurn], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.burnedCount, 1);
  assert.deepEqual(trashIds(kernel), ["only-card"]);
  assert.deepEqual(deckIds(kernel), []);
});

test("ven-108-166 Forgotten Relic golden: an empty Main Deck burns nothing and never fabricates a Might value", () => {
  const kernel = world().build();

  const outcome = resolveChainBody([onPlayBurn], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.burnedCount, 0);
  assert.equal(outcome.results[0].result.linkedValues.burnedCard, null);
  // Nothing actually moved (441.4 burns as many as possible, here zero); the
  // receipt reports 0 and null instead of fabricating a card or a Might value.
  assert.deepEqual(trashIds(kernel), []);
  assert.deepEqual(deckIds(kernel), []);
});

test("ven-108-166 Forgotten Relic golden: a replaced burn negates the instruction and leaves the deck intact", () => {
  const kernel = world().deck(["top", "second"]).build();
  kernel.addReplacement((action) => action.type === "mill" ? "prevented" : null);

  const outcome = resolveChainBody([onPlayBurn], kernel);

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(trashIds(kernel), []);
  assert.deepEqual(deckIds(kernel), ["top", "second"]);
});

test("ven-108-166 Forgotten Relic: Burn produces a zone-bound reference and an empty Burn links null", () => {
  // This proves mill produces the reference needed by the reflexive body;
  // it does not prove cross-chain binding or the later Might grant.
  const kernel = world().deck(["unit-card", "spell-card"]).build();
  const burn = runInstruction(millDefinition, { amount: { kind: "constant", value: 1 } }, { world: kernel });
  assert.equal(burn.result.status, "executed");
  // The receipt names the burned card (the referent "the burned card" reads).
  assert.deepEqual(burn.linked.burnedCard, { id: "unit-card", zoneEntryId: 1 });
  assert.deepEqual(burn.linked.burnedCount, 1);
  // 124: the burned card is a new object in the trash; the receipt keeps the
  // zone-bound identity so the layers read goes through last-known information
  // (359.3.e.13) instead of rebinding by id.
  assert.deepEqual(burn.linked.burned, [{ id: "unit-card", zoneEntryId: 1 }]);
  assert.equal(kernel.getObject("unit-card").zone, "trash");
  // A fresh Burn 1 over an empty Main Deck links null, never 0.
  const empty = world().build();
  const none = runInstruction(millDefinition, { amount: { kind: "constant", value: 1 } }, { world: empty });
  assert.equal(none.linked.burnedCard, null);
});

test.todo(
  "ven-108-166 Forgotten Relic: \"When you burn a unit this way, do this:\" is a Reflexive Trigger (CR 388.1/388.2/389.1/389.2, " +
    "355.5.b) that creates a new Pending Item with its own selection — neither contract 3.1's ability forms nor the merged " +
    "instruction registry can create one (the survey names trigger.reflexive), and nested targets are blocked by " +
    "chain/engine.ts assertFinalizationSurface"
);
test.todo(
  "ven-108-166 Forgotten Relic: the \"a unit\" / \"this way\" gate and the burned-card binding need the result-condition " +
    "and cross-chain binding (survey condition.result) so the reflexive body reads the burn performed by " +
    "the specific instruction (CR 441.1.a)"
);
