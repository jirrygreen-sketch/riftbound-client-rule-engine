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
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { bindStaticAbility, createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { assertTriggerSpec, validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

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

test("unl-085-219 Sumpworks Map: identity, ruleset, judge-required status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /EventPattern/);
  assert.match(program.judgeReason, /continuous\.timing/);
  // 2026-10-18 re-sweep: the reason names the measured rejections.
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
  assert.match(program.judgeReason, /TriggerSpecValidationError/);
  assert.match(program.judgeReason, /Unsupported static appliesTo/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
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
  assert.deepEqual(triggered.trigger.filter, { event: "scored", player: "opponent" });
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

test("unl-085-219 Sumpworks Map golden: the printed score trigger registers and is queued by a real score emission", () => {
  // 470.1 / 473.2: the closed "scored" spelling maps onto the score timing
  // point. Registering the card's own trigger through the production binding
  // makes it a real subscription, and a committed score emission queues it.
  const f = fixture({ cards: [] });
  const source = { ...f.kernel.getObject("source"), cardId: program.canonicalCardId, keywords: [] };
  const ids = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined, abilities: [triggered] }]
  }).registerProgramTriggers(f.engine, source);
  assert.deepEqual(ids, ["program:source:1:0"]);
  const queued = [];
  f.engine.pipeline.onTrigger = snapshot => queued.push(snapshot);
  f.engine.pipeline.emit({ timingPoint: "score", player: "B", details: { battlefieldId: "bf-1" } });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].registration.spec.at, "score");
  assert.deepEqual(queued[0].registration.spec.filter, { event: "scored", player: "opponent" });
  assert.equal(queued[0].controller, "A");
  assert.equal(queued[0].event.player, "B");
});

test("unl-085-219 Sumpworks Map: [Temporary]'s beginning-start trigger validates in production", () => {
  // 816.1 / 816.1.b: Temporary expands a kill trigger at the controller's
  // Beginning Phase start. The expansion writes event: "beginning-start", which
  // is a legal timing point but not a legal EventPattern name, so the
  // registration is rejected outright instead of subscribing.
  const [temporaryTrigger] = keywordDefinitionsById.get("Temporary").expand({
    host: { canonicalCardId: program.canonicalCardId }
  });
  assert.equal(temporaryTrigger.trigger.at, "beginning-start");
  assert.deepEqual(temporaryTrigger.trigger.filter, { event: "beginning-start", player: "self" });
  assert.doesNotThrow(() => assertTriggerSpec({ at: temporaryTrigger.trigger.at, filter: temporaryTrigger.trigger.filter }));
  assert.equal(validateTriggerSpec({ at: temporaryTrigger.trigger.at, filter: temporaryTrigger.trigger.filter }).ok, true);
  // 816.1.b's kill body itself is the merged effect.kill primitive.
  assert.deepEqual(temporaryTrigger.body.map(instruction => instruction.op), ["effect.kill"]);
});

test("unl-085-219 Sumpworks Map: [Reaction]'s continuous.timing expansion is still refused by the static binder", () => {
  // 813.1.c / 813.1.d: Reaction grants the Closed State play permission through
  // a static continuous.timing effect. The expansion's appliesTo array
  // (["card", "activated-ability"]) has no consumer in programs/statics.ts, so
  // the declaration fails closed; dropping it registers the layer effect, which
  // pins the blocker to the unconsumed appliesTo shape rather than to the kind.
  const [reactionStatic] = keywordDefinitionsById.get("Reaction").expand({
    host: { canonicalCardId: program.canonicalCardId }
  });
  assert.deepEqual(reactionStatic.effect.appliesTo, ["card", "activated-ability"]);
  const f = fixture({ cards: [] });
  const source = { ...f.kernel.getObject("source"), cardId: program.canonicalCardId, keywords: [] };
  const binder = createEngineStaticBinder(f.engine);
  assert.throws(
    () => bindStaticAbility(binder, reactionStatic, source),
    /Unsupported static appliesTo/
  );
  const handle = bindStaticAbility(binder, {
    ...reactionStatic,
    effect: { ...reactionStatic.effect, appliesTo: undefined }
  }, source);
  const [entry] = f.engine.layers.registry.list();
  handle.unbind();
  assert.equal(entry.effect.layer, "ability");
  assert.deepEqual(entry.effect.effect.grants, ["showdown", "closed-state"]);
});
