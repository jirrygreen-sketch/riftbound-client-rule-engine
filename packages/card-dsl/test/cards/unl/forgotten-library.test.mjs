import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/forgotten-library.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";

const CANONICAL =
  "card.hash-0c84a15b23d289310ee132b8937d22231ed0dab9f0fc4a5bdbd529b58be62c3a";
const SOURCE_TEXT =
  "While you control this battlefield, when you play a spell, if you spent :rb_energy_4: or more, [Predict]. " +
  "(Look at the top card of your Main Deck. You may recycle it.)";

const [ability] = program.abilities;
const [bind, look, recycle] = ability.body;

// effect.inspect issues its select request with the card's stable choiceId; the
// interpreter prefixes it with the execution path (interpreter README).
const SELECT_ID = "forgotten-library.predict-look/forgotten-library.predict";
const TOP_PICK_ID = "forgotten-library.predict-top-1";

test("unl-211-219 Forgotten Library: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-211-219 Forgotten Library: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-211-219 Forgotten Library: judgeReason separates the executed Predict body from the spent-energy gap", () => {
  // Still missing: the trigger condition cannot read the Energy actually paid
  // for the just-played spell (CR 383.2.a.1); only the RIFT-89 follow-up
  // remains a dependency.
  assert.match(program.judgeReason, /383\.2\.a\.1/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /Virtuoso/);
  // Stale dependencies and claims were re-checked against the merged source
  // and must not survive as gaps: the ordered zone-pick lifecycle (RIFT-358),
  // the effect.inspect contract 3.6 selector sync (RIFT-102) and the trigger
  // registration are all merged, and the executed evidence names them as such.
  assert.match(program.judgeReason, /RIFT-358 已合入/);
  assert.ok(!/RIFT-102/.test(program.judgeReason));
  assert.ok(!/没有有序区域 pick 的锁定\/生命周期/.test(program.judgeReason));
  assert.ok(!/没有任何已合入订阅方/.test(program.judgeReason));
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  // The body is no longer authored as a placeholder: the executed shape is
  // recorded in the reason itself.
  assert.match(program.judgeReason, /condition\.value/);
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /ChainEngine/);
});

test("unl-211-219 Forgotten Library: a spell play whose spend is part of the trigger condition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  // 383.4.a.4: "when you play a spell" is not a Play Effect; the event object
  // is the spell the ability's controller played (359/407).
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    object: { type: "spell", controller: "self" }
  });
  // 383.2.a.1: the spent-energy clause sits in the trigger condition, and the
  // frozen IR has no finalized-cost receipt to read it from (judgeReason).
  assert.equal(ability.trigger.condition.kind, "compare");
  assert.equal(ability.trigger.condition.operator, "gte");
  assert.deepEqual(ability.trigger.condition.right, { kind: "constant", value: 4 });
  assert.equal(ability.trigger.condition.left.kind, "count");
  assert.equal(ability.trigger.condition.left.subject, "energy-spent-on-the-played-spell");
  assert.equal(ability.trigger.once, undefined);
});

test("unl-211-219 Forgotten Library: [Predict] binds the controller, then looks at the ordered top card and recycles the choice", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "forgotten-library.bind-controller",
    "forgotten-library.predict-look",
    "forgotten-library.predict-recycle"
  ]);

  // 359.3.f.1: the symbolic "you" is bound at resolution with the merged
  // condition.value native instruction (sfd/called-shot precedent), so the
  // static IR keeps a contract 3.6 selector instead of a runtime ObjectRef.
  assert.equal(bind.op, "condition.value");
  assert.deepEqual(bind.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.deepEqual(bind.args.key, { kind: "constant", value: "controller" });
  assert.equal(bind.linkedTo, undefined);
  assert.equal(bind.targets, undefined);
  assert.equal(bind.picks, undefined);

  // 437.1/437.3.a: look at the top card of the Main Deck and choose 0..1 of the
  // seen cards to recycle. "your Main Deck" is the ability controller's deck
  // (190.6.d), read from the bound controller as a linked value.
  assert.equal(look.op, "effect.inspect");
  assert.equal(look.linkedTo, "forgotten-library.bind-controller");
  assert.deepEqual(look.args.player, {
    kind: "linked-value",
    instructionId: "forgotten-library.bind-controller",
    key: "controller"
  });
  assert.deepEqual(look.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(look.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(look.args.picksSpecId, {
    kind: "constant",
    value: TOP_PICK_ID
  });
  assert.deepEqual(look.args.choose, { kind: "constant", value: true });
  assert.deepEqual(look.args.chooseCount, {
    kind: "constant",
    value: { min: 0, max: 1 }
  });
  assert.deepEqual(look.args.choiceId, {
    kind: "constant",
    value: "forgotten-library.predict"
  });
  assert.deepEqual(look.args.pickedKey, { kind: "constant", value: "predict-looked-at" });
  assert.deepEqual(look.args.choosePicksKey, { kind: "constant", value: "predict-recycle" });
  assert.equal(look.targets, undefined);

  // 437.3.a's ordered deck-top read is the contract 3.6 zoneSlice source: the
  // chain Finalize locks the top card in real deck order (RIFT-358), and
  // effect.inspect's "top" scope consumes that locked ordered pick by spec id.
  assert.deepEqual(look.picks, [
    {
      id: TOP_PICK_ID,
      options: [],
      ordered: true,
      selection: "all",
      zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 1 } }
    }
  ]);

  // 417.1.b/417.4: the recycle follows the look and consumes its linked result.
  assert.equal(recycle.op, "effect.recycle");
  assert.deepEqual(recycle.args.objects, {
    kind: "linked",
    instructionId: "forgotten-library.predict-look",
    key: "predict-recycle"
  });
  assert.equal(recycle.linkedTo, "forgotten-library.predict-look");
});

