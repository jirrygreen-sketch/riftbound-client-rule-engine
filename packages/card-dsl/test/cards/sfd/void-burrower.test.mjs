import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/void-burrower.js";

import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

import { buildExhaustCostPlan, canPayCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";

const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { runAbilityBody } = await import(new URL("effects/interpreter.js", ENGINE));
const { instructionDefinitionsById } = await import(new URL("effects/instructions/registry.generated.js", ENGINE));
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const exhaust = (await import(new URL("effects/instructions/effect.exhaust.js", ENGINE))).default;
const play = (await import(new URL("effects/instructions/effect.play.js", ENGINE))).default;
const reveal = (await import(new URL("effects/instructions/effect.reveal.js", ENGINE))).default;
const recycle = (await import(new URL("effects/instructions/effect.recycle.js", ENGINE))).default;

const CANONICAL_ID = "card.hash-289ad4d681c7cb59dd55bae00863be7516f68dff172a97e886f4ff7920625b0c";
const SOURCE_TEXT =
  "When you conquer, you may exhaust me to reveal the top 2 cards of your Main Deck. " +
  "You may play one. Then recycle the rest.";

const [ability] = program.abilities;
const [exhaustSelf, revealTopTwo, mayPlay, recycleRest] = ability.body;
const [playOne] = mayPlay.args.body.value;

function conquerWorld() {
  const base = world()
    .deck(["d1", "d2", "d3"])
    .object("void-burrower", { cardId: CANONICAL_ID, zone: "board", types: ["legend"] })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("void-burrower") });
}

// These are separate supported interpreter entry points, with the card's
// instructions unchanged. The direct interpreter accepts reveal's literal pick;
// the production chain adapter handles the optional play/recycle suffix's Exprs.
// This does not execute the blocked leading-cost/Finalize path or establish that
// the reference kernel's Play has paid the selected card's printed cost.
function revealForSuffix(kernel) {
  kernel.setPicks(revealTopTwo.args.pick.value, kernel.zoneSlice("A", "deck", "top", 2).map(object => object.ref));
  return runAbilityBody([revealTopTwo], kernel, instructionDefinitionsById);
}

test("sfd-187-221 Void Burrower: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("sfd-187-221 Void Burrower: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The four recorded blockers, including the identity's printing difference.
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /mayAtFinalize/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.match(program.judgeReason, /sfd-243-221/);
  assert.match(program.judgeReason, /428\.1/);
});

