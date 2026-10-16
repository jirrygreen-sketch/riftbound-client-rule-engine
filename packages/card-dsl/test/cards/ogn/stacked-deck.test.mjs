import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/stacked-deck.js";
// Card bodies run through the chain's interpreter adapter, the production entry
// point that re-wraps Expr arguments for the registered primitives.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-de0d686bb2019a7d9b9b5212d1e6b414c0f1c1a69c9903fedc7471b860b86045";
const play = program.abilities.find((ability) => ability.kind === "play");
const [bindInstruction, lookInstruction, putInstruction, recycleInstruction] = play.body;
const [viewedPick] = lookInstruction.picks;
const [keptPick] = putInstruction.picks;

const deckedKernel = () =>
  world()
    .object("stacked-deck", { owner: "A", controller: "A", zone: "chain", types: ["spell"] })
    .deck(["top-card", "middle-card", "bottom-card", "fourth-card"], { owner: "A" })
    .build();

const runLookHalf = (kernel, keptIndex) => {
  const viewed = kernel.zoneSlice("A", "deck", "top", 3).map((object) => object.ref);
  kernel.setPicks(viewedPick.id, viewed);
  kernel.setPicks(keptPick.id, [viewed[keptIndex]]);
  return { viewed, outcome: resolveChainBody(play.body, kernel) };
};

test("ogn-183-298 Stacked Deck: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /effect\.inspect/);
  assert.match(program.judgeReason, /zoneSlice|有序/);
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Look at the top 3 cards of your Main Deck. Put 1 into your hand and " +
      "recycle the rest."
  );
});

test("ogn-183-298 Stacked Deck: look-top-3, put 1 into hand, recycle the rest", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "action" });

  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map((instruction) => [instruction.id, instruction.op]), [
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

  // "Look at the top 3 cards of your Main Deck": the top scope reads the
  // controller's deck in real zone order through an ordered pick set.
  assert.deepEqual(lookInstruction.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(lookInstruction.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(lookInstruction.args.player, {
    kind: "linked-value",
    instructionId: "stacked-deck.bind-controller",
    key: "controller"
  });
  assert.equal(lookInstruction.linkedTo, "stacked-deck.bind-controller");
  assert.deepEqual(viewedPick, {
    id: "stacked-deck.viewed",
    options: ["top-3-cards-of-your-main-deck-in-zone-order"],
    min: 3,
    max: 3,
    selection: "all",
    filter: { owner: "self", zone: "deck" }
  });

  // "Put 1 into your hand": a non-target pick over the looked-at cards.
  assert.equal(putInstruction.linkedTo, "stacked-deck.look");
  assert.deepEqual(putInstruction.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(putInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(keptPick.options, [
    { kind: "linked-value", instructionId: "stacked-deck.look", key: "viewed" }
  ]);

  // "and recycle the rest": the same looked-at list, minus what left for Hand.
  assert.equal(recycleInstruction.linkedTo, "stacked-deck.look");
  assert.deepEqual(recycleInstruction.args.objects, {
    kind: "linked-value",
    instructionId: "stacked-deck.look",
    key: "viewed"
  });
  assert.equal(recycleInstruction.targets, undefined);
});

test("ogn-183-298 Stacked Deck golden: the kept card goes to hand and the other two are recycled", () => {
  for (const [keptIndex, keptId] of [[0, "top-card"], [1, "middle-card"], [2, "bottom-card"]]) {
    const kernel = deckedKernel();
    const { outcome } = runLookHalf(kernel, keptIndex);

    assert.deepEqual(
      outcome.results.map((entry) => [entry.id, entry.result.status]),
      [
        ["stacked-deck.bind-controller", "executed"],
        ["stacked-deck.look", "executed"],
        ["stacked-deck.put-into-hand", "executed"],
        ["stacked-deck.recycle-rest", "executed"]
      ]
    );
    assert.deepEqual(kernel.objectsInZone("A", "hand").map((ref) => ref.id), [keptId]);
    // The unaffected fourth card stays on top of the recycled pair (417.1.a).
    assert.deepEqual(
      kernel.objectsInZone("A", "deck").map((ref) => ref.id),
      ["fourth-card", ...["top-card", "middle-card", "bottom-card"].filter((id) => id !== keptId)]
    );
    assert.deepEqual(outcome.events.map((event) => event.action), ["look", "return-to-hand", "recycle", "recycle"]);
    assert.equal(outcome.linkedValues["stacked-deck.look.viewedCount"], 3);
  }
});

test("ogn-183-298 Stacked Deck golden: the top scope refuses to guess deck order without an ordered source", () => {
  // A set query does not carry zone order: without the ordered pick set the
  // look range is empty (nothing is looked at), the put-1 has nothing to pick
  // from, and the recycle has nothing to recycle. The deck is never reordered
  // by a guessed slice.
  const kernel = deckedKernel();
  const outcome = resolveChainBody(play.body, kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["stacked-deck.bind-controller", "executed", null],
      ["stacked-deck.look", "executed", null],
      ["stacked-deck.put-into-hand", "ignored", "mistargeted"],
      ["stacked-deck.recycle-rest", "executed", null]
    ]
  );
  assert.equal(outcome.linkedValues["stacked-deck.look.viewedCount"], 0);
  assert.deepEqual(outcome.linkedValues["stacked-deck.look.viewed"], []);
  assert.equal(outcome.linkedValues["stacked-deck.recycle-rest.recycledCount"], 0);
  assert.equal(outcome.events.length, 0);
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
  assert.deepEqual(
    kernel.objectsInZone("A", "deck").map((ref) => ref.id),
    ["top-card", "middle-card", "bottom-card", "fourth-card"]
  );
});

test.todo(
  "ogn-183-298 Stacked Deck: the ordered 'top 3 of your Main Deck' pick set (face-down cards " +
    "looked at privately, then one to hand) must be provisioned by the production Finalize/AwaitChoice " +
    "lifecycle rather than by the test kernel; needs the ordered-zone pick lifecycle (RIFT-84/RIFT-90)"
);
