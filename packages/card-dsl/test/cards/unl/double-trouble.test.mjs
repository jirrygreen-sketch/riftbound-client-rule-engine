import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/double-trouble.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { finalizeOrderedPickPlans, orderedPickSpecs } from "../../../../engine-core/dist/chain/picks/plan.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-daadc507f6831def277e2708c2368b3d4b9d91466770b9edea36a47ecbb044c7";
const SOURCE_TEXT =
  "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Look at the top 3 cards of your Main Deck. You may reveal a unit from among them and draw it. Recycle the rest.";

const [repeat, play] = program.abilities;
const [bindInstruction, lookInstruction, mayReveal, recycleInstruction] = play.body;
const [revealInstruction, drawInstruction] = mayReveal.args.body.value;
const [viewedPick] = lookInstruction.picks;
const [revealedPick] = revealInstruction.picks;
const [drawnPick] = drawInstruction.picks;

const MAY_ID = "double-trouble.may-reveal/optional";

/** A four-card Main Deck: the top three are the looked-at block. */
const deckWorld = () =>
  world()
    .deck(["top-card", "middle-card", "bottom-card", "fourth-card"], { owner: "A" })
    .build();

/**
 * The merged chain adapter does not decode effect.reveal's `pick` literal
 * (LITERAL_FIELDS lists only `target` for effect.reveal), so this local decode
 * passes the borrowed id straight to the primitive — the same value the
 * adapter would produce once the field is registered. Instruction order, ops
 * and every other argument stay exactly as authored in the card program.
 */
const decodedBody = (body) =>
  body.map((instruction) => {
    if (instruction.op === "choice.optional") {
      return {
        ...instruction,
        args: {
          ...instruction.args,
          body: {
            ...instruction.args.body,
            value: instruction.args.body.value.map((inner) =>
              inner.op === "effect.reveal"
                ? { ...inner, args: { pick: inner.args.pick.value } }
                : { ...inner }
            )
          }
        }
      };
    }
    return { ...instruction };
  });

/**
 * Provision the ordered pick set through the merged production lifecycle
 * (contract 3.6 / RIFT-358): the card's own zoneSlice source is locked by
 * chain/picks/plan.ts, which is the sole ordering authority, and the reference
 * kernel only receives the locked references. Query order is never used.
 */
function lockViewed(kernel) {
  const context = bindResolveContext(kernel, { source: kernel.getObject("A:deck:1"), controller: "A" });
  const [plan] = finalizeOrderedPickPlans(context, play.body);
  assert.equal(plan.id, viewedPick.id);
  kernel.setPicks(viewedPick.id, plan.refs);
  return plan.refs;
}

test("unl-032-219 Double Trouble: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
});

test("unl-032-219 Double Trouble: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The reason must keep only the verified current gap: the [Repeat] optional
  // additional cost and its paid-instance wiring. The top-3 look is now
  // carried by the merged ordered-pick lifecycle.
  assert.match(program.judgeReason, /additional-cost/);
  assert.match(program.judgeReason, /translateCost/);
  assert.match(program.judgeReason, /repeat\.cost/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /820\.1\.d\.1/);
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /RIFT-358/);
  // The already-verified ordered-pick half must not be reported as a gap.
  assert.doesNotMatch(program.judgeReason, /assertFinalizationSurface/);
  assert.doesNotMatch(program.judgeReason, /没有有序区域 pick 的锁定路径/);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-032-219 Double Trouble: [Repeat] 2-energy additional cost and the four-step body", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(repeat, { kind: "keyword", keyword: "repeat" });
  assert.equal(play.kind, "play");
  // 356.1.c: the printed base cost is 2 energy. The KeywordAbility contract
  // currently has no field for the separate printed Repeat cost parameter.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });

  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["double-trouble.bind-controller", "condition.value"],
      ["double-trouble.look", "effect.inspect"],
      ["double-trouble.may-reveal", "choice.optional"],
      ["double-trouble.recycle-rest", "effect.recycle"]
    ]
  );
});