test("sfd-187-221 Void Burrower: conquer trigger, leading may, exhaust, reveal, play, recycle in printed order", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.c.2.b / 190.6.d: "you conquer" is this ability's controller conquering;
  // the closed EventPattern spelling is "conquered".
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, { event: "conquered", player: "self" });
  // 383.3.a: the leading "you may" is the ability's own Finalize decision.
  assert.equal(ability.optional, true);
  assert.equal(ability.trigger.once, undefined);

  assert.deepEqual(ability.body.map((instruction) => [instruction.id, instruction.op]), [
    ["void-burrower.exhaust-self", "effect.exhaust"],
    ["void-burrower.reveal-top-two", "effect.reveal"],
    ["void-burrower.may-play-one", "choice.optional"],
    ["void-burrower.recycle-rest", "effect.recycle"]
  ]);

  // 383.3.b / 355.10.c.1: "exhaust me" is the trigger's base cost and is not a
  // target, so it is a non-target choose anchored to the source.
  assert.deepEqual(exhaustSelf.args, {
    choose: {
      kind: "constant",
      value: { id: "void-burrower.exhaust-self", filter: { object: "self" } }
    }
  });
  assert.equal(exhaustSelf.targets, undefined);
  assert.equal(exhaustSelf.picks, undefined);
  assert.equal(exhaustSelf.linkedTo, undefined);

  // 425.1 / 425.3.a: the top two are an ordered pick, never a count over a set
  // query (effect.reveal refuses that shape outright).
  assert.deepEqual(revealTopTwo.args, { pick: { kind: "constant", value: "void-burrower.top-two" } });
  assert.deepEqual(revealTopTwo.picks, [
    {
      id: "void-burrower.top-two",
      options: [],
      ordered: true,
      selection: "all",
      zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 2 } }
    }
  ]);
  assert.equal(revealTopTwo.targets, undefined);

  // 383.3.a.3 / contract 3.9: the later "You may play one" is one choice.optional
  // whose body holds the chosen instruction (never a bare choice plus a linkedTo
  // consumer).
  assert.equal(mayPlay.op, "choice.optional");
  assert.equal(mayPlay.args.body.kind, "constant");
  assert.deepEqual(mayPlay.args.body.value.map((instruction) => [instruction.id, instruction.op]), [
    ["void-burrower.play-one", "effect.play"]
  ]);
  assert.equal(mayPlay.linkedTo, undefined);
  // 420.3.a / 420.3.b: the play reads the revealed cards as a non-target pick and
  // supplies no cost override, leaving the printed Play procedure to pay the
  // card's own cost.
  assert.equal(playOne.picks[0].id, "void-burrower.play-one");
  assert.deepEqual(playOne.picks[0].options, [
    { kind: "linked-value", instructionId: "void-burrower.reveal-top-two", key: "revealed" }
  ]);
  assert.deepEqual(playOne.args.choice, {
    kind: "constant",
    value: { id: "void-burrower.play-one-choice", min: 1, max: 1 }
  });
  assert.equal(playOne.args.cost, undefined);
  assert.equal(playOne.args.location, undefined);

  // 417.1.a / 417.4: "Then recycle the rest" recycles the revealed set; the played
  // card's stale deck identity drops out by 124, and the instruction is not linked
  // to the optional play (359.3.e.11).
  assert.deepEqual(recycleRest.args, {
    objects: { kind: "linked-value", instructionId: "void-burrower.reveal-top-two", key: "revealed" }
  });
  assert.equal(recycleRest.linkedTo, undefined);
});

