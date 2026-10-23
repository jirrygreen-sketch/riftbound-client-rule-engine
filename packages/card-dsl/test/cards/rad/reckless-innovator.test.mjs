// Golden test for Reckless Innovator (rad-105-167).
// The printed ability is [Accelerate] plus an object-exhausted "choose one" trigger.
// The structure, the merged effect.draw half of mode two and the token boundary are
// verified here; the production Accelerate/choice wiring and the success-gated
// payment body are still open (see judgeReason and the test.todo entries below).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/reckless-innovator.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import accelerate from "../../../../engine-core/dist/effects/keywords/Accelerate.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { translateCost } from "../../../../engine-core/dist/programs/play.js";
import { fixture as chainFixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-f5202df7168d19f18b45036939808e43056853194542d133c56127959e1b69c1";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
  "When I become exhausted, choose one —\n" +
  'Play a Gold gear token exhausted. (It has "[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.")' +
  "Pay :rb_rune_chaos: to draw 1.";

const [accelerateKeyword, exhaustedTrigger] = program.abilities;
const [choice] = exhaustedTrigger.body;
const [goldMode, payMode] = choice.args.modes.value;
const [playGold] = goldMode.body;
const [payChaos, drawOne] = payMode.body;

test("rad-105-167 Reckless Innovator: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-105-167 Reckless Innovator: judgeReason names the gaps and the dependent tasks", () => {
  assert.match(program.judgeReason, /Accelerate/);
  assert.match(program.judgeReason, /cost\.pay/);
  assert.match(program.judgeReason, /Gold/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /accelerate\.cost/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /additional-cost/);
  assert.match(program.judgeReason, /Additional costs are not bound/);
  assert.match(program.judgeReason, /Unsupported play cost field optional/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.match(program.judgeReason, /entersExhausted/);
  assert.match(program.judgeReason, /success-gated/);
  assert.match(program.judgeReason, /choice-plan/);
  assert.equal(/RIFT-\d+/.test(program.judgeReason), false);
});

test("rad-105-167 Reckless Innovator: [Accelerate] is one keyword declaration with a registered KeywordDef", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(accelerateKeyword, { kind: "keyword", keyword: "accelerate" });
  assert.equal(program.abilities.filter(ability => ability.kind === "static").length, 0);
  assert.equal(keywordDefinitionsById.get("Accelerate"), accelerate);
});

test("rad-105-167 Reckless Innovator: 'When I become exhausted' is the object-exhausted self trigger (415.1)", () => {
  assert.equal(exhaustedTrigger.kind, "triggered");
  assert.equal(exhaustedTrigger.trigger.at, "object-exhausted");
  assert.deepEqual(exhaustedTrigger.trigger.filter, { self: true });
  assert.equal(exhaustedTrigger.trigger.once, undefined);
  assert.equal(exhaustedTrigger.optional, false);
});

test("rad-105-167 Reckless Innovator: 'choose one —' is a single mode choice in printed order (355.3)", () => {
  assert.equal(exhaustedTrigger.body.length, 1);
  assert.equal(choice.id, "reckless-innovator.choose-one");
  assert.equal(choice.op, "choice.mode");
  assert.equal(choice.linkedTo, undefined);
  assert.deepEqual(choice.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(choice.args.different, { kind: "constant", value: true });
  assert.deepEqual(
    choice.args.modes.value.map(mode => mode.id),
    ["reckless-innovator.gold-mode", "reckless-innovator.pay-mode"]
  );
});

test("rad-105-167 Reckless Innovator: the Gold mode plays a Gold gear token exhausted (187.5, 440.2.c)", () => {
  assert.equal(goldMode.body.length, 1);
  assert.equal(playGold.id, "reckless-innovator.play-gold");
  assert.equal(playGold.op, "effect.token");
  assert.deepEqual(playGold.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(playGold.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(playGold.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playGold.args.entersExhausted, { kind: "constant", value: true });
  assert.deepEqual(playGold.args.locations.value, [{ type: "base", player: "controller" }]);
  assert.equal(playGold.linkedTo, undefined);
});

test("rad-105-167 Reckless Innovator: the chaos mode pays a Chaos power then draws 1 (355.10.c.1)", () => {
  assert.equal(payMode.body.length, 2);
  assert.equal(payChaos.id, "reckless-innovator.pay-chaos");
  assert.equal(payChaos.op, "cost.pay");
  assert.deepEqual(payChaos.args.payments, {
    kind: "constant",
    value: { energy: 0, power: ["Chaos"] }
  });
  assert.equal(drawOne.id, "reckless-innovator.draw-one");
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args.amount, {
    kind: "constant",
    value: { kind: "constant", value: 1 }
  });
  // The draw depends on the payment: without the paid cost it does not resolve.
  assert.equal(drawOne.linkedTo, payChaos.id);
});

test("rad-105-167 Reckless Innovator: 'Pay :rb_rune_chaos: to draw 1' draws through the merged effect.draw", () => {
  const kernel = world().deck("top-card").build();
  const run = runInstruction(draw, { amount: drawOne.args.amount.value }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 0);
});

// cost.pay is merged: inside a real ability transaction a successful Chaos
// payment commits and the linked draw resolves, while an unpaid attempt throws
// before any state change (CR 203.3). These goldens prove the payment and draw
// halves end to end; the success-gated body form named in judgeReason
// (cost/kinds/README.md contract change request #2) is still the open piece.
function payDrawFixture(playerValues = {}) {
  const kernel = world()
    .player("A", { energy: 0, power: [], ...playerValues })
    .hand("source", { types: ["spell"], energy: 0, power: [] })
    .deck("top-card")
    .build();
  return kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("source")) });
}

