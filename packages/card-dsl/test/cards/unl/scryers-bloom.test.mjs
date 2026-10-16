import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/scryers-bloom.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", ENGINE));
const { buildCostPlan } = await import(new URL("cost/cost-plan.js", ENGINE));
const { payCostPlan } = await import(new URL("cost/payment.js", ENGINE));
const { world } = await import(new URL("effects/testing/index.js", ENGINE));

const CANONICAL_ID =
  "card.hash-12391b1b0c8fa259528e28974f6a47bd51892b5b66931b7c3529759298d8deb7";
const SOURCE_TEXT =
  "This enters exhausted.\n" +
  "Kill this, :rb_energy_1:, :rb_exhaust:: [Predict 2], then draw 1. Gain 1 XP.  " +
  "(To Predict 2, look at the top two cards of your Main Deck. Recycle any of them and put the rest back in any order.)";

const [replacement, activated] = program.abilities;
const [enterExhausted] = replacement.with;
const [look, recycle, putBack, draw, gainXp] = activated.body;

// effect.inspect issues its select request with the choiceId the card declares;
// the interpreter prefixes it with the execution path.
const SELECT_ID = "scryers-bloom.predict-look/scryers-bloom.predict";
/** effect.order 的排序请求 id（原语固定形状：effect.order:<destination>:<player>）。 */
const PUT_BACK_ORDER_ID = "scryers-bloom.predict-put-back/effect.order%3Atop%3AA";

test("unl-136-219 Scryer's Bloom: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-136-219 Scryer's Bloom: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /149\.1/);
  assert.match(program.judgeReason, /zoneSlice/);
  assert.match(program.judgeReason, /effect\.inspect/);
  assert.match(program.judgeReason, /RIFT-102/);
  assert.equal(/待实现|需要裁定/.test(program.judgeReason), false);
});

test("unl-136-219 Scryer's Bloom: 'This enters exhausted' is an entry-state rewrite, not an exhaust action", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(replacement.kind, "replacement");
  // 149.1 / 359.2.d: non-unit Gear enters ready; the printed text rewrites it.
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  assert.equal(replacement.condition, undefined);
  assert.equal(replacement.with.length, 1);
  assert.equal(enterExhausted.id, "scryers-bloom.enter-exhausted");
  assert.equal(enterExhausted.op, "replacement.enter");
  assert.deepEqual(enterExhausted.args.state, { kind: "constant", value: "exhausted" });
  assert.deepEqual(enterExhausted.args.zone, { kind: "constant", value: "board" });
});

test("unl-136-219 Scryer's Bloom: the activation cost is Kill this, 1 Energy, and the exhaust symbol", () => {
  assert.equal(activated.kind, "activated");
  // 151 / 151.2: Gear activated abilities default to action speed.
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost.energy, { kind: "constant", value: 1 });
  // 357.2 lets non-standard costs be paid in any order; only exhaust-then-kill can
  // complete, because killing the source first invalidates the exhaust payment
  // (415.4 requires the exhaust cost to be completable).
  assert.deepEqual(activated.cost.payments, [{ kind: "exhaust" }, { kind: "kill" }]);
});

