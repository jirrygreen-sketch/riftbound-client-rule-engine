import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/clairvoyance.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import inspect from "../../../../engine-core/dist/effects/instructions/effect.inspect.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-932322ea9e594610dbc296c7b27a00cf97a5637134ab5407c3535c195d48e658";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "[Predict 5]. (Look at the top 5 cards of your Main Deck. Recycle any of them and put the rest back in any order.)\n" +
  "Draw 2.";

const [reaction, play] = program.abilities;
const [look, recycle, putBack, drawInstruction] = play.body;

// The card's inspect needs an upstream ordered deck-top range (contract 3.6:
// reading the top N must come from zoneSlice ordering, never a set query). The
// reference kernel supplies that ordered range through setPicks; the program's
// own picksSpecId is the stable id the caller must honour.
const PREDICT_RANGE = "clairvoyance.predict-top-5";
const LOOK_CHOICE_ID = "clairvoyance.predict-look/clairvoyance.predict-select";
/** effect.order's fixed request id shape: effect.order:<destination>:<player>. */
const PUT_BACK_ORDER_ID = "clairvoyance.predict-put-back/effect.order%3Atop%3AA";

const deckWorld = () => {
  const kernel = world().deck(["c1", "c2", "c3", "c4", "c5", "c6"]).build();
  kernel.setPicks(PREDICT_RANGE, ["c1", "c2", "c3", "c4", "c5"].map(id => kernel.ref(id)));
  return kernel;
};

/**
 * The card's inspect names its viewer with the implicit "you" of 190.6.d, which
 * the static IR records as a symbolic controller value. The reference kernel
 * compares the owner literally, so the execution cases bind only that one value
 * to the acting player (the same convention as ven-047-166 Apprentice Mage /
 * ven-162-166 Protective Sands); every other arg and the instruction order stay
 * the card's own.
 */
const boundBody = () =>
  play.body.map(instruction =>
    instruction.id === "clairvoyance.predict-look"
      ? { ...instruction, args: { ...instruction.args, player: { kind: "constant", value: "A" } } }
      : { ...instruction }
  );

test("ven-056-166 Clairvoyance: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-056-166 Clairvoyance: judgeReason names the ordered deck-top gap and the missing Predict keyword", () => {
  assert.match(program.judgeReason, /437\.1\.a/);
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /picksSpecId/);
  assert.match(program.judgeReason, /RIFT-64\/RIFT-66/);
  assert.match(program.judgeReason, /Predict X/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-056-166 Clairvoyance: printed energy 7, absent power, [Reaction] keyword", () => {
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 7 }
  });
  // power: null in the catalog means no printed power; the field is absent.
  assert.equal(Object.hasOwn(play.cost, "power"), false);
});

test("ven-056-166 Clairvoyance: structure — Predict 5 (inspect/recycle/order) then an independent Draw 2", () => {
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "clairvoyance.predict-look",
    "clairvoyance.predict-recycle",
    "clairvoyance.predict-put-back",
    "clairvoyance.draw"
  ]);

  // 437.1 / 437.1.a step 1: look at exactly five cards and choose any number of
  // them to recycle, from an upstream ordered range.
  assert.equal(look.op, "effect.inspect");
  assert.deepEqual(look.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(look.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 5 });
  assert.deepEqual(look.args.picksSpecId, { kind: "constant", value: PREDICT_RANGE });
  assert.deepEqual(look.args.choose, { kind: "constant", value: true });
  assert.deepEqual(look.args.chooseCount, { kind: "constant", value: { min: 0, max: 5 } });
  assert.equal(look.targets, undefined);
  assert.equal(look.picks, undefined);
  assert.equal(look.linkedTo, undefined);

  // 437.1.a: "Recycle any of them".
  assert.equal(recycle.op, "effect.recycle");
  assert.deepEqual(recycle.args.objects, {
    kind: "linked",
    instructionId: "clairvoyance.predict-look",
    key: "clairvoyance.predict-recycle"
  });
  assert.equal(recycle.linkedTo, "clairvoyance.predict-look");

  // 437.1.a: "put the rest back in any order" — the count is 5 minus what was
  // actually recycled, computed from the linked value instead of a fixed number.
  assert.equal(putBack.op, "effect.order");
  assert.deepEqual(putBack.args.destination, { kind: "constant", value: "top" });
  assert.deepEqual(putBack.args.chooseOrder, { kind: "constant", value: true });
  assert.deepEqual(putBack.args.count, {
    kind: "arithmetic",
    operator: "sub",
    operands: [
      { kind: "constant", value: 5 },
      {
        kind: "linked-value",
        instructionId: "clairvoyance.predict-recycle",
        key: "recycledCount"
      }
    ]
  });
  assert.equal(putBack.linkedTo, "clairvoyance.predict-recycle");

  // "Draw 2." is independent of the Predict steps (359.3.e.11), so it is not
  // linked to them.
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 2 });
  assert.equal(drawInstruction.linkedTo, undefined);
});