test("sfd-187-221 Void Burrower: the merged reveal primitive accepts the ordered pick and links real refs", () => {
  // 425.1.a.2: revealing leaves the cards where they are; only the ordered pick
  // carries the real top-of-deck order (contract 3.6 zoneSlice).
  const kernel = world().deck(["d1", "d2", "d3"]).build();
  const topTwo = kernel.zoneSlice("A", "deck", "top", 2).map((object) => object.ref);
  const run = runInstruction(reveal, { pick: "void-burrower.top-two" }, {
    world: kernel,
    picks: { "void-burrower.top-two": topTwo }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.revealedCount, 2);
  assert.deepEqual(run.linked.revealed.map((ref) => ref.id), ["d1", "d2"]);
  assert.deepEqual(run.events.map((event) => event.action), ["reveal", "reveal"]);
  assert.equal(kernel.player("A").deckSize, 3);
});

test("Void Burrower supported reveal/play/recycle subpaths: accepting plays one and recycles the rest", () => {
  const kernel = conquerWorld();
  const receipt = payCostPlan(kernel, buildExhaustCostPlan(kernel, { object: kernel.ref("void-burrower") }, { id: "burrower-exhaust" }));
  assert.equal(receipt.paid, true);
  const revealed = revealForSuffix(kernel);
  assert.equal(revealed.status, "executed");
  const refs = revealed.linkedValues["void-burrower.reveal-top-two.revealed"];
  assert.deepEqual(refs, [kernel.ref("d1"), kernel.ref("d2")]);
  kernel.setPicks(playOne.picks[0].id, refs);
  kernel.setAnswers({
    "void-burrower.may-play-one/optional": true,
    "void-burrower.may-play-one/void-burrower.play-one/void-burrower.play-one-choice": [refs[0]]
  });
  const outcome = resolveChainBody(ability.body.slice(2), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual([...revealed.results, ...outcome.results].map(result => [result.id, result.result.status]), [
    ["void-burrower.reveal-top-two", "executed"],
    ["void-burrower.play-one", "executed"],
    ["void-burrower.may-play-one", "executed"],
    ["void-burrower.recycle-rest", "executed"]
  ]);
  assert.equal(kernel.getObject("void-burrower").exhausted, true);
  assert.deepEqual(kernel.zone("A", "board").map(ref => ref.id), ["void-burrower", "d1"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["d3", "d2"]);
  assert.deepEqual(kernel.events.map(event => event.action), ["pay", "exhaust", "reveal", "reveal", "play", "recycle"]);
  assert.equal(outcome.results.at(-1).result.linkedValues.recycledCount, 1);
  assert.equal(outcome.linkedValues["void-burrower.may-play-one/void-burrower.play-one.played"], 1);
  assert.equal(kernel.object(refs[0]), null);
});

test("Void Burrower supported reveal/play/recycle subpaths: declining still recycles every revealed card", () => {
  const kernel = conquerWorld();
  const receipt = payCostPlan(kernel, buildExhaustCostPlan(kernel, { object: kernel.ref("void-burrower") }, { id: "burrower-exhaust" }));
  assert.equal(receipt.paid, true);
  const revealed = revealForSuffix(kernel);
  assert.equal(revealed.status, "executed");
  kernel.setAnswers({ "void-burrower.may-play-one/optional": false });
  const outcome = resolveChainBody(ability.body.slice(2), kernel);

  assert.deepEqual([...revealed.results, ...outcome.results].map(result => [result.id, result.result.status, result.result.reason ?? null]), [
    ["void-burrower.reveal-top-two", "executed", null],
    ["void-burrower.may-play-one", "negated", "skipped"],
    ["void-burrower.recycle-rest", "executed", null]
  ]);
  assert.equal(kernel.getObject("void-burrower").exhausted, true);
  assert.deepEqual(kernel.zone("A", "board").map(ref => ref.id), ["void-burrower"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["d3", "d1", "d2"]);
  assert.equal(outcome.results.at(-1).result.linkedValues.recycledCount, 2);
  assert.deepEqual(kernel.events.map(event => event.action), ["pay", "exhaust", "reveal", "reveal", "recycle", "recycle"]);
});

test("Void Burrower supported recycle subpath: the played card's stale deck identity is excluded", () => {
  const kernel = world().deck(["d1", "d2"]).build();
  const [first, second] = kernel.zoneSlice("A", "deck", "top", 2).map(object => object.ref);
  // Invoke the real Play primitive rather than settling the play in the fixture.
  const played = runInstruction(play, { pick: playOne.args.pick.value, choice: playOne.args.choice.value }, {
    world: kernel,
    picks: { [playOne.picks[0].id]: [first, second] },
    answers: { [playOne.args.choice.value.id]: [first] }
  });
  assert.equal(played.result.status, "executed");
  assert.equal(played.linked.played, 1);
  const run = runInstruction(recycle, { objects: { kind: "constant", value: [first, second] } }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.recycledCount, 1);
  assert.deepEqual(kernel.zone("A", "deck").map((ref) => ref.id), ["d2"]);
});

test("Void Burrower supported Exhaust effect: an exhausted legend records no additional exhaust", () => {
  const base = world().object("void-burrower", { cardId: CANONICAL_ID, types: ["legend"], zone: "board", exhausted: true }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("void-burrower") });
  const run = runInstruction(exhaust, { choose: exhaustSelf.args.choose.value }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.result.linkedValues.exhausted.count, 0);
  assert.equal(run.result.linkedValues.exhausted.alreadyExhausted, 1);
  assert.equal(kernel.getObject("void-burrower").exhausted, true);
  assert.deepEqual(run.events, []);
});

test("Void Burrower supported cost subpath: exhausting the ready legend is a real paid cost", () => {
  const base = world().object("burrower", { cardId: CANONICAL_ID, types: ["legend"], zone: "board", location: { type: "base", player: "A" } }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("burrower") });
  const plan = buildExhaustCostPlan(kernel, { object: kernel.ref("burrower") }, { id: "burrower-exhaust" });
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.getObject("burrower").exhausted, true);
  assert.deepEqual(kernel.events.map(event => event.action), ["pay", "exhaust"]);
});

test("Void Burrower supported cost subpath: an exhausted legend cannot pay and causes no reveal", () => {
  const base = world().object("void-burrower", { cardId: CANONICAL_ID, types: ["legend"], zone: "board", exhausted: true, location: { type: "base", player: "A" } }).deck(["d1", "d2", "d3"]).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("void-burrower") });
  const before = kernel.snapshot();
  const plan = buildExhaustCostPlan(kernel, { object: kernel.ref("void-burrower") }, { id: "burrower-exhaust" });
  assert.equal(canPayCostPlan(kernel, plan), false);
  assert.throws(() => payCostPlan(kernel, plan), error => error.reason === "cannot-pay-cost");
  assert.deepEqual(kernel.snapshot(), before);
  assert.equal(kernel.getObject("void-burrower").exhausted, true);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["d1", "d2", "d3"]);
  assert.deepEqual(kernel.events, []);
});

