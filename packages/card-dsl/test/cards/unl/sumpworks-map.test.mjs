import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/sumpworks-map.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through the workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";

const CANONICAL_ID =
  "card.hash-47a542464232c8294d831009e0eeadaef69bf895aacfa6489afba4c08f3c2440";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "[Temporary] (Kill this at the start of its controller's Beginning Phase, before scoring.)\n" +
  "When an opponent scores, draw 1.";

const [reaction, temporary, triggered] = program.abilities;

test("unl-085-219 Sumpworks Map: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-085-219 Sumpworks Map: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // The judgeReason must name every missing dependency and no vague placeholder.
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /816\.1\.b/);
  assert.match(program.judgeReason, /Reaction/);
  assert.match(program.judgeReason, /continuous\.timing/);
  assert.match(program.judgeReason, /scoring/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /RIFT-83\/84/);
  assert.equal(/待实现|需要裁定/.test(program.judgeReason), false);
});

test("unl-085-219 Sumpworks Map: [Reaction] and [Temporary] are declared, never re-expanded", () => {
  assert.equal(program.abilities.length, 3);
  // 813.1.d / 816.1.a: both are keyword references; expansion belongs to the
  // engine keyword registry (contract 3.7 / README section 5).
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.deepEqual(temporary, { kind: "keyword", keyword: "temporary" });
  assert.equal(reaction.value, undefined);
  assert.equal(temporary.value, undefined);
});

test("unl-085-219 Sumpworks Map: the opponent-scores trigger is mandatory and draws exactly 1", () => {
  assert.equal(triggered.kind, "triggered");
  // 470.1 / 470.3 / 473.2: the score timing point is the Scoring trigger window.
  assert.equal(triggered.trigger.at, "score");
  assert.deepEqual(triggered.trigger.filter, { event: "score", player: "opponent" });
  assert.equal(triggered.trigger.once, undefined);
  assert.equal(triggered.trigger.condition, undefined);
  // 383.2.a: no printed "may" in the effect, so the trigger is mandatory.
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);
  const [drawOne] = triggered.body;
  assert.equal(drawOne.id, "sumpworks-map.draw");
  assert.equal(drawOne.op, "effect.draw");
  assert.deepEqual(drawOne.args.amount, { kind: "constant", value: 1 });
  assert.equal(drawOne.linkedTo, undefined);
  assert.equal(drawOne.targets, undefined);
  assert.equal(drawOne.picks, undefined);
});

test("unl-085-219 Sumpworks Map golden: the trigger body really draws 1 through the interpreter", () => {
  const kernel = world().deck(["top", "next"]).build();
  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(kernel.events.map(event => event.action), ["draw"]);
  assert.equal(outcome.linkedValues["sumpworks-map.draw.drawn"], 1);
});

test("unl-085-219 Sumpworks Map golden: an empty Main Deck draws nothing without Burn Out (414.x)", () => {
  const kernel = world().build();
  const outcome = resolveChainBody(triggered.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 0);
});

test("unl-085-219 Sumpworks Map golden: the merged effect.draw alone draws the declared 1", () => {
  const kernel = world().deck(["a", "b", "c"]).build();
  const run = runInstruction(draw, { amount: { kind: "constant", value: 1 } }, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 2);
});

test.todo(
  "unl-085-219 Sumpworks Map: [Temporary] keyword expansion (CR 816.1.b / 816.1.c: at the start of its " +
    "controller's Beginning Phase, before scoring, kill this; 816.2.a redundant instances) — no KeywordDef for " +
    "Temporary is merged (RIFT-83/84 keyword workstream)"
);
test.todo(
  "unl-085-219 Sumpworks Map: [Reaction] expansion consumption (CR 813.1.c closed-state play permission) via " +
    "layers/continuous.timing plus chain/ canAct(player, speed) — neither consumer is merged"
);
test.todo(
  "unl-085-219 Sumpworks Map: emit the score timing point from the production scoring path and register the " +
    "'When an opponent scores' trigger as a TriggerRegistration (CR 473.2; contract 3.5, RIFT-120 follow-up)"
);
