import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/void-rush.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import costPay from "../../../../engine-core/dist/effects/instructions/cost.pay.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-cd92b45de0981074325a5119213251cd97706ab04339f5fe7339e69c8761258a";
const SOURCE_TEXT =
  "Reveal the top 2 cards of your Main Deck. You may play one of them, reducing its cost by " +
  ":rb_energy_2:. Draw any you did not play this way.";

const [play] = program.abilities;
const revealInstruction = play.body[0];
const costPlan = play.body[1];
const mayPlay = play.body[2];
const playInstruction = mayPlay.args.body.value[0];
const drawRest = play.body[3];

test("sfd-188-221 Void Rush: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README section 2: the reason names the concrete measured current gaps.
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /LITERAL_FIELDS/);
  assert.match(program.judgeReason, /Invalid cost\.modify modifier argument: value/);
  assert.match(program.judgeReason, /cost\.modify id must be a non-empty string/);
  assert.match(program.judgeReason, /linked 对象印刷费投影|FinalizedCostPlan/);
  assert.match(program.judgeReason, /420\.3/);
  assert.match(program.judgeReason, /414\.1/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-188-221 Void Rush structure: printed cost, ordered deck-top reveal, optional reduced play, remaining to hand", () => {
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["void-rush.reveal", "effect.reveal"],
      ["void-rush.cost-plan", "cost.modify"],
      ["void-rush.may-play", "choice.optional"],
      ["void-rush.draw-rest", "effect.zone"]
    ]
  );

  // "Reveal the top 2 cards of your Main Deck": the ordered slice is an
  // upstream pick because query order is never deck order; 432.1.c keeps an
  // under-full deck legal.
  assert.equal(revealInstruction.targets, undefined);
  assert.deepEqual(revealInstruction.args.pick, { kind: "constant", value: "void-rush.top-two" });
  assert.equal(revealInstruction.picks.length, 1);
  const [topTwo] = revealInstruction.picks;
  assert.equal(topTwo.id, "void-rush.top-two");
  assert.deepEqual(topTwo, {
    id: "void-rush.top-two",
    options: [],
    ordered: true,
    selection: "all",
    zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 2 } }
  });
});

test("sfd-188-221 Void Rush structure: the merged cost.modify really declares the [2] energy discount plan", () => {
  // CR 356.4: the reduction is a real plan step, not a cost-plan-request.
  // What the plan costs (the selected revealed card's printed cost) and how
  // the plan crosses into effect.play/Finalize remain blocked (judgeReason 1).
  assert.equal(costPlan.op, "cost.modify");
  assert.deepEqual(costPlan.args.id, { kind: "constant", value: "void-rush.cost-plan" });
  assert.deepEqual(costPlan.args.modifier, {
    kind: "constant",
    value: {
      kind: "reduce",
      resource: "energy",
      amount: { kind: "constant", value: 2 },
      minimum: { kind: "constant", value: 0 }
    }
  });
  assert.equal(costPlan.linkedTo, undefined);
  assert.equal(costPlan.picks, undefined);
});

test("sfd-188-221 Void Rush structure: the play inside the optional body names the reduced-cost requirement", () => {
  // One optional decision (contract 3.9) whose body holds the play of one
  // revealed card; the printed cost minus 2 is a cost-plan request that only
  // selected-card Finalize integration must materialize (see judgeReason).
  assert.equal(mayPlay.op, "choice.optional");
  assert.equal(mayPlay.linkedTo, "void-rush.reveal");
  assert.equal(mayPlay.args.body.kind, "constant");
  assert.equal(playInstruction.op, "effect.play");
  assert.deepEqual(playInstruction.args.pick, { kind: "constant", value: "void-rush.played-card" });
  assert.deepEqual(playInstruction.args.cost, {
    kind: "linked-value",
    instructionId: "void-rush.cost-plan",
    key: "cost"
  });
  assert.equal(playInstruction.picks.length, 1);
  const [played] = playInstruction.picks;
  assert.equal(played.id, "void-rush.played-card");
  assert.equal(played.selection, "one");
  assert.equal(played.min, 1);
  assert.equal(played.max, 1);
  assert.deepEqual(played.options, [
    { kind: "linked-value", instructionId: "void-rush.reveal", key: "revealed" }
  ]);
});