function payDrawTransaction(kernel) {
  let outcome;
  const definition = {
    op: "test.cost-ability-transaction",
    argsSchema: { parse: value => value },
    execute(context) {
      outcome = runAbilityBody(payMode.body, context);
      return { status: "executed", events: [...outcome.events] };
    }
  };
  return { ...runInstruction(definition, {}, { world: kernel }), outcome };
}

test("rad-105-167 Reckless Innovator golden: the pay mode commits a real Chaos payment then draws in one transaction", () => {
  const kernel = payDrawFixture({ power: ["Chaos"] });
  const run = payDrawTransaction(kernel);

  assert.equal(run.outcome.status, "executed");
  assert.deepEqual(
    run.outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["reckless-innovator.pay-chaos", "executed"],
      ["reckless-innovator.draw-one", "executed"]
    ]
  );
  assert.equal(kernel.linked("reckless-innovator.pay-chaos.payment").paid, true);
  assert.equal(kernel.linked("reckless-innovator.draw-one.drawn"), 1);
  // The source card starts in hand, so the successful draw makes two.
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 0);
});

test("rad-105-167 Reckless Innovator golden: without the Chaos power the payment throws and the transaction rolls back", () => {
  const kernel = payDrawFixture({ power: [] });
  const before = kernel.snapshot();

  assert.throws(
    () => payDrawTransaction(kernel),
    (error) => error instanceof CostPlanError && error.reason === "cannot-pay-cost"
  );
  assert.deepEqual(kernel.snapshot(), before);
  assert.equal(kernel.linked("reckless-innovator.pay-chaos.payment"), undefined);
  assert.equal(kernel.linked("reckless-innovator.draw-one.drawn"), undefined);
});

test("rad-105-167 Reckless Innovator: the Gold mode creates and plays the canonical token exhausted", () => {
  const kernel = world().build();
  const { locations: _locations, choiceId: _choiceId, ...goldArgs } = playGold.args;
  const run = runInstruction(
    token,
    {
      ...goldArgs,
      location: { kind: "constant", value: { type: "base", player: "A" } },
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked["goldToken.amount"], 1);
  assert.equal(run.linked["goldToken.createdAmount"], 1);
  assert.equal(run.linked.goldToken.blockedReason, undefined);
  const golds = kernel.objects.filter(object => object.isToken);
  assert.equal(golds.length, 1);
  assert.equal(golds[0].name, "Gold");
  assert.deepEqual(golds[0].types, ["gear"]);
  assert.equal(golds[0].zone, "board");
  assert.deepEqual(golds[0].location, { type: "base", player: "A" });
  assert.equal(golds[0].exhausted, true);

  // [Accelerate]'s KeywordDef (RIFT-266 series) is merged and expands to the
  // cost declaration plus the enter-ready replacement; the card-side consumer
  // remains the open RIFT-120 wiring named in judgeReason.
  const definition = keywordDefinitionsById.get("Accelerate");
  assert.equal(definition?.keyword, "Accelerate");
  const expansion = definition.expand({ host: { canonicalCardId: CANONICAL } });
  assert.deepEqual(expansion.map((ability) => ability.kind), ["static", "replacement"]);
  assert.equal(expansion[0].effect.kind, "accelerate.cost");
  assert.equal(expansion[1].replaces.event, "object-enters-board");
  assert.deepEqual(expansion[1].replaces.filter, {
    self: true,
    cardId: CANONICAL,
    exhausted: true
  });
});

test("rad-105-167 Reckless Innovator boundary: the Accelerate cost is also unbound on the play path", () => {
  // CR 356.2 / 805.2.b: the optional [1][C] is an additional cost. Both halves of
  // the production path refuse it before Finalize - the static declaration has no
  // layer mapping and the play translator never binds additional costs - so the
  // card-side accelerate.cost declaration cannot reach a payable plan.
  const expansion = accelerate.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion[0].effect.kind, "accelerate.cost");
  assert.equal(expansion[0].effect.cost.kind, "additional-cost");
  assert.equal(expansion[0].effect.cost.optional, true);
  assert.deepEqual(
    expansion[0].effect.cost.payments.map(payment => payment.kind),
    ["energy", "power"],
    "805.1.b.1: one Energy plus one Power matching the source domains"
  );
  assert.throws(
    () => translateCost(expansion[0].effect.cost, CANONICAL, "play"),
    (error) => error.code === "judge-required" && /Unsupported play cost field optional/.test(error.message)
  );
  // With the optional flag removed the same declaration is rejected as an
  // additional cost, so neither spelling binds today.
  const { optional, ...withoutOptional } = expansion[0].effect.cost;
  assert.equal(optional, true);
  assert.throws(
    () => translateCost(withoutOptional, CANONICAL, "play"),
    (error) => error.code === "judge-required" && /Additional costs are not bound/.test(error.message)
  );
});