test("unl-136-219 Scryer's Bloom: Predict 2 is inspect(2) -> recycle(chosen) -> order(top, 2 - recycled)", () => {
  assert.deepEqual(activated.body.map(instruction => instruction.id), [
    "scryers-bloom.predict-look",
    "scryers-bloom.predict-recycle",
    "scryers-bloom.predict-put-back",
    "scryers-bloom.draw",
    "scryers-bloom.gain-xp"
  ]);

  // 437.1 / 437.1.a: look at the top 2 and choose any of them to recycle.
  assert.equal(look.op, "effect.inspect");
  assert.equal(look.args.scope.value, "top");
  assert.deepEqual(look.args.zone, { kind: "constant", value: "deck" });
  assert.deepEqual(look.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(look.args.choose, { kind: "constant", value: true });
  assert.deepEqual(look.args.chooseCount, { kind: "constant", value: { min: 0, max: 2 } });
  // 190.6.d "your Main Deck": the viewer is the ability's controller, written
  // with the contract 3.6 symbolic selector (the merged argsSchema still
  // requires a runtime ObjectRef there — see judgeReason point 3).
  assert.deepEqual(look.args.player, {
    kind: "object-property",
    object: "source",
    property: "controller"
  });
  // 437.1.a: the ordered top-2 source is supplied upstream under this stable id.
  assert.deepEqual(look.args.picksSpecId, {
    kind: "constant",
    value: "scryers-bloom.predict-top-2"
  });
  assert.equal(look.linkedTo, undefined);

  // 417.1.b / 417.4: recycle the chosen cards; choosing none is a successful no-op.
  assert.equal(recycle.op, "effect.recycle");
  assert.deepEqual(recycle.args.objects, {
    kind: "linked",
    instructionId: "scryers-bloom.predict-look",
    key: "predict-recycle"
  });
  assert.equal(recycle.linkedTo, "scryers-bloom.predict-look");

  // 437.1.a: put the rest back on top in any order; the count is computed, not
  // hard-coded (2 - actually recycled).
  assert.equal(putBack.op, "effect.order");
  assert.equal(putBack.linkedTo, "scryers-bloom.predict-recycle");
  assert.deepEqual(putBack.args.destination, { kind: "constant", value: "top" });
  assert.deepEqual(putBack.args.count, {
    kind: "arithmetic",
    operator: "sub",
    operands: [
      { kind: "constant", value: 2 },
      {
        kind: "linked-value",
        instructionId: "scryers-bloom.predict-recycle",
        key: "recycledCount"
      }
    ]
  });
  assert.deepEqual(putBack.args.chooseOrder, { kind: "constant", value: true });

  // 414.3 / 730.1: "then draw 1" and "Gain 1 XP" are independent sentences.
  assert.equal(draw.op, "effect.draw");
  assert.deepEqual(draw.args.amount, { kind: "constant", value: 1 });
  assert.equal(draw.linkedTo, undefined);
  assert.equal(gainXp.op, "effect.xp");
  assert.deepEqual(gainXp.args.amount, { kind: "constant", value: 1 });
  assert.equal(gainXp.linkedTo, undefined);
});

test("unl-136-219 Scryer's Bloom golden: the printed cost is payable through the merged cost pipeline", () => {
  const kernel = world()
    .player("A", { energy: 1 })
    .unit("scryers-bloom", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      controller: "A",
      owner: "A",
      exhausted: false
    })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("scryers-bloom") });
  const plan = buildCostPlan(context, { id: "scryers-bloom:predict", cost: activated.cost });
  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.total.power, []);
  assert.deepEqual(plan.total.actions.map(cost => cost.action.type), ["exhaust", "kill"]);

  const receipt = payCostPlan(context, plan);
  assert.equal(receipt.paid, true);
  assert.equal(context.player("A").energy, 0);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust", "kill"]);
  // 429: the cost kills the source. Its pre-kill reference is a stale Board
  // identity (the card's Trash identity carries a new zoneEntryId), and the
  // source snapshot stays the last known Board information (359.3.e.13).
  assert.equal(context.object(context.source.ref), null);
  assert.equal(context.lastKnown(context.source.ref).zone, "board");
  assert.equal(context.getObject("scryers-bloom").zone, "trash");
});

/** Supplies only the two missing bindings the judgeReason names (viewer + ordered top 2). */
function predictBodyFor(player) {
  return activated.body.map(instruction =>
    instruction.id === "scryers-bloom.predict-look"
      ? {
          ...instruction,
          args: {
            ...instruction.args,
            player: { kind: "constant", value: player }
          }
        }
      : instruction
  );
}

