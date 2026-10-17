import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/stacked-deck.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// Production resolves a card body through the chain's interpreter adapter
// (chain/interpreter-adapter.ts) and Finalize locks its ordered picks through
// chain/picks/plan.ts; the goldens below use the real ChainEngine, so the
// zone-slice lifecycle is exercised exactly as a played spell exercises it.
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-de0d686bb2019a7d9b9b5212d1e6b414c0f1c1a69c9903fedc7471b860b86045";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Look at the top 3 cards of your Main Deck. Put 1 into your hand and " +
  "recycle the rest.";

const deckAbility = program.abilities.find((ability) => ability.kind === "play");
const [bindInstruction, lookInstruction, putInstruction, recycleInstruction] = deckAbility.body;
const [viewedPick] = lookInstruction.picks;
const [keptPick] = putInstruction.picks;

/** A played Stacked Deck plus the card-program binding, over the reference kernel. */
function stackedDeckFixture() {
  const state = fixture({
    cards: [{ id: "stacked-deck", cardId: CARD_ID, types: ["spell"], energy: 1 }],
    turnPlayer: "A"
  });
  // Make the physical zone order differ from query/creation order so a set
  // query could never reproduce the locked slice by accident.
  state.engine.commit({
    type: "order-top",
    player: "A",
    objects: ["A:deck:3", "A:deck:1", "A:deck:4", "A:deck:2"].map((id) => state.kernel.ref(id))
  });
  state.engine.advance();
  const binding = createProgramBinding({ cardPrograms: [program] });
  const draft = binding.describePlay(
    { type: "play", object: state.kernel.ref("stacked-deck"), player: "A" },
    state.kernel.getObject("stacked-deck")
  );
  return { ...state, binding, draft };
}

/** Execute the card's own draft and let Finalize lock the ordered top three. */
function executeStackedDeck(state) {
  state.engine.execute(state.draft);
  const [plan] = state.engine.items[0].pickPlans;
  return plan.refs.map((ref) => ref.id);
}

/** Resolve the keep-one choice privately, then finish the chain. */
function keepOne(state, keptIndex) {
  let request;
  state.engine.pass("A");
  assert.throws(() => state.engine.pass("B"), (error) => {
    if (!(error instanceof AwaitChoice)) return false;
    request = error.request;
    return true;
  });
  const kept = request.options[keptIndex];
  state.answers.set(request.id, [kept]);
  resolveAll(state.engine);
  // The spell's own resolved actions are the tail of the kernel's action log
  // (the fixture's setup ordering, payment and play steps come first).
  const actions = state.kernel.events.map((event) => event.action);
  const lookAt = actions.lastIndexOf("look");
  state.events = lookAt < 0 ? [] : actions.slice(lookAt);
  return { request, kept };
}