test.todo(
  "rad-105-167 Reckless Innovator: execute the authored Gold choice through the production " +
    "choose-one chain lifecycle, including its exhausted entry stipulation (CR 187.5 / 184.1 / 185.2.d)"
);
test.todo(
  "rad-105-167 Reckless Innovator: keep the optional Accelerate additional-cost decision and its " +
    "success-gated result connected through Finalize and Resolve (CR 805.2.b / 805.6)"
);
test.todo(
  "rad-105-167 Reckless Innovator: cost.pay primitive for the ':rb_rune_chaos: to draw 1' cost within an " +
    "instruction (CR 355.10.c.1) is merged and executed in a real transaction above — the open piece is the " +
    "success-gated payment body (cost/kinds/README.md contract change request #2)"
);
test.todo(
  "rad-105-167 Reckless Innovator: Accelerate expansion consumed by the play pipeline (optional [1][C] " +
    "additional cost plus the delayed enter-ready replacement, CR 805.2.b/805.6) — RIFT-86's KeywordDef is " +
    "merged but the card-side accelerate.cost declaration still has no consumer"
);

test("rad-105-167 Reckless Innovator: the Accelerate static cost declaration has no layer mapping", () => {
  // CR 805.1.b: RIFT-266's KeywordDef expands to a static accelerate.cost plus a
  // replacement. The replacement half really does register through the merged
  // binding (asserted below), but the optional [1][C] additional cost is a static
  // ability that programs/statics.ts layerFor cannot map, so the payable side
  // never reaches the play pipeline.
  const kernel = world()
    .unit("innovator", { energy: 3, power: ["Chaos"], keywords: [{ id: "Accelerate" }], zone: "board" })
    .build();
  const source = kernel.getObject("innovator");
  const binder = createEngineStaticBinder({
    layers: { addContinuous() {}, removeContinuous() {}, currentTimingPoint: "cleanup-start" },
    pipeline: {
      host: {
        object: ref => kernel.objects.find(object => object.ref.id === ref.id) ?? null,
        objects: () => kernel.objects,
        context: () => kernel
      },
      registerReplacement() {}
    }
  });
  const expansion = accelerate.expand({ host: { canonicalCardId: CANONICAL } });

  assert.deepEqual(expansion.map(ability => ability.kind), ["static", "replacement"]);
  assert.throws(
    () => binder.bindStatic(expansion[0], source),
    (error) => error.code === "judge-required" &&
      /Static ability kind accelerate\.cost has no layer mapping/.test(error.message)
  );

  // The replacement side binds and cancels cleanly; the open gap is the cost.
  const handle = binder.bindReplacement(expansion[1], source);
  assert.equal(typeof handle.unbind, "function");
  handle.unbind();
});

test("rad-105-167 Reckless Innovator: the choose-one body reaches the merged chain and is blocked", () => {
  // CR 355.3: the mode choice is authored with choice.mode, which the merged
  // chain Finalize surface rejects until the Finalize/Resolve choice-plan
  // adapter exists.
  const fixture = chainFixture();
  const source = fixture.kernel.getObject("source");
  fixture.engine.pipeline.registerTrigger({
    id: "reckless-innovator",
    source,
    controller: "A",
    spec: { at: "object-exhausted", filter: {} },
    body: exhaustedTrigger.body,
    optional: false,
    activeZones: ["board"]
  });
  fixture.engine.pipeline.emit({ timingPoint: "object-exhausted", object: source });
  assert.equal(fixture.engine.items.length, 1);

  assert.throws(
    () => fixture.engine.advance(),
    (error) => error.status === "blocked" &&
      /Mode choices require a Finalize\/Resolve choice-plan adapter/.test(error.message)
  );
});

