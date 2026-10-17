import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/called-shot.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { translateInstructionTargets } from "../../../../engine-core/dist/programs/filters.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
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
const DRAW_CHOICE = "called-shot.look-top-two/called-shot.draw-choice";

/**
 * effect.inspect 的 top 作用域要求按真实牌库顺序提供有序 picks（契约 3.6 的
 * zoneSlice 才是保序读取）。RIFT-358 已把该来源接入生产链路：卡片自己声明
 * zoneSlice，Finalize 用 zoneSlice 锁定有序引用；参考内核的 setPicks 只负责把同一份
 * 锁定结果喂给解释器，不猜顺序。
 */
const deckedKernel = (deckSize = 3) => {
  const deck = ["top-card", "second-card", "third-card"].slice(0, deckSize);
  const kernel = world().player("A").deck(deck, { owner: "A" }).build();
  const topTwo = kernel.zoneSlice("A", "deck", "top", 2).map((object) => object.ref);
  kernel.setPicks(topTwoPick.id, topTwo);
  return { kernel, topTwo };
};

/**
 * 生产链路径：卡片 body 经 translateInstructionTargets 进入真实 ChainEngine，
 * Finalize 用契约 3.6 的 zoneSlice 锁定有序牌库顶，Resolve 里 effect.inspect
 * 通过 choose/chooseCount 做出「两张里选一张」的私有选择。
 */
function chainFixture(deck = ["d1", "d2", "d3", "d4"]) {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .deck(deck, { owner: "A" })
    .hand("called-shot", { cardId: CANONICAL, types: ["spell"], energy: 0, power: [], might: null })
    .build();
  const answers = new Map();
  const requests = [];
  const decide = (request) => {
    requests.push(request);
    if (answers.has(request.id)) return answers.get(request.id);
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: decide,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose: decide })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  return {
    kernel,
    engine,
    answers,
    requests,
    draft: () => ({
      id: "play-called-shot",
      controller: "A",
      source: kernel.getObject("called-shot"),
      kind: "spell",
      speed: "normal",
      body: translateInstructionTargets(play.body)
    })
  };
}