test("sfd-188-221 Void Rush structure: pending Draw names all remaining revealed refs independently of the optional play", () => {
  // Pending selected-card Draw intent. It is independent of accepting play.
  // effect.zone is not Draw; no execution claim is made for this blocked part.
  assert.equal(drawRest.op, "effect.zone");
  assert.equal(drawRest.linkedTo, undefined);
  assert.deepEqual(drawRest.args.pick, { kind: "constant", value: "void-rush.remaining" });
  assert.deepEqual(drawRest.args.to, { kind: "constant", value: "hand" });
  assert.deepEqual(drawRest.args.amount, { kind: "constant", value: 2 });
  assert.equal(drawRest.targets, undefined);
  assert.equal(drawRest.picks.length, 1);
  const [remaining] = drawRest.picks;
  assert.equal(remaining.id, "void-rush.remaining");
  assert.equal(remaining.selection, "all");
  assert.deepEqual(remaining, {
    id: "void-rush.remaining",
    options: [],
    ordered: true,
    selection: "all",
    linked: { kind: "linked-value", instructionId: "void-rush.reveal", key: "revealed" }
  });
});

test("sfd-188-221 Void Rush golden: the ordered deck-top reveal executes with a caller-supplied pick", () => {
  const kernel = world().deck(["c1", "c2", "c3"]).build();
  const topTwo = kernel.zoneSlice("A", "deck", "top", 2).map(object => object.ref);
  // The primitive itself executes the card's authored args when the ordered pick
  // is supplied (the missing producer is the Finalize lifecycle, see judgeReason).
  const run = runInstruction(reveal, { pick: "void-rush.top-two" }, {
    world: kernel,
    picks: { "void-rush.top-two": topTwo }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.revealed, topTwo);
  assert.equal(run.linked.revealedCount, 2);
  assert.deepEqual(run.events.map((event) => event.action), ["reveal", "reveal"]);
  // 425.1.a.2: revealed cards stay in the zone they were revealed from.
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["c1", "c2", "c3"]);
});

test("sfd-188-221 Void Rush golden: a short deck reveals what is there instead of failing (432.1.c)", () => {
  const kernel = world().deck(["only-card"]).build();
  const run = runInstruction(reveal, { pick: "void-rush.top-two" }, {
    world: kernel,
    picks: { "void-rush.top-two": kernel.zone("A", "deck") }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.revealedCount, 1);
  assert.deepEqual(run.linked.revealed, [kernel.ref("only-card")]);
});

test("Void Rush chain: the merged Finalize locks the ordered deck-top reveal source", () => {
  const f = fixture();
  f.engine.advance();
  const top = f.kernel.zoneSlice("A", "deck", "top", 2).map(object => object.ref);
  // The real production chain adapter captures the zoneSlice pick source at
  // Finalize and locks the ordered refs for resolution; the optional play and
  // pending draw stay blocked (see judgeReason 1 and 3).
  f.engine.enqueue({
    id: "void-rush-chain", kind: "triggered", controller: "A", source: f.kernel.getObject("source"),
    body: [revealInstruction]
  });
  f.engine.advance();
  assert.equal(f.engine.items[0].status, "finalized");
  assert.equal(f.engine.items[0].pickPlans.length, 1);
  assert.equal(f.engine.items[0].pickPlans[0].id, "void-rush.top-two");
  assert.deepEqual(f.engine.items[0].pickPlans[0].refs, top);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "card-revealed"), false);
  resolveAll(f.engine);
  assert.equal(f.engine.items.length, 0);
  assert.deepEqual(f.kernel.linked("void-rush.reveal.revealed"), top);
  // Revealed cards stay revealed where they are (425.1.a.2).
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id), ["A:deck:1", "A:deck:2", "A:deck:3", "A:deck:4"]);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "card-revealed").length, 2);
});