test("ven-056-166 Clairvoyance golden: recycling one predicted card puts the chosen card on the bottom", () => {
  const kernel = deckWorld();
  kernel.setAnswers({
    [LOOK_CHOICE_ID]: [kernel.ref("c2")],
    [PUT_BACK_ORDER_ID]: [kernel.ref("c3"), kernel.ref("c1"), kernel.ref("c4"), kernel.ref("c5")]
  });

  const outcome = resolveChainBody(boundBody(), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["clairvoyance.predict-look", "executed"],
    ["clairvoyance.predict-recycle", "executed"],
    ["clairvoyance.predict-put-back", "executed"],
    ["clairvoyance.draw", "executed"]
  ]);
  // 417.1.a: the recycled card goes to the bottom of its owner's Main Deck; the
  // four put back land on top in the chosen order, and c6 was never looked at.
  // c2 is recycled to the deck bottom; the four remaining predicted cards go
  // back on top in the chosen order, c6 was never looked at, and the following
  // "Draw 2." then takes the two new top cards into hand.
  assert.deepEqual(kernel.objectsInZone("A", "deck").map(ref => ref.id), [
    "c4",
    "c5",
    "c6",
    "c2"
  ]);
  assert.equal(outcome.linkedValues["clairvoyance.predict-look.inspected"], 5);
  assert.equal(outcome.linkedValues["clairvoyance.predict-recycle.recycledCount"], 1);
  assert.equal(outcome.linkedValues["clairvoyance.predict-put-back.ordered"], 4);
  // "Draw 2." really drew the two top cards (414.1.a).
  assert.equal(outcome.linkedValues["clairvoyance.draw.drawn"], 2);
  assert.equal(kernel.player("A").handSize, 2);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["c3", "c1"]);
});

test("ven-056-166 Clairvoyance golden: recycling nothing puts all five predicted cards back", () => {
  const kernel = deckWorld();
  kernel.setAnswers({
    [LOOK_CHOICE_ID]: [],
    [PUT_BACK_ORDER_ID]: [
      kernel.ref("c5"),
      kernel.ref("c4"),
      kernel.ref("c3"),
      kernel.ref("c2"),
      kernel.ref("c1")
    ]
  });

  const outcome = resolveChainBody(boundBody(), kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["clairvoyance.predict-recycle.recycledCount"], 0);
  // 437.1.a: the rest (here: all five) go back on top in any order, then the
  // untouched sixth card, then Draw 2 takes the two new top cards.
  assert.equal(outcome.linkedValues["clairvoyance.predict-look.inspected"], 5);
  assert.deepEqual(kernel.objectsInZone("A", "deck").map(ref => ref.id), [
    "c3",
    "c2",
    "c1",
    "c6"
  ]);
  assert.equal(outcome.linkedValues["clairvoyance.predict-put-back.ordered"], 5);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["c5", "c4"]);
});

test("ven-056-166 Clairvoyance golden: an empty Main Deck predicts and draws nothing without Burn Out", () => {
  // 437.4 / 437.4.a: predicting more cards than available looks at as many as
  // possible and never causes a Burn Out; the whole body still executes.
  const kernel = world().build();
  kernel.setPicks(PREDICT_RANGE, []);

  const outcome = resolveChainBody(boundBody(), kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["clairvoyance.predict-look.inspected"], 0);
  assert.equal(outcome.linkedValues["clairvoyance.predict-recycle.recycledCount"], 0);
  assert.equal(outcome.linkedValues["clairvoyance.predict-put-back.ordered"], 0);
  assert.equal(outcome.linkedValues["clairvoyance.draw.drawn"], 0);
  // 414.4: an empty Main Deck still submits the draw action; it simply draws 0
  // (Burn Out is the kernel's business, not this spell's).
  assert.deepEqual(outcome.events.map(event => event.action), ["draw"]);
  assert.equal(kernel.player("A").handSize, 0);
});

test("ven-056-166 Clairvoyance golden: the top-5 look refuses to infer deck order without an ordered range", () => {
  // Contract 3.6 / effect.inspect: a non-zero top look must come from an
  // ordered upstream range; without it the primitive fails closed instead of
  // falling back to a set query. Removing picksSpecId models exactly that
  // missing provider, and the other four instructions are untouched.
  const kernel = world().deck(["c1", "c2"]).build();
  const { picksSpecId, ...withoutOrderedRange } = look.args;
  assert.deepEqual(picksSpecId, { kind: "constant", value: PREDICT_RANGE });

  const run = runInstruction(inspect, withoutOrderedRange, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.asked, null);
  assert.equal(kernel.player("A").deckSize, 2);
  assert.equal(kernel.player("A").handSize, 0);
});

test.todo(
  "ven-056-166 Clairvoyance: the production caller supplies the ordered top-5 range for scope \"top\" " +
    "(contract 3.6 zoneSlice ordering wired into effect.inspect) — RIFT-64 / RIFT-66 follow-ups"
);

test.todo(
  "ven-056-166 Clairvoyance: [Predict X] has no KeywordDef in effects/keywords (RIFT-83's Vision inlines " +
    "only the single-card Predict), so the five-card Predict steps stay inside this card body"
);