test("unl-032-219 Double Trouble: the top-3 look reads an ordered pick, never a set query", () => {
  // "your Main Deck" is the caster's deck (190.6.d): the controller is bound
  // once, then read back by the look instruction.
  assert.deepEqual(bindInstruction.args.value, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  assert.deepEqual(bindInstruction.args.key, { kind: "constant", value: "controller" });
  assert.equal(bindInstruction.linkedTo, undefined);

  assert.equal(lookInstruction.op, "effect.inspect");
  assert.deepEqual(lookInstruction.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(lookInstruction.args.scope, { kind: "constant", value: "top" });
  assert.deepEqual(lookInstruction.args.player, {
    kind: "linked-value",
    instructionId: "double-trouble.bind-controller",
    key: "controller"
  });
  assert.equal(lookInstruction.linkedTo, "double-trouble.bind-controller");
  // 108.4.e / contract 3.6 / RIFT-358: deck order comes from the card's own
  // zoneSlice through the ordered pick lifecycle; effect.inspect refuses to
  // guess it from an unordered query.
  assert.deepEqual(viewedPick, {
    id: "double-trouble.viewed-cards",
    options: [],
    ordered: true,
    selection: "all",
    zoneSlice: {
      zone: "deck",
      from: "top",
      count: { kind: "constant", value: 3 }
    }
  });
});

test("unl-032-219 Double Trouble: 'You may reveal …' is a choice.optional body, not choice + linkedTo", () => {
  // Contract 3.9: the chosen instructions live inside choice.optional's body.
  assert.equal(mayReveal.op, "choice.optional");
  assert.equal(mayReveal.args.body.kind, "constant");
  assert.equal(mayReveal.linkedTo, "double-trouble.look");
  assert.deepEqual(
    mayReveal.args.body.value.map((instruction) => [instruction.id, instruction.op]),
    [
      ["double-trouble.reveal-unit", "effect.reveal"],
      ["double-trouble.draw-it", "effect.zone"]
    ]
  );

  // "reveal a unit from among them": a non-target pick (355.10.a: the Main
  // Deck is not a public zone) with the printed unit restriction, over the
  // looked-at cards.
  assert.equal(revealInstruction.linkedTo, "double-trouble.look");
  assert.deepEqual(revealInstruction.args.pick, {
    kind: "constant",
    value: "double-trouble.revealed-unit"
  });
  assert.deepEqual(revealedPick, {
    id: "double-trouble.revealed-unit",
    options: [{ kind: "linked-value", instructionId: "double-trouble.look", key: "viewed" }],
    filter: { type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "and draw it": 414.1.a's named-source add-to-hand is effect.zone to hand
  // (not effect.draw, which draws from the deck top).
  assert.equal(drawInstruction.linkedTo, "double-trouble.reveal-unit");
  assert.deepEqual(drawInstruction.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(drawnPick.options, [
    { kind: "linked-value", instructionId: "double-trouble.reveal-unit", key: "revealed" }
  ]);

  // "Recycle the rest." is an independent sentence over the looked-at set: the
  // card that left for Hand is stale (124) and drops out, leaving the rest
  // (417.1.a keeps them on the bottom of their owner's Main Deck).
  assert.equal(recycleInstruction.op, "effect.recycle");
  assert.equal(recycleInstruction.linkedTo, undefined);
  assert.deepEqual(recycleInstruction.args.objects, {
    kind: "linked-value",
    instructionId: "double-trouble.look",
    key: "viewed"
  });
  assert.equal(recycleInstruction.targets, undefined);
});

test("unl-032-219 Double Trouble golden: declining the reveal still recycles all three looked-at cards", () => {
  const kernel = deckWorld();
  lockViewed(kernel);
  kernel.setAnswers({ [MAY_ID]: false });

  const outcome = resolveChainBody(decodedBody(play.body), kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["double-trouble.bind-controller", "executed", null],
      ["double-trouble.look", "executed", null],
      ["double-trouble.may-reveal", "negated", "skipped"],
      ["double-trouble.recycle-rest", "executed", null]
    ]
  );
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
  // 417.1.a: the three looked-at cards land at the bottom, keeping their
  // relative order behind the untouched fourth card.
  assert.deepEqual(
    kernel.objectsInZone("A", "deck").map((ref) => ref.id),
    ["fourth-card", "top-card", "middle-card", "bottom-card"]
  );
  assert.equal(outcome.linkedValues["double-trouble.look.viewedCount"], 3);
  assert.equal(outcome.linkedValues["double-trouble.recycle-rest.recycledCount"], 3);
});

test("unl-032-219 Double Trouble golden: accepting reveals the chosen unit, draws it, and recycles the rest", () => {
  for (const [index, expectedId] of [[0, "top-card"], [1, "middle-card"], [2, "bottom-card"]]) {
    const kernel = deckWorld();
    const viewed = lockViewed(kernel);
    const chosen = viewed[index];
    kernel.setPicks(revealedPick.id, [chosen]);
    kernel.setPicks(drawnPick.id, [chosen]);
    kernel.setAnswers({ [MAY_ID]: true });

    const outcome = resolveChainBody(decodedBody(play.body), kernel);

    assert.deepEqual(
      outcome.results.map((entry) => [entry.id, entry.result.status]),
      [
        ["double-trouble.bind-controller", "executed"],
        ["double-trouble.look", "executed"],
        ["double-trouble.reveal-unit", "executed"],
        ["double-trouble.draw-it", "executed"],
        ["double-trouble.may-reveal", "executed"],
        ["double-trouble.recycle-rest", "executed"]
      ]
    );
    // 425.1.a.2: the reveal itself leaves the card in the deck; the named
    // "draw it" then puts that one card into hand.
    assert.deepEqual(kernel.objectsInZone("A", "hand").map((ref) => ref.id), [expectedId]);
    const rest = ["top-card", "middle-card", "bottom-card"].filter((id) => id !== expectedId);
    assert.deepEqual(
      kernel.objectsInZone("A", "deck").map((ref) => ref.id),
      ["fourth-card", ...rest]
    );
    // Nested bodies keep their own path-qualified link scope, so the reveal's
    // receipt is addressed through choice.optional's path.
    assert.equal(
      outcome.linkedValues["double-trouble.may-reveal/double-trouble.reveal-unit.revealedCount"],
      1
    );
    assert.equal(outcome.linkedValues["double-trouble.recycle-rest.recycledCount"], 2);
    assert.deepEqual(outcome.events.map((event) => event.action), [
      "look",
      "reveal",
      "return-to-hand",
      "recycle",
      "recycle"
    ]);
  }
});

test("unl-032-219 Double Trouble golden: the top scope refuses to guess deck order without ordered picks", () => {
  // Contract 3.6: without the ordered pick set the look range is empty — the
  // deck is never reordered by a guessed slice. The optional reveal has
  // nothing to pick from, so it is negated/impossible rather than showing or
  // drawing an invented card, and recycling the empty set is a legal no-op
  // (417.4).
  const kernel = deckWorld();
  kernel.setAnswers({ [MAY_ID]: true });

  const outcome = resolveChainBody(decodedBody(play.body), kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["double-trouble.bind-controller", "executed", null],
      ["double-trouble.look", "executed", null],
      ["double-trouble.reveal-unit", "negated", "impossible"],
      ["double-trouble.draw-it", "ignored", "mistargeted"],
      ["double-trouble.may-reveal", "negated", "impossible"],
      ["double-trouble.recycle-rest", "executed", null]
    ]
  );
  assert.equal(outcome.linkedValues["double-trouble.look.viewedCount"], 0);
  assert.equal(outcome.linkedValues["double-trouble.recycle-rest.recycledCount"], 0);
  assert.deepEqual(kernel.objectsInZone("A", "hand"), []);
  assert.deepEqual(
    kernel.objectsInZone("A", "deck").map((ref) => ref.id),
    ["top-card", "middle-card", "bottom-card", "fourth-card"]
  );
});

test("unl-032-219 Double Trouble golden: the card's zoneSlice source is locked by the merged ordered-pick lifecycle", () => {
  // Contract 3.6 / RIFT-358: orderedPickSpecs accepts the card's declaration
  // (options: [], ordered: true, selection: "all" plus exactly one zoneSlice),
  // and finalizeOrderedPickPlans locks the real deck-top references in order.
  // entity. This is the production surface the chain Finalize uses; the
  // reference kernel only receives the locked list.
  assert.deepEqual(orderedPickSpecs(play.body).map((spec) => spec.id), [viewedPick.id]);
  const kernel = deckWorld();
  const viewed = lockViewed(kernel);
  assert.deepEqual(
    viewed.map((ref) => ref.id),
    ["top-card", "middle-card", "bottom-card"]
  );
  // The locked slice keeps its real order, not the deck's later query order.
  assert.deepEqual(kernel.objectsInZone("A", "deck").map((ref) => ref.id), [
    "top-card",
    "middle-card",
    "bottom-card",
    "fourth-card"
  ]);
});

test.todo(
  "unl-032-219 Double Trouble: paying the [Repeat] 2-energy additional cost and executing the spell's " +
    "effect one extra time with re-made choices (CR 820.1.c.1 / 820.1.d.1 / 820.2) needs a KeywordAbility " +
    "parameter channel, a Repeat cost-plan consumer, and the resolution-side paid-count reader; made " +
    "choices must be re-asked"
);