test("ogn-183-298 Stacked Deck: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-183-298 Stacked Deck: identity, ruleset, executable status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogn-183-298 Stacked Deck structure: look-top-3, put 1 into hand, recycle the rest", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "action" });

  assert.equal(deckAbility.kind, "play");
  assert.deepEqual(deckAbility.body.map((instruction) => [instruction.id, instruction.op]), [
    ["stacked-deck.bind-controller", "condition.value"],
    ["stacked-deck.look", "effect.inspect"],
    ["stacked-deck.put-into-hand", "effect.zone"],
    ["stacked-deck.recycle-rest", "effect.recycle"]
  ]);

  // "your Main Deck" is the caster's deck: the controller is bound once and
  // read back by the look instruction.
  assert.deepEqual(bindInstruction.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.deepEqual(bindInstruction.args.key, { kind: "constant", value: "controller" });
  assert.equal(bindInstruction.linkedTo, undefined);

  // "Put 1 into your hand" is the resolution-time private choice (355.18):
  // exactly one card, chooser-only, over the ordered top-3.
  assert.deepEqual(lookInstruction.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(lookInstruction.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(lookInstruction.args.choose, { kind: "constant", value: true });
  assert.deepEqual(lookInstruction.args.chooseCount, {
    kind: "constant",
    value: { min: 1, max: 1 }
  });
  assert.deepEqual(lookInstruction.args.player, {
    kind: "linked-value",
    instructionId: "stacked-deck.bind-controller",
    key: "controller"
  });
  assert.equal(lookInstruction.linkedTo, "stacked-deck.bind-controller");
  // The linked result keys the old goldens read (viewedCount / viewed / kept).
  assert.deepEqual(lookInstruction.args.linkedKey, { kind: "constant", value: "viewedCount" });
  assert.deepEqual(lookInstruction.args.pickedKey, { kind: "constant", value: "viewed" });
  assert.deepEqual(lookInstruction.args.choosePicksKey, { kind: "constant", value: "kept" });
  assert.deepEqual(lookInstruction.args.picksSpecId, {
    kind: "constant",
    value: "stacked-deck.viewed"
  });

  // The ordered deck-top source is a real Finalize binding, never a set query.
  assert.deepEqual(viewedPick, {
    id: "stacked-deck.viewed",
    options: [],
    ordered: true,
    selection: "all",
    zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 3 } }
  });

  // "Put 1 into your hand": the follow-up consumes the actual look answer.
  assert.equal(putInstruction.linkedTo, "stacked-deck.look");
  assert.deepEqual(putInstruction.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(putInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(keptPick, {
    id: "stacked-deck.kept-card",
    options: [],
    ordered: true,
    selection: "all",
    linked: {
      kind: "linked-value",
      instructionId: "stacked-deck.look",
      key: "kept"
    }
  });

  // "and recycle the rest": the same looked-at list, minus what left for Hand.
  assert.equal(recycleInstruction.linkedTo, "stacked-deck.look");
  assert.deepEqual(recycleInstruction.args.objects, {
    kind: "linked-value",
    instructionId: "stacked-deck.look",
    key: "viewed"
  });
  assert.equal(recycleInstruction.targets, undefined);
});

test("ogn-183-298 Stacked Deck golden: Finalize locks the real deck top 3 in zone order", () => {
  const state = stackedDeckFixture();
  const physical = state.kernel.zoneSlice("A", "deck", "top").map((object) => object.ref.id);
  assert.deepEqual(physical, ["A:deck:3", "A:deck:1", "A:deck:4", "A:deck:2"]);
  // A set query reports creation order; the locked slice must not follow it.
  assert.notDeepEqual(
    state.kernel.query({ owner: "A", zone: "deck" }).map((object) => object.ref.id),
    physical.slice(0, 3)
  );
  assert.equal(state.draft.speed, "action");

  assert.deepEqual(executeStackedDeck(state), physical.slice(0, 3));
  // Locking references performs no look/reveal and no targeting.
  assert.equal(
    state.engine.pipeline.events.filter((event) =>
      ["cards-looked-at", "became-target"].includes(event.timingPoint)).length,
    0
  );
});

test("ogn-183-298 Stacked Deck golden: the kept card goes to hand and the other two recycle to the bottom", () => {
  for (const [keptIndex, keptId] of [[0, "A:deck:3"], [1, "A:deck:1"], [2, "A:deck:4"]]) {
    const state = stackedDeckFixture();
    const topThree = executeStackedDeck(state);
    // Collect the resolved action order plus the linked counters before the
    // look's writes are gone from the fixture's event log.
    const { request, kept } = keepOne(state, keptIndex);
    state.events = state.events ?? [];

    // The choice is private, chooser-only and limited to the looked-at cards.
    assert.equal(request.visibility, "chooser-only");
    assert.equal(request.chooser, "A");
    assert.deepEqual(request.options.map((ref) => ref.id), topThree);
    assert.deepEqual([request.min, request.max], [1, 1]);
    assert.equal(kept.id, keptId);

    assert.deepEqual(state.kernel.zone("A", "hand").map((ref) => ref.id), [keptId]);
    // The untouched fourth card stays on top of the recycled pair (417.1.a);
    // 417.5 randomizes the recycled cards' mutual order, which the card does
    // not control, so only the set is asserted.
    const deck = state.kernel.zoneSlice("A", "deck", "top").map((object) => object.ref.id);
    assert.equal(deck[0], "A:deck:2");
    assert.deepEqual(
      [...deck.slice(1)].sort(),
      topThree.filter((id) => id !== keptId).sort()
    );

    // The chain really performed look -> move-to-hand -> two recycles (the
    // trailing move-zone is the spell itself leaving the Chain afterwards).
    assert.deepEqual(
      state.events.slice(0, 4),
      ["look", "return-to-hand", "recycle", "recycle"]
    );
  }
});

test("ogn-183-298 Stacked Deck golden: the looked-at cards are really viewed before the keep choice", () => {
  const state = stackedDeckFixture();
  const topThree = executeStackedDeck(state);
  keepOne(state, 1);
  // Look left every card in place (128.3-128.4); only the kept one moved.
  const hand = state.kernel.zone("A", "hand").map((ref) => ref.id);
  for (const id of topThree) {
    if (hand.includes(id)) continue;
    assert.equal(state.kernel.getObject(id).zone, "deck");
  }
  assert.equal(hand.length, 1);
});

test("ogn-183-298 Stacked Deck golden: a short Main Deck is looked at as far as available", () => {
  const state = stackedDeckFixture();
  // Only two cards remain in the Main Deck (441.4-style short zone).
  for (const id of ["A:deck:3", "A:deck:4"]) {
    state.engine.commit({ type: "move-zone", object: state.kernel.ref(id), to: "hand" });
  }
  // Committing actions requests cleanup; return to an idle, actionable state.
  state.engine.advance();
  const available = state.kernel.zoneSlice("A", "deck", "top").map((object) => object.ref.id);
  assert.equal(available.length, 2);

  assert.deepEqual(executeStackedDeck(state), available);
  const { request, kept } = keepOne(state, 0);
  assert.deepEqual(request.options.map((ref) => ref.id), available);
  assert.deepEqual(
    state.kernel.zoneSlice("A", "deck", "top").map((object) => object.ref.id),
    available.filter((id) => id !== kept.id)
  );
});

test("ogn-183-298 Stacked Deck: without a locked ordered source nothing is looked at or guessed", () => {
  // The interpreter alone must not reconstruct deck order from a set query:
  // with no Finalize-locked pick plan the top scope blocks and the follow-up
  // instructions find no looked-at cards.
  const state = stackedDeckFixture();
  const outcome = resolveChainBody(
    deckAbility.body,
    state.kernel.clone({ sourceSnapshot: state.kernel.getObject("stacked-deck") })
  );

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["stacked-deck.bind-controller", "executed", null],
      ["stacked-deck.look", "negated", "impossible"],
      ["stacked-deck.put-into-hand", "ignored", "mistargeted"],
      ["stacked-deck.recycle-rest", "ignored", "mistargeted"]
    ]
  );
  assert.deepEqual(
    state.kernel.zoneSlice("A", "deck", "top").map((object) => object.ref.id),
    ["A:deck:3", "A:deck:1", "A:deck:4", "A:deck:2"]
  );
  // The unplayed spell is the only thing in hand: no looked-at card moved,
  // nothing was looked at, and no recycle/move action ever ran.
  assert.deepEqual(state.kernel.zone("A", "hand").map((ref) => ref.id), ["stacked-deck"]);
  // The pre-RIFT-358 golden asserted viewedCount 0 / viewed [] / recycledCount 0
  // for a silently-empty range. The merged primitive instead fail-closes without
  // linking any result, so those counters are absent (asserted here) while the
  // same semantics (nothing looked at, nothing recycled) are covered by the
  // unchanged deck and the empty action filter below.
  assert.equal(outcome.linkedValues["stacked-deck.look.viewedCount"], undefined);
  assert.equal(outcome.linkedValues["stacked-deck.look.viewed"], undefined);
  assert.equal(outcome.linkedValues["stacked-deck.recycle-rest.recycledCount"], undefined);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    state.kernel.events.map((event) => event.action).filter((action) =>
      ["look", "return-to-hand", "recycle"].includes(action)),
    []
  );
});

