import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/called-shot.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-80891ed8d25bcc7b7a458d0779163e739b738892493c56f163344772ecf1eea2";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "[Repeat] :rb_rune_chaos: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Look at the top 2 cards of your Main Deck. Draw one and recycle the other.";

const [speed, play] = program.abilities;
const [bindInstruction, lookInstruction, drawInstruction, recycleInstruction] = play.body;
const [topTwoPick] = lookInstruction.picks;
const [drawnPick] = drawInstruction.picks;

/**
 * effect.inspect 的 top 作用域要求上游按真实牌库顺序提供有序 picks（契约 3.6 的
 * zoneSlice 才是保序读取）；参考内核用 setPicks 提供该有序范围，与已合入
 * ogn/stacked-deck、ven/apprentice-mage 的既有做法一致。两个 pick 都由 Finalize 锁定：
 * 牌库顶两张（有序，供查看）与其中被抽走的那一张（供入手）。
 */
const deckedKernel = (deckSize = 3) => {
  const deck = ["top-card", "second-card", "third-card"].slice(0, deckSize);
  const kernel = world().player("A").deck(deck, { owner: "A" }).build();
  const topTwo = kernel.zoneSlice("A", "deck", "top", 2).map((object) => object.ref);
  kernel.setPicks(topTwoPick.id, topTwo);
  return { kernel, topTwo };
};

test("sfd-122-221 Called Shot: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-122-221 Called Shot: judgeReason names both gaps and their tasks", () => {
  assert.match(program.judgeReason, /effect\.inspect/);
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /820\.1\.c|Repeat/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-122-221 Called Shot: [Action] keyword, printed cost and the [Repeat] declaration", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  // Printed base cost (0 energy + 1 Chaos power) is bound from the card
  // identity at Finalize (356.1.c), so only the optional additional
  // [Repeat] :rb_rune_chaos: component is declared here (820.1.c).
  assert.deepEqual(play.cost, {
    kind: "additional-cost",
    keyword: "repeat",
    power: { kind: "literal", value: ["Chaos"] }
  });
  // This spell prints no reminder text for the base cost, so no printed-cost
  // block is authored; the base cost comes from the catalog (356.1.c).
  assert.equal(play.cost.energy, undefined);
});

test("sfd-122-221 Called Shot: look at the top 2, draw one, recycle the other", () => {
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["called-shot.bind-controller", "condition.value"],
      ["called-shot.look-top-two", "effect.inspect"],
      ["called-shot.draw-one", "effect.zone"],
      ["called-shot.recycle-the-other", "effect.recycle"]
    ]
  );

  // "your Main Deck" = the caster's deck (190.6.d): the controller is bound
  // once and read back by the look instruction.
  assert.deepEqual(bindInstruction.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.deepEqual(bindInstruction.args.key, { kind: "constant", value: "controller" });

  // 128.3-128.4 / 432.1.c: a private look over the deck's real order; the
  // ordered range id names the upstream zoneSlice-provided picks.
  assert.deepEqual(lookInstruction.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(lookInstruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(lookInstruction.args.player, {
    kind: "linked-value",
    instructionId: "called-shot.bind-controller",
    key: "controller"
  });
  assert.deepEqual(lookInstruction.args.picksSpecId, {
    kind: "constant",
    value: "called-shot.top-two"
  });
  assert.equal(lookInstruction.args.choose, undefined);
  assert.equal(lookInstruction.linkedTo, "called-shot.bind-controller");
  assert.deepEqual(topTwoPick, {
    id: "called-shot.top-two",
    options: ["dynamic:main-deck-top-two"],
    min: 2,
    max: 2,
    selection: "all",
    filter: { owner: "self", zone: "deck" }
  });

  // "Draw one": one of the looked-at cards moves to the Hand (414.1). The
  // candidate set is in a Secret zone and the choice belongs to the looking
  // player, so it is a non-target pick (355.10.a), never a TargetSpec.
  assert.equal(lookInstruction.targets, undefined);
  assert.equal(drawInstruction.op, "effect.zone");
  assert.deepEqual(drawInstruction.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(drawInstruction.args.pick, {
    kind: "constant",
    value: "called-shot.drawn-card"
  });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.linkedTo, "called-shot.look-top-two");
  assert.deepEqual(drawnPick, {
    id: "called-shot.drawn-card",
    options: [
      {
        kind: "linked-value",
        instructionId: "called-shot.look-top-two",
        key: "looked"
      }
    ],
    min: 1,
    max: 1,
    selection: "one"
  });

  // "and recycle the other": 417.1 / 417.1.a keeps the leftover card on the
  // bottom of its owner's Main Deck. The list comes from the look result; the
  // card already moved to Hand has a stale reference (124) and drops out.
  assert.equal(recycleInstruction.op, "effect.recycle");
  assert.deepEqual(recycleInstruction.args.objects, {
    kind: "linked-value",
    instructionId: "called-shot.look-top-two",
    key: "looked"
  });
  assert.equal(recycleInstruction.targets, undefined);
  assert.equal(recycleInstruction.linkedTo, "called-shot.look-top-two");
});

test("sfd-122-221 Called Shot golden: the drawn card goes to hand and the other to the deck bottom", () => {
  const { kernel, topTwo } = deckedKernel();
  kernel.setPicks(drawnPick.id, [topTwo[0]]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["called-shot.bind-controller", "executed"],
      ["called-shot.look-top-two", "executed"],
      ["called-shot.draw-one", "executed"],
      ["called-shot.recycle-the-other", "executed"]
    ]
  );
  // 414.1: the looked card becomes a Hand card; 417.1.a: the other goes to the
  // bottom of its owner's Main Deck, below the untouched third card.
  assert.deepEqual(kernel.objectsInZone("A", "hand").map((ref) => ref.id), ["top-card"]);
  assert.deepEqual(kernel.objectsInZone("A", "deck").map((ref) => ref.id), [
    "third-card",
    "second-card"
  ]);
  assert.deepEqual(outcome.linkedValues["called-shot.look-top-two.lookedCount"], 2);
  assert.equal(outcome.linkedValues["called-shot.recycle-the-other.recycledCount"], 1);
  assert.deepEqual(outcome.events.map((event) => event.action), [
    "look",
    "return-to-hand",
    "recycle"
  ]);
});

