import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/teemo-strategist.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";
import { finalizeOrderedPickPlans } from "../../../../engine-core/dist/chain/picks/plan.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { default: reveal } = await import(new URL("effects/instructions/effect.reveal.js", engineCore));
const { default: recycle } = await import(new URL("effects/instructions/effect.recycle.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));

const CANONICAL = "card.hash-605d9e63c28576716347062f9abdcd9fe543138a4b9bee8f5308c24ffac2ae1e";
const [hidden, defend, playedFromHidden] = program.abilities;

const printedSourceText =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "When I defend or I'm played from [Hidden], reveal the top 5 cards of your Main Deck. " +
  "Deal 1 to an enemy unit here for each card with [Hidden], then recycle them.";

function bindTopFive(kernel, ability = defend) {
  const plans = finalizeOrderedPickPlans(kernel, ability.body);
  for (const plan of plans) kernel.setPicks(plan.id, plan.refs);
  return plans;
}

function runAuthoredReveal(kernel, ability = defend) {
  const [instruction] = ability.body;
  const [plan] = bindTopFive(kernel, ability);
  return runInstruction(reveal, { pick: instruction.args.pick.value }, {
    world: kernel, picks: { [plan.id]: plan.refs }
  });
}

for (const ability of [defend, playedFromHidden]) {
  test(`Teemo, Strategist: ${ability.trigger.at} locks and reveals only the actual top five before recycling`, () => {
    const f = fixture({ cards: [{ id: "fifth" }, { id: "tail" }] });
    for (const id of ["fifth", "tail"]) {
      assert.equal(f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "deck-bottom" }).status, "done");
    }
    // Query insertion order differs from the authoritative deck order.
    assert.equal(f.engine.commit({ type: "order-top", player: "A", objects: [
      "A:deck:3", "A:deck:1", "A:deck:4", "A:deck:2"
    ].map(id => f.kernel.ref(id)) }).status, "done");
    f.engine.advance();
    const top = f.kernel.zoneSlice("A", "deck", "top", 5).map(object => object.ref);
    // Only the supported reveal/recycle instructions are under test. Hidden,
    // trigger binding and the Hidden-count damage remain blocked.
    f.engine.enqueue({
      id: "teemo-supported-body", kind: "triggered", controller: "A", source: f.kernel.getObject("source"),
      body: [ability.body[0], ability.body[2]]
    });
    f.engine.advance();
    assert.equal(f.engine.items[0].status, "finalized");
    assert.equal(f.engine.items[0].pickPlans.length, 1, "Finalize must capture the ordered top-five source");
    assert.deepEqual(f.engine.items[0].pickPlans[0].refs, top);
    assert.equal(f.engine.pipeline.events.some(event => ["card-revealed", "became-target"].includes(event.timingPoint)), false);
    resolveAll(f.engine);
    assert.deepEqual(f.kernel.linked(`${ability.body[0].id}.revealed`), top);
    assert.equal(f.kernel.linked(`${ability.body[0].id}.revealedCount`), 5);
    assert.equal(f.kernel.linked(`${ability.body[2].id}.recycledCount`), 5);
    assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id), ["tail", ...top.map(ref => ref.id)]);
    assert.equal(f.kernel.player("A").handSize, 0);
    assert.equal(f.kernel.player("B").deckSize, 4);
    assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "card-revealed").length, 5);
    assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "became-target"), false);
  });
}

test("Teemo, Strategist program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("identity: canonicalCardId, ruleset, status, judgeReason, verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /revealedHiddenCount/);
  assert.match(program.judgeReason, /关键词成员/);
  assert.match(program.judgeReason, /Facedown/);
  assert.match(program.judgeReason, /validateTarget/);
  assert.match(program.judgeReason, /defense-declared/);
  assert.equal(program.sourceText, printedSourceText);
});