test("unl-136-219 Scryer's Bloom golden: Predict 2 runs the merged inspect/recycle/order with ordered top picks", () => {
  const kernel = world().deck(["top", "second", "third"]).build();
  const top = kernel.ref("top");
  kernel.setPicks("scryers-bloom.predict-top-2", [top, kernel.ref("second")]);
  // 437.1.a: "Recycle any of them" — here the player recycles exactly the top card.
  kernel.setAnswers({ [SELECT_ID]: [top], [PUT_BACK_ORDER_ID]: [kernel.ref("second")] });

  const body = predictBodyFor("A").slice(0, 3);
  const outcome = resolveChainBody(body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["scryers-bloom.predict-look", "executed"],
    ["scryers-bloom.predict-recycle", "executed"],
    ["scryers-bloom.predict-put-back", "executed"]
  ]);
  // 437.1.a: two cards were looked at; 417.1.b: the chosen one went to the bottom;
  // the remaining card was put back on top (417.5.a / effect.order).
  assert.deepEqual(kernel.events.map(event => event.action), ["look", "recycle", "order-top"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second", "third", "top"]);
  assert.equal(outcome.linkedValues["scryers-bloom.predict-look.inspected"], 2);
  assert.equal(outcome.linkedValues["scryers-bloom.predict-recycle.recycledCount"], 1);
});

test("unl-136-219 Scryer's Bloom golden: declining to recycle keeps both predicted cards, then draws 1 and gains 1 XP", () => {
  const kernel = world().deck(["top", "second", "third", "fourth"]).build();
  kernel.setPicks("scryers-bloom.predict-top-2", [kernel.ref("top"), kernel.ref("second")]);
  kernel.setAnswers({
    [SELECT_ID]: [],
    [PUT_BACK_ORDER_ID]: [kernel.ref("top"), kernel.ref("second")]
  });

  const outcome = resolveChainBody(activated.body.map(instruction =>
    instruction.id === "scryers-bloom.predict-look"
      ? { ...instruction, args: { ...instruction.args, player: { kind: "constant", value: "A" } } }
      : instruction
  ), kernel);

  assert.equal(outcome.status, "executed");
  // 437.1.a: nothing was recycled, so both predicted cards were put back on top
  // in the chosen order; "then draw 1" then takes the topmost one (414.1) and
  // "Gain 1 XP" is an independent sentence (414.3 / 730.1).
  assert.equal(kernel.getObject("top").zone, "hand");
  assert.equal(kernel.getObject("second").zone, "deck");
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second", "third", "fourth"]);
  assert.equal(kernel.player("A").deckSize, 3);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").xp, 1);
  assert.deepEqual(kernel.events.map(event => event.action), ["look", "order-top", "draw", "gain-xp"]);
});

test("unl-136-219 Scryer's Bloom golden: a one-card Main Deck predicts as much as possible and still draws and gains XP (437.4)", () => {
  const kernel = world().deck(["only-card"]).build();
  kernel.setPicks("scryers-bloom.predict-top-2", [kernel.ref("only-card")]);
  kernel.setAnswers({
    [SELECT_ID]: [],
    [PUT_BACK_ORDER_ID]: [kernel.ref("only-card")]
  });

  const outcome = resolveChainBody(predictBodyFor("A"), kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").deckSize, 0);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").xp, 1);
});

test.todo(
  "unl-136-219 Scryer's Bloom: 'This enters exhausted.' needs the board-entry replacement primitive " +
    "(replacement.enter, contract 3.4/3.5) plus the card-IR registration path; effect.exhaust after entry " +
    "would add a spurious becomes-exhausted event and miss the entry replacement (CR 149.1 / 359.2.d)"
);
test.todo(
  "unl-136-219 Scryer's Bloom: supply the ordered top-2 range for [Predict 2] from the real Main Deck order " +
    "(CR 437.1.a, contract 3.6 zoneSlice) — the merged effect.inspect still rejects unordered query lookups"
);
test.todo(
  "unl-136-219 Scryer's Bloom: sync effect.inspect's argsSchema with contract 3.6 so the viewer can be the " +
    "symbolic source-controller selector instead of a runtime ObjectRef (RIFT-102 validator closure)"
);