test("sfd-122-221 Called Shot golden: choosing the other card swaps the two destinations", () => {
  const { kernel, topTwo } = deckedKernel();
  kernel.setPicks(drawnPick.id, [topTwo[1]]);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.objectsInZone("A", "hand").map((ref) => ref.id), ["second-card"]);
  assert.deepEqual(kernel.objectsInZone("A", "deck").map((ref) => ref.id), [
    "third-card",
    "top-card"
  ]);
});

test("sfd-122-221 Called Shot golden: without the ordered deck-top range nothing is looked at", () => {
  // The card names its ordered range, but no upstream provider filled it: the
  // look range is empty, so it looks at zero cards and never falls back to the
  // unordered set query (contract 3.6; the same reading the merged
  // ogn/stacked-deck golden records). The follow-ups have nothing to act on and
  // the deck is never reordered by a guessed slice.
  // The ordered deck-top range is absent: neither pick is provisioned, exactly
  // the state the production Finalize surface would leave (it locks instruction
  // targets only).
  const kernel = world().player("A").deck(["top-card", "second-card"], { owner: "A" }).build();

  const outcome = resolveChainBody(play.body, kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["called-shot.bind-controller", "executed", null],
      ["called-shot.look-top-two", "executed", null],
      ["called-shot.draw-one", "ignored", "mistargeted"],
      ["called-shot.recycle-the-other", "executed", null]
    ]
  );
  assert.equal(outcome.linkedValues["called-shot.look-top-two.lookedCount"], 0);
  assert.deepEqual(outcome.linkedValues["called-shot.look-top-two.looked"], []);
  assert.equal(outcome.linkedValues["called-shot.recycle-the-other.recycledCount"], 0);
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
  assert.deepEqual(kernel.objectsInZone("A", "deck").map((ref) => ref.id), [
    "top-card",
    "second-card"
  ]);
  assert.deepEqual(outcome.events, []);
});

test("sfd-122-221 Called Shot golden: an empty Main Deck looks at nothing without burning out", () => {
  // 432.1.c: looking at more cards than the deck holds looks at as many as
  // possible and never Burns Out. With an empty deck the ordered range is
  // empty, the look executes with 0, and both follow-ups have nothing to act on.
  const kernel = world().player("A").build();
  kernel.setPicks(topTwoPick.id, []);

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.results[1].result.status, "executed");
  assert.equal(outcome.linkedValues["called-shot.look-top-two.lookedCount"], 0);
  assert.equal(outcome.results[2].result.status, "ignored");
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 0);
});

test.todo(
  "sfd-122-221 Called Shot: the ordered 'top 2 cards of your Main Deck' pick set must be provisioned by " +
    "the production Finalize/AwaitChoice lifecycle instead of the test kernel (contract 3.6 zoneSlice; the " +
    "chain Finalize only locks TargetSpecs) — RIFT-257"
);

test.todo(
  "sfd-122-221 Called Shot: [Repeat] :rb_rune_chaos: — collecting the optional additional cost at Finalize " +
    "and executing the effect one extra time per paid instance (820.1.b/820.1.d/820.2.a) needs the Repeat " +
    "keyword expansion (RIFT-86) and the cost plan (RIFT-89)"
);