test("Void Rush primitive subpath: cost.modify freezes a genuine [2] Energy discount plan on an explicit printed cost", () => {
  const kernel = world().player("A", { energy: 20 }).hand("void-rush", { types: ["spell"], energy: 2, power: [] }).build();
  const run = runInstruction(costModify, {
    id: "void-rush.cost-plan",
    printed: { id: "void-rush", cardType: "Spell", energy: 2, power: 0, domains: [] },
    modifier: {
      kind: "reduce",
      resource: "energy",
      amount: { kind: "constant", value: 2 },
      minimum: { kind: "constant", value: 0 }
    }
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  const plan = run.linked.cost;
  assert.equal(plan.player, "A");
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, []);
  assert.equal(plan.finalized, true);
  assert.deepEqual(plan.discounts.map(value => [value.before, value.after]), [[2, 0]]);
});

test("Void Rush primitive subpath: cost.pay consumes the plan produced by cost.modify", () => {
  const kernel = world().player("A", { energy: 20 }).hand("void-rush", { types: ["spell"], energy: 2, power: [] }).build();
  const run = runInstruction(costModify, {
    id: "void-rush.cost-plan",
    printed: { id: "void-rush", cardType: "Spell", energy: 2, power: 0, domains: [] },
    modifier: {
      kind: "reduce",
      resource: "energy",
      amount: { kind: "constant", value: 2 },
      minimum: { kind: "constant", value: 0 }
    }
  }, { world: kernel });
  const paid = runInstruction(costPay, { cost: { kind: "constant", value: run.linked.cost } }, { world: kernel });
  assert.equal(paid.result.status, "executed");
  assert.equal(paid.linked.payment.total.energy, 0);
  // The [2] discount is consumed from the actual cost.modify result. The
  // selected-card plan handoff into effect.play remains the recorded gap.
  assert.equal(kernel.player("A").energy, 20);
  assert.deepEqual(kernel.events.map(event => event.action), ["pay"]);
});

test("Void Rush chain: the production adapter executes the original cost-plan IR on the Chain source", () => {
  const f = fixture();
  f.engine.advance();
  const outcome = resolveChainBody([costPlan], f.kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  const plan = outcome.linkedValues["void-rush.cost-plan.cost"];
  assert.equal(plan.finalized, true);
  assert.equal(plan.source.id, "source");
  assert.notEqual(plan.source.id, "void-rush");
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.discounts.map(({ before, after }) => ({ before, after })), [{ before: 1, after: 0 }]);
});

test("Void Rush chain: the production adapter resolves the reveal and cost plan together", () => {
  // Feed the card's real reveal + cost-plan body through the production chain
  // adapter. Both instructions now execute in order; the selected-card Play
  // handoff remains a separate judge-required gap.
  const f = fixture();
  f.engine.advance();
  f.engine.enqueue({
    id: "void-rush-body", kind: "triggered", controller: "A",
    source: f.kernel.getObject("source"), body: [revealInstruction, costPlan]
  });
  f.engine.advance();
  while (f.engine.items.length) f.engine.pass(f.engine.priority);
  assert.deepEqual(f.kernel.linked("void-rush.reveal.revealed").map(({ id }) => id), ["A:deck:1", "A:deck:2"]);
  assert.equal(f.engine.pipeline.events.filter((event) => event.timingPoint === "card-revealed").length, 2);
  assert.equal(f.kernel.zone("A", "deck").length, 4);
  assert.equal(f.kernel.player("A").handSize, 0);
  const plan = f.kernel.linked("void-rush.cost-plan.cost");
  assert.equal(plan.source.id, "source");
  assert.equal(plan.total.energy, 0);
});

test("Void Rush direct execution: the optional play cannot bind the reveal and the pending move-to-hand is not Draw", () => {
  // With the pick plans locked for the reveal, the merged interpreter resolves
  // the authored [reveal, optional play] body: the optional's body reads the
  // linked revealed refs, but the link scope is not visible from the nested
  // instruction, so the play is ignored and nothing moves to hand.
  const kernel = world().player("A", { energy: 20 }).deck(["c1", "c2", "c3", "c4"]).build();
  kernel.setAnswers({ "void-rush.may-play/optional": true });
  // The reveal's ordered pick comes from the Finalize lock in the production
  // path; here the direct interpreter call supplies the same locked refs so the
  // optional branch itself is what is being measured.
  const top = kernel.zoneSlice("A", "deck", "top", 2).map((object) => object.ref);
  const outcome = resolveChainBody([revealInstruction, mayPlay], kernel, {
    picks: (id) => id === "void-rush.top-two" ? top : undefined
  });
  assert.deepEqual(kernel.linked("void-rush.reveal.revealed"), top);
  assert.equal(kernel.linked("void-rush.reveal.revealedCount"), 2);
  assert.equal(kernel.zone("A", "deck").length, 4);
  assert.equal(kernel.zone("A", "hand").length, 0);
  // The optional body's own play is measured as ignored(mistargeted): the card
  // was supposed to be played from the locked reveal, but no revealed card is
  // reachable as a playable pick from the nested instruction.
  assert.deepEqual(outcome.results.map((entry) => [entry.path.join("/"), entry.result.status, entry.result.reason]), [
    ["void-rush.reveal", "executed", undefined],
    ["void-rush.may-play/void-rush.play", "ignored", "mistargeted"],
    ["void-rush.may-play", "ignored", "mistargeted"]
  ]);
  // The pending move-to-hand declaration is not a draw: with the reveal link
  // present, the ordered pick resolver still cannot address the unplayed refs
  // as a Draw set, and no card-drawn event is produced (414.1).
  const linked = world().player("A", { energy: 20 }).deck(["d1", "d2", "d3", "d4"]).build();
  linked.link("void-rush.reveal.revealed", linked.zoneSlice("A", "deck", "top", 2).map((object) => object.ref));
  const drawRun = resolveChainBody([drawRest], linked);
  assert.equal(drawRun.results[0].result.status, "ignored");
  assert.equal(linked.zone("A", "hand").length, 0);
  assert.equal(linked.events.filter((event) => event.action === "draw").length, 0);
});