test("structure: Hidden keyword plus the defend / played-from-Hidden triggers", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });

  assert.equal(defend.kind, "triggered");
  assert.equal(defend.trigger.at, "defense-declared");
  assert.deepEqual(defend.trigger.filter, {
    event: "defense-declared",
    filter: { source: "self", here: true }
  });
  assert.equal(defend.optional, false);
  assert.deepEqual(
    defend.body.map(instruction => [instruction.id, instruction.op]),
    [
      ["teemo.reveal", "effect.reveal"],
      ["teemo.damage", "effect.damage"],
      ["teemo.recycle", "effect.recycle"]
    ]
  );

  // The source always means the controller's real top five, including when
  // fewer cards remain; neither query order nor the opponent's deck is used.
  for (const ability of [defend, playedFromHidden]) {
    const pickId = ability === defend ? "teemo.top-five" : "teemo.hidden.top-five";
    assert.deepEqual(ability.body[0].args, {
      pick: { kind: "constant", value: pickId }
    });
    assert.deepEqual(ability.body[0].picks, [{
      id: pickId, options: [], ordered: true, selection: "all",
      zoneSlice: { zone: "deck", from: "top", count: { kind: "constant", value: 5 } }
    }]);
  }

  // "Deal 1 to an enemy unit here for each card with [Hidden]" — the amount is
  // the descriptive count-over-revealed-set predicate (see judgeReason), and the
  // target is one enemy unit at the source's current location.
  const damage = defend.body[1];
  assert.equal(damage.linkedTo, "teemo.reveal");
  // The per-card count has no producer in the merged primitives, so the amount
  // reads a linked key that the reveal step never writes: the interpreter then
  // ignores the instruction (MissingInformation) rather than dealing a guessed
  // amount.
  assert.deepEqual(damage.args.amount, {
    kind: "linked-value",
    instructionId: "teemo.reveal",
    key: "revealedHiddenCount"
  });
  assert.deepEqual(damage.args.target, { kind: "constant", value: "teemo.enemy-unit-here" });
  assert.equal(damage.args.source, undefined, "the damage primitive defaults to its actual ability source");
  assert.deepEqual(damage.targets[0], {
    id: "teemo.enemy-unit-here",
    filter: { type: "unit", controller: "opponent", sameLocationAs: "source" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "then recycle them" — linked to the reveal, so the referenced set is the
  // revealed cards (CR 359.3.e.14).
  const recycleInstruction = defend.body[2];
  assert.equal(recycleInstruction.linkedTo, "teemo.reveal");
  assert.deepEqual(recycleInstruction.args.objects, {
    kind: "linked-value",
    instructionId: "teemo.reveal",
    key: "revealed"
  });

  // "or I'm played from [Hidden]" — a second trigger for the same effect.
  assert.equal(playedFromHidden.kind, "triggered");
  assert.equal(playedFromHidden.trigger.at, "card-played");
  assert.deepEqual(playedFromHidden.trigger.filter, {
    event: "card-played",
    filter: { role: "self", playedFrom: "hidden" }
  });
  assert.deepEqual(
    playedFromHidden.body.map(instruction => [instruction.id, instruction.op]),
    [
      ["teemo.hidden.reveal", "effect.reveal"],
      ["teemo.hidden.damage", "effect.damage"],
      ["teemo.hidden.recycle", "effect.recycle"]
    ]
  );
  assert.deepEqual(playedFromHidden.body[1].targets[0], {
    ...damage.targets[0], id: "teemo.hidden.enemy-unit-here"
  });
});

test("golden: the reveal half shows all five deck cards through effect.reveal", () => {
  const kernel = world()
    .deck(["c1", "c2", "c3", "c4", "c5"], { owner: "A", types: ["unit"] })
    .hand("unrevealed-hand-card")
    .build();
  const run = runAuthoredReveal(kernel);
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.revealed.length, 5);
  assert.equal(run.linked.revealedCount, 5);
  assert.deepEqual(run.linked.revealed, kernel.zone("A", "deck"));
  assert.equal(run.events.filter(event => event.action === "reveal").length, 5);
  // CR 425.1.a: revealed cards stay in their zone.
  assert.equal(kernel.player("A").deckSize, 5);
  assert.equal(kernel.player("A").handSize, 1);
});

test("golden: ordered upstream picks reveal the true top five of a larger deck without moving them", () => {
  const kernel = world().deck(["z-top", "y", "x", "w", "v", "a-bottom"]).build();
  const before = kernel.zone("A", "deck");
  const topFive = kernel.zoneSlice("A", "deck", "top", 5).map(object => object.ref);
  const run = runInstruction(reveal, { pick: "teemo-top-five" }, {
    world: kernel, picks: { "teemo-top-five": topFive }
  });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.revealed, topFive);
  assert.equal(run.linked.revealedCount, 5);
  assert.equal(run.events.length, 5);
  assert.deepEqual(kernel.zone("A", "deck"), before);
});