test("Void Burrower supported recycle subpath: all revealed cards recycle when no card is played", () => {
  const kernel = world().deck(["d1", "d2", "d3"]).build();
  const revealed = runInstruction(reveal, { pick: revealTopTwo.args.pick.value }, {
    world: kernel, picks: { [revealTopTwo.args.pick.value]: kernel.zoneSlice("A", "deck", "top", 2).map(object => object.ref) }
  });
  assert.equal(revealed.result.status, "executed");
  const recycled = runInstruction(recycle, recycleRest.args, { world: kernel });
  assert.equal(recycled.result.status, "executed");
  assert.equal(recycled.linked.recycledCount, 2);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["d3", "d1", "d2"]);
});

test("Void Burrower: the merged chain Finalize locks the ordered top-two reveal source (RIFT-358)", () => {
  const f = fixture();
  f.engine.advance();
  const top = f.kernel.zoneSlice("A", "deck", "top", 2).map(object => object.ref);
  // The chain-representable reveal/recycle suffix under test. The optional play
  // stays in the covered resolveChainBody subpath tests: the chain host's play
  // action router needs the production describePlay adapter (see judgeReason 1),
  // so the leading exhaust and the Finalize may/cost wiring remain blocked.
  f.engine.enqueue({
    id: "void-burrower-chain", kind: "triggered", controller: "A", source: f.kernel.getObject("source"),
    body: [revealTopTwo, recycleRest]
  });
  f.engine.advance();
  assert.equal(f.engine.items[0].status, "finalized");
  assert.equal(f.engine.items[0].pickPlans.length, 1, "Finalize must capture the ordered top-two source");
  assert.equal(f.engine.items[0].pickPlans[0].id, "void-burrower.top-two");
  assert.deepEqual(f.engine.items[0].pickPlans[0].refs, top);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "card-revealed"), false);
  resolveAll(f.engine);
  assert.deepEqual(f.kernel.linked("void-burrower.reveal-top-two.revealed"), top);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "card-revealed").length, 2);
  // Revealed cards stay revealed where they are (425.1.a.2); the linked recycle
  // consumes the locked refs and sends both to their owner's deck bottom.
  assert.equal(f.kernel.events.some(event => event.action === "play"), false);
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id), ["A:deck:3", "A:deck:4", "A:deck:1", "A:deck:2"]);
});

test.todo("Void Burrower: translate the leading may/exhaust into mayAtFinalize and TriggerRegistration.cost, and wire the chain play path's describePlay adapter (383.3.a/b, 404.1.b.1)");
test.todo("Void Burrower: resolve sfd-243-221's banish-then-play printing difference before canonical execution (428.1/420.3)");