const resolveAll = (engine) => {
  engine.advance();
  let guard = 0;
  while (engine.items.length && guard++ < 20) engine.pass(engine.priority);
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

test("sfd-122-221 Called Shot: judgeReason records the executable body and the [Repeat] gap", () => {
  // The ordered-pick dependency merged (RIFT-358), so the reason must record
  // the executed look/draw/recycle evidence and only the still-broken
  // [Repeat] additional cost.
  assert.match(program.judgeReason, /additional-cost/);
  assert.match(program.judgeReason, /translateCost/);
  assert.match(program.judgeReason, /repeat\.cost/);
  assert.match(program.judgeReason, /820\.1\.c/);
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.doesNotMatch(program.judgeReason, /assertFinalizationSurface/);
  assert.ok(!/RIFT-\d+/.test(program.judgeReason.replace(/RIFT-358/g, "")));
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

  // 128.3-128.4 / 432.1.c: a private look over the deck's real order. The
  // ordered range is this card's own zoneSlice source, locked by the merged
  // ordered-pick lifecycle (contract 3.6 / RIFT-358).
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
  // 355.10.a: "draw one" is the looking player's own private subset choice, so
  // it stays with the resolving instruction (contract 3.6; the ordered source
  // only binds the whole slice).
  assert.deepEqual(lookInstruction.args.choose, { kind: "constant", value: true });
  assert.deepEqual(lookInstruction.args.chooseCount, {
    kind: "constant",
    value: { min: 1, max: 1 }
  });
  assert.deepEqual(lookInstruction.args.choiceId, {
    kind: "constant",
    value: "called-shot.draw-choice"
  });
  assert.deepEqual(lookInstruction.args.choosePicksKey, {
    kind: "constant",
    value: "chosen"
  });
  assert.equal(lookInstruction.linkedTo, "called-shot.bind-controller");
  // Contract 3.6 / RIFT-358: an ordered source is options: [], ordered: true,
  // selection: "all" with exactly one zoneSlice source and no filter/bounds.
  assert.deepEqual(topTwoPick, {
    id: "called-shot.top-two",
    options: [],
    ordered: true,
    selection: "all",
    zoneSlice: {
      zone: "deck",
      from: "top",
      count: { kind: "constant", value: 2 }
    }
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
  // The drawn card is the actual selected result of the look, read as a linked
  // ordered source (RIFT-358); the unselected card stays in the looked list.
  assert.deepEqual(drawnPick, {
    id: "called-shot.drawn-card",
    options: [],
    ordered: true,
    selection: "all",
    linked: {
      kind: "linked-value",
      instructionId: "called-shot.look-top-two",
      key: "chosen"
    }
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
  // Contract 3.6 / RIFT-358: the look's private one-of-two choice writes the
  // "chosen" result, and the draw instruction reads it as a linked ordered
  // source. The ordered deck-top slice is provisioned from the kernel's real
  // zone order (Finalize owns it in production).
  const { kernel, topTwo } = deckedKernel();
  kernel.setAnswers({ [DRAW_CHOICE]: [topTwo[0]] });

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
  assert.deepEqual(outcome.linkedValues["called-shot.look-top-two.chosen"], [topTwo[0]]);
  assert.equal(outcome.linkedValues["called-shot.recycle-the-other.recycledCount"], 1);
  assert.deepEqual(outcome.events.map((event) => event.action), [
    "look",
    "return-to-hand",
    "recycle"
  ]);
});

test("sfd-122-221 Called Shot golden: choosing the other card swaps the two destinations", () => {
  const { kernel, topTwo } = deckedKernel();
  kernel.setAnswers({ [DRAW_CHOICE]: [topTwo[1]] });

  const outcome = resolveChainBody(play.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(kernel.objectsInZone("A", "hand").map((ref) => ref.id), ["second-card"]);
  assert.deepEqual(kernel.objectsInZone("A", "deck").map((ref) => ref.id), [
    "third-card",
    "top-card"
  ]);
});

test("sfd-122-221 Called Shot golden: an unfilled ordered range looks at nothing and never guesses order", () => {
  // Contract 3.6: the ordered deck-top slice is the only ordering authority. If
  // nothing locked it, the look must not fall back to the unordered set query;
  // with the printed mandatory one-of-two choice impossible it is negated
  // (432.1.c.1), and the deck is left exactly as it was.
  const kernel = world().player("A").deck(["top-card", "second-card"], { owner: "A" }).build();

  const outcome = resolveChainBody(play.body, kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["called-shot.bind-controller", "executed", null],
      ["called-shot.look-top-two", "negated", "impossible"],
      ["called-shot.draw-one", "ignored", "mistargeted"],
      ["called-shot.recycle-the-other", "ignored", "mistargeted"]
    ]
  );
  assert.equal(outcome.linkedValues["called-shot.look-top-two.lookedCount"], undefined);
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
  assert.deepEqual(kernel.objectsInZone("A", "deck").map((ref) => ref.id), [
    "top-card",
    "second-card"
  ]);
  assert.deepEqual(outcome.events, []);
});

test("sfd-122-221 Called Shot golden: a short Main Deck looks at what is there without burning out", () => {
  // 432.1.c: looking at more cards than the deck holds looks at as many as
  // possible and never Burns Out. With one card the look executes over that
  // single card, the choice still takes it, and "the other" has nothing left to
  // recycle (417.4 shortfall).
  const { kernel, topTwo } = deckedKernel(1);
  kernel.setAnswers({ [DRAW_CHOICE]: [topTwo[0]] });

  const outcome = resolveChainBody(play.body, kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["called-shot.bind-controller", "executed", null],
      ["called-shot.look-top-two", "executed", null],
      ["called-shot.draw-one", "executed", null],
      ["called-shot.recycle-the-other", "ignored", "mistargeted"]
    ]
  );
  assert.equal(outcome.linkedValues["called-shot.look-top-two.lookedCount"], 1);
  assert.deepEqual(kernel.objectsInZone("A", "hand").map((ref) => ref.id), ["top-card"]);
  assert.deepEqual(kernel.objectsInZone("A", "deck"), []);
  // 432.2: no Burn Out happened, so nobody gained a point.
  assert.equal(kernel.player("A").score, 0);
  assert.equal(kernel.player("B").score, 0);
});

test("sfd-122-221 Called Shot golden: the real chain locks the deck top at Finalize and resolves the look", () => {
  // The production path: the card body goes through the chain's interpreter
  // adapter, Finalize locks the declared zoneSlice into ordered references, and
  // Resolve performs the private one-of-two choice before the linked draw and
  // recycle instructions run.
  const f = chainFixture(["d1", "d2", "d3", "d4"]);
  f.engine.execute(f.draft());
  f.engine.advance();

  // Finalize locked the real top two in zone order, before any look happened.
  const locked = f.engine.items[0].pickPlans;
  assert.deepEqual(locked.map((plan) => [plan.id, plan.refs.map((ref) => ref.id)]), [
    ["called-shot.top-two", ["d1", "d2"]]
  ]);
  assert.equal(
    f.engine.pipeline.events.filter((event) => event.timingPoint === "cards-looked-at").length,
    0
  );

  const request = (() => {
    try {
      f.engine.pass("A");
      f.engine.pass("B");
    } catch (error) {
      assert.ok(error instanceof AwaitChoice, String(error));
      return error.request;
    }
    throw new Error("the look's one-of-two choice must be requested during Resolve");
  })();

  assert.equal(request.id, DRAW_CHOICE);
  assert.equal(request.type, "select-objects");
  assert.equal(request.visibility, "chooser-only");
  assert.equal(request.chooser, "A");
  assert.deepEqual(request.options.map((ref) => ref.id), ["d1", "d2"]);
  assert.equal(request.min, 1);
  assert.equal(request.max, 1);

  f.answers.set(request.id, [request.options[1]]);
  f.engine.pass("B");

  assert.deepEqual(f.kernel.zone("A", "hand").map((ref) => ref.id), ["d2"]);
  // RIFT-358 / CR 124: the card that left drops out of the locked list, so
  // "the other" recycles to the bottom of its owner's Main Deck.
  assert.deepEqual(f.kernel.zoneSlice("A", "deck", "top").map((object) => object.ref.id), [
    "d3",
    "d4",
    "d1"
  ]);
  assert.equal(f.kernel.linked("called-shot.look-top-two.lookedCount"), 2);
  assert.deepEqual(f.kernel.linked("called-shot.look-top-two.chosen"), [request.options[1]]);
  assert.equal(f.kernel.linked("called-shot.recycle-the-other.recycledCount"), 1);
  // The look is emitted at Resolve, the drawn card really lands in Hand (the
  // zone-entry emission of the return-to-hand action, 108.7.b/414.1), and the
  // other is recycled (417.1).
  assert.deepEqual(
    f.engine.pipeline.events
      .filter((event) => ["cards-looked-at", "object-enters-hand", "card-recycled"].includes(event.timingPoint))
      .map((event) => [event.timingPoint, event.object?.ref.id ?? null]),
    [
      ["cards-looked-at", null],
      ["object-enters-hand", "d2"],
      ["card-recycled", "d1"]
    ]
  );
});

test.todo(
  "sfd-122-221 Called Shot: [Repeat] :rb_rune_chaos: — collecting the optional additional cost at Finalize " +
    "and executing the effect one extra time per paid instance (820.1.b/820.1.d/820.2.a) needs an " +
    "additional-cost binding (programs/play.ts currently rejects additional-cost) and the Repeat cost plan"
);
