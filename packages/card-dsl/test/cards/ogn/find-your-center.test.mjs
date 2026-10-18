import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import findYourCenter from "../../../dist/cards/ogn/find-your-center.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { finalizeCostPlan } from "../../../../engine-core/dist/cost/discounts/index.js";

const CANONICAL = "card.hash-e3ecc6164765d02357568348735bbb2eb8e6ed9a6a919fd16c4dde83bf5c765e";

const [keyword, costAbility, play] = findYourCenter.abilities;
const [drawInstruction, channelInstruction] = play.body;

test("Find Your Center program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(findYourCenter);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Find Your Center identity, ruleset, status and printed text", () => {
  assert.equal(findYourCenter.canonicalCardId, CANONICAL);
  assert.equal(findYourCenter.rulesetVersion, "core-1.5");
  assert.equal(findYourCenter.status, "judge-required");
  assert.match(findYourCenter.judgeReason, /cost\.modify/);
  assert.match(findYourCenter.judgeReason, /programs\/statics\.ts/);
  assert.match(findYourCenter.judgeReason, /programs\/play\.ts/);
  assert.match(findYourCenter.judgeReason, /Victory Score/);
  assert.match(findYourCenter.judgeReason, /cost\/discounts\.finalizeCostPlan/);
  assert.match(findYourCenter.judgeReason, /exhausted:true/);
  assert.equal(cardRegistryById.get(findYourCenter.canonicalCardId), findYourCenter);
  assert.equal(
    findYourCenter.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "If an opponent's score is within 3 points of the Victory Score, this costs " +
      ":rb_energy_2: less.\n" +
      "Draw 1 and channel 1 rune exhausted."
  );
});

test("Find Your Center keeps the printed [Action] keyword (CR 806)", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });
});

test("Find Your Center [Action] expands to the merged showdown timing declaration", () => {
  const definition = keywordDefinitionsById.get("Action");
  assert.ok(definition);
  assert.deepEqual(definition.expand({ host: { canonicalCardId: CANONICAL } }), [
    {
      kind: "static",
      effect: {
        kind: "continuous.timing",
        grants: ["showdown"],
        appliesTo: ["card", "activated-ability"]
      }
    }
  ]);
});

test("Find Your Center cost ability records the [2] discount and its predicate", () => {
  assert.equal(costAbility.kind, "static");
  assert.equal(costAbility.effect.kind, "cost.modify");
  assert.deepEqual(costAbility.effect.amount, { kind: "constant", value: -2 });
  assert.equal(costAbility.effect.resource, "energy");
  assert.equal(costAbility.effect.appliesTo, "play-cost");
  // The predicate is a named expression, NOT a hard-coded comparison against
  // the default Victory Score of 8 (CR 194.3.a allows other values).
  assert.deepEqual(costAbility.condition, {
    kind: "expression",
    value: { kind: "constant", value: "opponent-score-within-3-of-victory-score" }
  });
});

test("Find Your Center body: unlinked Draw 1 then channel 1 rune exhausted", () => {
  assert.equal(play.body.length, 2);
  assert.equal(drawInstruction.id, "draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);

  assert.equal(channelInstruction.id, "channel-1-exhausted");
  assert.equal(channelInstruction.op, "effect.channel");
  assert.deepEqual(channelInstruction.args, {
    amount: { kind: "constant", value: 1 },
    exhausted: { kind: "constant", value: true }
  });
  // "Draw 1 and channel 1 rune exhausted." is one conjoined sentence but two
  // independent actions; linking them would let a failed draw suppress the
  // channel (359.3.e.11).
  assert.equal(channelInstruction.linkedTo, undefined);
  assert.equal(channelInstruction.targets, undefined);
});

test("Find Your Center golden: Draw 1 puts the top card of the Main Deck in hand", () => {
  const kernel = world().deck(["top-card", "next-card"]).build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 1);
  assert.equal(run.linked.drawnTo, "A");
  assert.equal(kernel.player("A").handSize, 1);
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
});

test("Find Your Center supported Channel movement moves exactly the top rune", () => {
  const kernel = world().rune(["r1", "r2"]).build();
  const run = runInstruction(channel, channelInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  // CR 431.1: one rune leaves the Rune Deck for the board (rune zone);
  // Exhausted entry state (CR 431.2) remains a separate execution TODO.
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.getObject("r1").zone, "rune-zone");
  assert.equal(kernel.getObject("r2").zone, "rune-deck");
  const action = run.events.find(event => event.action === "channel-rune");
  assert.ok(action, "expected a channel-rune game action");
});

test("Find Your Center golden: a short Rune Deck channels as much as possible (CR 431.3)", () => {
  const kernel = world().rune("only-rune").build();
  const run = runInstruction(channel, channelInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.channeled, 1);
  assert.equal(kernel.player("A").runeDeckSize, 0);
});

test("Find Your Center original body still channels when Draw is prevented", () => {
  const kernel = world().deck(["top", "next"]).rune(["first-rune", "second-rune"]).build();
  kernel.addReplacement(action => action.type === "draw" ? "prevented" : null);
  const outcome = resolveChainBody(play.body, kernel);
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    [drawInstruction.id, "negated"], [channelInstruction.id, "executed"]
  ]);
  assert.equal(kernel.player("A").handSize, 0);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["top", "next"]);
  assert.equal(kernel.getObject("first-rune").zone, "rune-zone");
  assert.equal(kernel.getObject("second-rune").zone, "rune-deck");
  assert.equal(outcome.results[1].result.linkedValues.channeled, 1);
  assert.deepEqual(outcome.events.map(event => [event.action, event.outcome ?? null]), [["draw", "prevented"], ["channel-rune", null]]);
  assert.equal(kernel.history({ action: "draw", player: "A" }), 0);
  assert.equal(kernel.history({ action: "channel-rune", player: "A" }), 1);
  // This proves independent actions, not the still-missing exhausted entry state.
});

test.todo("Find Your Center: read current Victory Score in the condition (CR 194.3/194.3.a) and bind the static discount into Finalize");

test.todo("Find Your Center: apply channel-rune.exhausted to actual rune entry state in the reference kernel (CR 431.2)");

test("Find Your Center collector blocks the unresolved Victory Score predicate instead of granting an unconditional discount", () => {
  for (const score of [0, 5, 8]) {
    const initial = world().player("B", { score })
      .hand("center", { cardId: CANONICAL, types: ["spell"], energy: 3, power: null }).build();
    const ctx = initial.clone({ sourceSnapshot: initial.getObject("center") });
    assert.throws(() => finalizeCostPlan(ctx, { id: "center:cost", cost: { kind: "printed" } }, {
      statics: [{ id: "center:static", source: ctx.ref("center"), ability: costAbility }]
    }), error => error.reason === "judge-required" && /authoritative condition adapter/.test(error.message));
    assert.equal(ctx.player("B").score, score);
    assert.equal(ctx.getObject("center").zone, "hand");
    assert.equal(ctx.getObject("center").power, null);
    assert.equal(ctx.history({ action: "pay", player: "A" }), 0);
  }
});