test("golden: the linked recycle moves the revealed cards to the deck bottom", () => {
  const kernel = world()
    .deck(["c1", "c2", "c3", "c4", "c5"], { owner: "A", types: ["unit"] })
    .build();
  const revealed = kernel.objectsInZone("A", "deck");
  const run = runInstruction(recycle, defend.body[2].args, {
    world: kernel,
    linked: { revealed }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.recycledCount, 5);
  assert.equal(run.events.filter(event => event.action === "recycle").length, 5);
  assert.equal(kernel.getObject("c1").zone, "deck");
  assert.notEqual(kernel.getObject("c1").ref.zoneEntryId, 1);
});

test("golden: an empty reveal is negated as impossible instead of inventing cards (CR 425.2)", () => {
  const kernel = world().build();
  const run = runAuthoredReveal(kernel);
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(run.linked.revealed, []);
  assert.equal(run.linked.revealedCount, 0);
  assert.deepEqual(run.events, []);
});

test("golden: the damage half cannot deal a guessed amount while the [Hidden] count has no producer", () => {
  const battlefield = { type: "battlefield", id: "teemo-battlefield" };
  const initial = world()
    .deck(["c1", "c2", "c3", "c4", "c5"], { owner: "A", types: ["unit"] })
    .unit("teemo", { owner: "A", location: battlefield })
    .unit("enemy", { owner: "B", might: 3, location: battlefield })
    .build();
  const kernel = initial.clone({ sourceSnapshot: initial.getObject("teemo") });
  bindTopFive(kernel);
  kernel.setTargets("teemo.enemy-unit-here", [kernel.ref("enemy")]);
  assert.deepEqual(kernel.getObject("enemy").location, kernel.source.location);
  // Run the played-defend body itself through the real interpreter: the reveal
  // links only the revealed refs, so the damage amount (revealedHiddenCount)
  // has no producer and the instruction is ignored (CR 359.3.e.12) instead of
  // dealing a guessed count. The linked recycle still executes (359.3.e.14.b).
  const outcome = resolveChainBody(defend.body, kernel);
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [
      ["teemo.reveal", "executed"],
      ["teemo.damage", "ignored"],
      ["teemo.recycle", "executed"]
    ]
  );
  const damageResult = outcome.results.find(result => result.id === "teemo.damage");
  assert.equal(damageResult.result.reason, "mistargeted");
  assert.equal(kernel.getObject("enemy").damage, 0);
  assert.equal(kernel.events.some(event => event.action === "damage"), false);
  assert.equal(kernel.events.filter(event => event.action === "recycle").length, 5);
});

test.todo(
  "Teemo, Strategist: 'for each card with [Hidden]' needs a count over the linked revealed set with a " +
    "keyword-membership predicate (811.5); object.linked already scopes count to the revealed set, " +
    "but the Hidden membership filter and produced damage amount are still missing"
);
test.todo(
  "Teemo, Strategist: [Hidden] expansion — Hide cost (811.1.b), next-turn [Reaction] and the facedown " +
    "play permission ('played from [Hidden]', 811.1.b/d, 811.6) — keyword/program expansion is merged, " +
    "but the Hide/facedown lifecycle and trusted playedFrom event binding remain missing"
);
test.todo(
  "Teemo, Strategist: here target binding needs validateTarget to accept the existing symbolic " +
    "TargetSpec.location selectors; translateObjectFilter rejects sameLocationAs, and the " +
    "defense-declared timing still needs an authoritative combat producer (383.4.f/421.1)"
);
test.todo(
  "Teemo, Strategist: printed text is the pre-errata version; the official correction (S-ORIGINS " +
    "Teemo, Strategist) drops the played-from-Hidden branch and chooses the enemy unit before " +
    "revealing. The data fix belongs to card-data, not to this program " +
    "(docs/plans/survey/data-issues-recheck.md ogn-121-298)"
);

test("Teemo, Strategist: merged count scopes to the real reveal link without counting other zones", () => {
  const kernel = world().deck(["revealed-a", "revealed-b", "revealed-c"], { owner: "A" })
    .hand("hand-card").deck("opponent-card", { owner: "B" }).build();
  bindTopFive(kernel);
  const outcome = resolveChainBody([
    defend.body[0],
    { id: "probe.count", op: "condition.value", args: {
      value: { kind: "count", filter: { object: { linked: "teemo.reveal" } } }
    } }
  ], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["probe.count.value"], 3);
  assert.equal(outcome.linkedValues["teemo.reveal.revealedCount"], 3);
  assert.deepEqual(outcome.events.map(event => event.action), ["reveal", "reveal", "reveal"]);
  assert.equal(kernel.player("A").deckSize, 3);
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("B").deckSize, 1);
});