test("unl-211-219 Forgotten Library golden: the Predict body recycles the chosen top card through the real ChainEngine", () => {
  // Production path: the card body enters a real ChainEngine, Finalize locks
  // the declared zoneSlice in real deck order (RIFT-358), the inspector issues
  // the card's private 0..1 choice, and the linked recycle sends the chosen
  // card to the bottom of its owner's Main Deck (437.1/417.1).
  const f = fixture();
  f.engine.enqueue({
    id: "forgotten-library-chain",
    kind: "triggered",
    controller: "A",
    source: f.kernel.getObject("source"),
    body: ability.body
  });
  f.engine.advance();

  // Finalize locked the ordered top-of-deck source before any resolution.
  const item = f.engine.items[0];
  assert.equal(item.status, "finalized");
  assert.deepEqual(item.pickPlans.map(plan => [plan.id, plan.refs.map(ref => ref.id)]), [
    [TOP_PICK_ID, ["A:deck:1"]]
  ]);

  let request = null;
  try {
    f.engine.pass("A");
    f.engine.pass("B");
  } catch (error) {
    if (error instanceof AwaitChoice) request = error.request;
    else throw error;
  }
  assert.ok(request, "the Predict look must ask its 0..1 recycle choice");
  assert.equal(request.id, SELECT_ID);
  assert.equal(request.type, "select-objects");
  assert.equal(request.visibility, "chooser-only");
  assert.equal(request.chooser, "A");
  assert.deepEqual(request.min, 0);
  assert.deepEqual(request.max, 1);
  assert.deepEqual(request.options.map(ref => ref.id), ["A:deck:1"]);

  f.answers.set(request.id, [request.options[0]]);
  f.engine.pass("B");

  assert.equal(f.engine.items.length, 0);
  // 417.1: the chosen card went to the bottom of its owner's Main Deck.
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id), ["A:deck:2", "A:deck:3", "A:deck:4", "A:deck:1"]);
  assert.equal(f.kernel.linked("forgotten-library.predict-recycle.recycledCount"), 1);
  assert.equal(f.kernel.linked("forgotten-library.predict-look.inspected"), 1);
});

test("unl-211-219 Forgotten Library golden: declining the recycle is a legal Predict (437.1/437.4)", () => {
  const f = fixture();
  f.engine.enqueue({
    id: "forgotten-library-chain",
    kind: "triggered",
    controller: "A",
    source: f.kernel.getObject("source"),
    body: ability.body
  });
  f.engine.advance();

  let request = null;
  try {
    f.engine.pass("A");
    f.engine.pass("B");
  } catch (error) {
    if (error instanceof AwaitChoice) request = error.request;
    else throw error;
  }
  assert.ok(request, "choosing none is still a private choice");
  f.answers.set(request.id, []);
  f.engine.pass("B");

  assert.equal(f.engine.items.length, 0);
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id), ["A:deck:1", "A:deck:2", "A:deck:3", "A:deck:4"]);
  assert.equal(f.kernel.linked("forgotten-library.predict-recycle.recycledCount"), 0);
});

test("unl-211-219 Forgotten Library golden: a short Main Deck predicts as much as possible (437.4)", () => {
  // An empty Main Deck locks an empty ordered pick, and the 0..1 choice never
  // becomes an awaitable request, so the trigger resolves without a choice.
  const f = fixture();
  for (const ref of f.kernel.zone("A", "deck")) {
    f.kernel.perform({ type: "move-zone", object: ref, to: "hand" });
  }
  f.engine.enqueue({
    id: "forgotten-library-chain",
    kind: "triggered",
    controller: "A",
    source: f.kernel.getObject("source"),
    body: ability.body
  });
  f.engine.advance();

  assert.equal(f.engine.items[0].status, "finalized");
  assert.deepEqual(f.engine.items[0].pickPlans.map(plan => [plan.id, plan.refs]), [
    [TOP_PICK_ID, []]
  ]);

  let request = null;
  try {
    f.engine.pass("A");
    f.engine.pass("B");
  } catch (error) {
    if (error instanceof AwaitChoice) request = error.request;
    else throw error;
  }
  assert.equal(request, null);

  assert.equal(f.engine.items.length, 0);
  assert.equal(f.kernel.zone("A", "deck").length, 0);
});

test.todo(
  "unl-211-219 Forgotten Library: evaluate 'if you spent :rb_energy_4: or more' from the " +
    "finalized cost plan of the spell that was just played (CR 383.2.a.1; needs the cost-receipt " +
    "reading vocabulary of the RIFT-89 follow-up — cost.pay/cost.modify primitives are merged, " +
    "but no Expr/Condition form reads a paid amount today)"
);
