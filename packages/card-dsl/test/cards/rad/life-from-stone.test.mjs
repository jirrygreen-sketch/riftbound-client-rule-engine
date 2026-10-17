import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/life-from-stone.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));
const { default: channel } = await import(new URL("effects/instructions/effect.channel.js", engineCore));
const { default: draw } = await import(new URL("effects/instructions/effect.draw.js", engineCore));

const { buildCostPlan } = await import(new URL("cost/cost-plan.js", engineCore));
const { translateCost } = await import(new URL("programs/play.js", engineCore));
const { payCostPlan } = await import(new URL("cost/payment.js", engineCore));
const { abilitySpeed } = await import(new URL("programs/keywords.js", engineCore));

const CANONICAL = "card.hash-0b434d5de4e3431420a6dddfc3ed5c57570643467c671f4efae850ed1f9905ea";
const [keyword, play] = program.abilities;
const [drawInstruction, channelInstruction] = play.body;

test("rad-029-167 Life from Stone: program passes validateCardProgram and keeps the printing text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "As an additional cost to play this, exhaust a friendly unit.\n" +
      "Draw 1 and channel 1 rune exhausted."
  );
});

test("rad-029-167 Life from Stone: judge-required naming the missing additional-cost path", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /356\.2/);
  assert.match(program.judgeReason, /mandatoryAdditional/);
  assert.match(program.judgeReason, /choiceObjects/);
  assert.match(program.judgeReason, /translateCost/);
  // Re-probed 2026-10-17: the placeholder option still throws at plan build,
  // and RIFT-358's ordered picks do not cover a filtered board cost pick.
  assert.match(program.judgeReason, /Cost requires an exact object reference/);
  assert.match(program.judgeReason, /RIFT-358/);
});

test("rad-029-167 Life from Stone boundary: the declared cost placeholder is rejected by the real planner", () => {
  // The card's cost.printed payment choice only names "ready-friendly-unit";
  // cost/plan-values.ts maps choice.options through reference(), which requires
  // an exact ObjectRef, so the production plan cannot even be built (355.10.c.1).
  const kernel = world().player("A", { energy: 1 })
    .hand("spell", { types: ["spell"], energy: 1, power: null })
    .unit("ally", { exhausted: false }).build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("spell") });
  const translated = translateCost(play.cost, "life-from-stone", "play");
  assert.throws(
    () => buildCostPlan(scoped, { id: "life:cost", cost: translated }),
    /Cost requires an exact object reference/
  );
});

test("rad-029-167 Life from Stone: [Reaction], a mandatory exhaust cost, then Draw 1 and channel 1 exhausted", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "reaction" });
  assert.deepEqual(play.cost.energy, { kind: "constant", value: 1 });
  assert.equal(Object.hasOwn(play.cost, "power"), false);

  assert.equal(play.cost.payments.length, 1);
  const [payment] = play.cost.payments;
  assert.equal(payment.kind, "exhaust");
  assert.deepEqual(payment.choice, {
    id: "life-from-stone.exhausted-unit",
    options: ["ready-friendly-unit"],
    min: 1,
    max: 1,
    selection: "one",
    filter: { zone: "board", type: "unit", controller: "self", states: "ready" }
  });

  assert.deepEqual(play.body.map((instruction) => instruction.id), [
    "life-from-stone.draw-1",
    "life-from-stone.channel-1"
  ]);
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args.amount, { kind: "constant", value: 1 });
  // "Draw 1 and channel 1 rune exhausted" is one clause: the channel is linked.
  assert.equal(channelInstruction.op, "effect.channel");
  assert.deepEqual(channelInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channelInstruction.args.exhausted, { kind: "constant", value: true });
  assert.equal(channelInstruction.linkedTo, "life-from-stone.draw-1");
});

test("rad-029-167 Life from Stone golden: Draw 1 then channel 1 rune exhausted", () => {
  const kernel = world()
    .deck(["deck-1", "deck-2"])
    .rune(["rune-1", "rune-2"])
    .build();
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [
      ["life-from-stone.draw-1", "executed"],
      ["life-from-stone.channel-1", "executed"]
    ]
  );
  // CR 414.1: one card moves from the top of the Main Deck to hand.
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["deck-1"]);
  // CR 431.1/431.2: one rune leaves the Rune Deck for the rune zone.
  assert.equal(outcome.linkedValues["life-from-stone.channel-1.channeled"], 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.deepEqual(kernel.zone("A", "rune-zone").map((ref) => ref.id), ["rune-1"]);
});

test("rad-029-167 Life from Stone golden: an empty Rune Deck still draws (CR 431.3 shortfall)", () => {
  const kernel = world().deck(["deck-1", "deck-2"]).build();
  const outcome = resolveChainBody(play.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(outcome.linkedValues["life-from-stone.channel-1.channeled"], 0);
  assert.equal(kernel.player("A").runeDeckSize, 0);
  assert.deepEqual(kernel.zone("A", "rune-zone"), []);
});

test("rad-029-167 Life from Stone golden: the two body instructions each run on their own primitive", () => {
  // The individual primitives are merged; running them separately pins the
  // executed actions (draw, channel-rune) without claiming the cost was paid.
  const kernel = world().deck(["deck-1"]).rune(["rune-1"]).build();
  const drawn = runInstruction(draw, { amount: drawInstruction.args.amount }, { world: kernel });
  assert.equal(drawn.result.status, "executed");
  assert.deepEqual(drawn.events.map((event) => event.action), ["draw"]);

  const channeled = runInstruction(
    channel,
    { amount: channelInstruction.args.amount, exhausted: channelInstruction.args.exhausted },
    { world: kernel }
  );
  assert.equal(channeled.result.status, "executed");
  assert.equal(channeled.linked.channeled, 1);
  assert.deepEqual(channeled.events.map((event) => event.action), ["channel-rune"]);
});

test.todo('Life from Stone: Finalize preserves the mandatory additional exhaust component under ignore-base/ignore-all (CR 356.2/356.5), with filtered non-target cost picks from PickSpec.filter.');

test("Life from Stone: the merged cost planner really pays a bound mandatory exhaust cost", () => {
  const kernel = world().player("A", { energy: 1 })
    .hand("spell", { types: ["spell"], energy: 1, power: null })
    .unit("ally", { exhausted: false }).deck("card").rune("rune").build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("spell") });
  // Runtime references belong to the cost owner, not to the static CardProgram.
  // This verifies the planner/payment half; the card's filtered binding stays TODO.
  const payment = play.cost.payments[0];
  scoped.setPicks(payment.choice.id, [scoped.ref("ally")]);
  const plan = buildCostPlan(scoped, {
    id: "life:cost", cost: { kind: "printed" },
    mandatoryAdditional: [{ id: "exhaust-ally", cost: { payments: [{
      ...payment, choice: { ...payment.choice, options: [scoped.ref("ally")] }
    }] } }]
  });
  assert.deepEqual(plan.components.map(component => component.stage), ["base", "mandatory-additional"]);
  assert.equal(plan.total.energy, 1);
  assert.equal(abilitySpeed(program.abilities, scoped.source), "reaction");
  const receipt = payCostPlan(scoped, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(receipt.actions.map(entry => entry.action.type), ["pay", "exhaust"]);
  assert.equal(scoped.player("A").energy, 0);
  assert.equal(scoped.getObject("ally").exhausted, true);
  assert.equal(scoped.player("A").handSize, 1);
  assert.equal(scoped.player("A").runeDeckSize, 1);
});
