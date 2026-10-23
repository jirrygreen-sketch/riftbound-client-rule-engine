import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/draven-audacious.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import score from "../../../../engine-core/dist/effects/instructions/effect.score.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-517bab9d87b5b339d5d8886b24a11340875d925af78a9616dcb0a621e6ea4818";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "The first time I win a combat each turn, you score 1 point.\n" +
  "When I die in combat, choose an opponent. They score 1 point.";

const [deflect, winCombat, dieInCombat] = program.abilities;
const [scoreOnWin] = winCombat.body;
const [chooseOpponent, opponentScores] = dieInCombat.body;

test("sfd-148-221 Draven, Audacious: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-148-221 Draven, Audacious: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /combat-result/);
  assert.match(program.judgeReason, /target\.player/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /809\.1\.c\.1/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-148-221 Draven, Audacious: [Deflect] is declared without a value (809.1.b.3)", () => {
  assert.equal(program.abilities.length, 3);
  // 809.1.b.3: an omitted X means 1, so the card declares no value and the
  // expansion (static target.tax) stays in effects/keywords/Deflect.ts.
  assert.deepEqual(deflect, { kind: "keyword", keyword: "deflect" });
});

test("sfd-148-221 Draven, Audacious: the win-combat half is once per turn and scores 1", () => {
  assert.equal(winCombat.kind, "triggered");
  // 468.3.a / 468.3.c: the unit inherits its controller's combat result.
  assert.equal(winCombat.trigger.at, "combat-result");
  assert.deepEqual(winCombat.trigger.filter, {
    event: "combat-result",
    filter: {},
    details: { winnerId: "self" },
    player: "self"
  });
  // 383.3.e / 383.3.e.1: "The first time ... each turn" is the per-turn lifetime.
  assert.equal(winCombat.trigger.once, "per-turn");
  assert.equal(winCombat.trigger.condition, undefined);
  assert.equal(winCombat.optional, false);

  // 194.1.c / 470.2: "you score 1 point" is Gaining Points, distinct from
  // Scoring a Battlefield (470.1); the controller is the implicit scorer.
  assert.equal(winCombat.body.length, 1);
  assert.equal(scoreOnWin.id, "draven-audacious.score-on-win");
  assert.equal(scoreOnWin.op, "effect.score");
  assert.deepEqual(scoreOnWin.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(scoreOnWin.targets, undefined);
  assert.equal(scoreOnWin.picks, undefined);
  assert.equal(scoreOnWin.linkedTo, undefined);
});

test("sfd-148-221 Draven, Audacious: the death half chooses an opponent who then scores 1", () => {
  assert.equal(dieInCombat.kind, "triggered");
  // 808.1.d / 808.1.d.2: the trigger is this Permanent being Killed and sent to
  // the Trash, collected before the zone change.
  assert.equal(dieInCombat.trigger.at, "object-killed");
  assert.deepEqual(dieInCombat.trigger.filter, {
    event: "object-killed",
    self: true,
    details: { inCombat: true }
  });
  assert.equal(dieInCombat.trigger.condition, undefined);
  assert.equal(dieInCombat.trigger.once, undefined);
  assert.equal(dieInCombat.optional, false);

  // 355.9.a: choosing an opponent is a Player selection; the surveyed
  // target.player row keeps it distinct from "each player".
  assert.equal(chooseOpponent.id, "draven-audacious.choose-opponent");
  assert.equal(chooseOpponent.op, "target.player");
  assert.deepEqual(chooseOpponent.args.selection, { kind: "constant", value: "one" });
  assert.deepEqual(chooseOpponent.args.chooser, { kind: "constant", value: "controller" });
  assert.deepEqual(chooseOpponent.args.scope, { kind: "constant", value: "opponent" });
  assert.deepEqual(chooseOpponent.args.linkKey, { kind: "constant", value: "chosenOpponent" });
  assert.equal(chooseOpponent.targets, undefined);

  // "They score 1 point": the chosen opponent gains the point (194.1.c).
  assert.equal(opponentScores.op, "effect.score");
  assert.equal(opponentScores.linkedTo, "draven-audacious.choose-opponent");
  assert.deepEqual(opponentScores.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(opponentScores.args.player, {
    kind: "linked-value",
    instructionId: "draven-audacious.choose-opponent",
    key: "chosenOpponent"
  });
  assert.equal(opponentScores.targets, undefined);
});

test("sfd-148-221 Draven, Audacious golden: the declared win-combat body really scores 1 for the controller", () => {
  const kernel = world().player("A").player("B").build();
  const run = runInstruction(score, scoreOnWin.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").score, 1);
  assert.equal(kernel.player("B").score, 0);
  assert.deepEqual(run.linked.scored, [{ player: "A", amount: 1 }]);
  assert.deepEqual(run.events.map((event) => event.action), ["score"]);
});

test("sfd-148-221 Draven, Audacious golden: the death body scores for the linked opponent, not the controller", () => {
  // target.player is unmerged, so the golden binds the chosen opponent through
  // the link value the choice would write and executes the card's own score
  // arguments (including the linked-value player) through the real primitive.
  const kernel = world().player("A").player("B").build();
  const run = runInstruction(
    score,
    { ...opponentScores.args, linkKey: { kind: "constant", value: "scored" } },
    // The reference kernel resolves a linked-value expression by its key; the
    // interpreter's path-qualified spelling (<instruction id>.<key>) is what
    // production layers on top of the same binding.
    { world: kernel, linked: { chosenOpponent: "B" } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("B").score, 1);
  assert.equal(kernel.player("A").score, 0);
  assert.deepEqual(run.linked.scored, [{ player: "B", amount: 1 }]);
});

test.todo(
  "sfd-148-221 Draven, Audacious: the combat-result timing point (468.3) must be emitted by combat/ and reach " +
    "this ability through the trigger -> chain pipeline with the winner payload exposed (combat-result producer)"
);

test.todo(
  "sfd-148-221 Draven, Audacious: \"choose an opponent\" needs the player-selection primitive (target.player) and " +
    "a link shape that feeds the chosen PlayerId into effect.score's player argument (355.9.a; native player target contract)"
);

test.todo(
  "sfd-148-221 Draven, Audacious: \"die in combat\" needs the in-combat state at the death event (740.2.c) — " +
    "ObjectSnapshot.combatRole exists (contract 3.8 item 1) but no timing point or payload carries the combat " +
    "designation to object-killed, and the details.inCombat filter has no consumer (combat-result producer)"
);

test.todo(
  "sfd-148-221 Draven, Audacious: the [Deflect] expansion (static target.tax) needs its consumer — TargetPlan's " +
    "tax adapter only appends caller-supplied taxes and the merged tax -> cost mapping bills Energy instead of the " +
    "any-domain Power of 809.1.c.1, and programs/statics.ts has no layer mapping for target.tax"
);

test("sfd-148-221 Draven, Audacious: the native player target and choose-opponent opcode are registered", () => {
  // 355.9.a: choosing an opponent is a Player selection. The production
  // registry exposes target.player, and the card's second instruction already
  // uses the linked PlayerId as its scorer.
  assert.equal(instructionDefinitionsById.has("target.player"), true);
  assert.equal(instructionDefinitionsById.has(chooseOpponent.op), true);
});

test("sfd-148-221 Draven, Audacious: an in-combat death payload cannot match the declared filter", () => {
  // 740.2.c / 808.1.d: the trigger needs the death event to say it happened in
  // combat. No merged producer puts a combat designation into object-killed,
  // so a real kill payload does not satisfy the declared details filter.
  assert.equal(
    matchesTriggerEvent(
      dieInCombat.trigger.filter,
      { timingPoint: "object-killed", kind: "object", player: "A", details: {} },
      "A"
    ),
    false
  );
});

test("sfd-148-221 Draven, Audacious: the win-combat subscription is admitted by the production vocabulary", () => {
  // 468.3.a / 468.3.c: combat-result is a closed EventPattern type and details
  // remains a typed predicate field.
  const translated = translateTriggerFilter(
    winCombat.trigger.filter,
    "draven",
    "combat-result"
  );
  assert.deepEqual(translated, { event: "combat-result", player: "self", details: { winnerId: "self" } });
  const result = validateTriggerSpec({ at: "combat-result", filter: translated });
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  // The death half's self anchor translates to the host snapshot; only the
  // in-combat payload is missing.
  assert.deepEqual(translateTriggerFilter(dieInCombat.trigger.filter, "draven", "object-killed"), {
    event: "object-killed",
    object: { objectId: "draven" },
    details: { inCombat: true }
  });
  assert.deepEqual(
    translateTriggerFilter(
      { event: "combat-result", details: { winnerId: "self" }, player: "self" },
      "draven",
      "combat-result"
    ),
    { event: "combat-result", details: { winnerId: "self" }, player: "self" }
  );
});

test("sfd-148-221 Draven, Audacious: the production binder registers the Deflect target tax", () => {
  // 809.1: [Deflect] expands to a host-bound target.tax capability. The tax
  // remains an ordinary caller-collected target-plan input; this test proves
  // the card's grant is no longer rejected by the static binder.
  const definition = keywordDefinitionsById.get("Deflect");
  assert.ok(definition, "effects/keywords/Deflect.ts must be registered");
  const [expansion] = definition.expand({ value: undefined, host: { canonicalCardId: CARD_ID } });
  assert.equal(expansion.effect.kind, "target.tax");

  const kernel = world().unit("draven", { cardId: CARD_ID, location: { type: "base", player: "A" } }).build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`Unexpected choice: ${request.id}`); },
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const handle = createEngineStaticBinder(engine).bindStatic(expansion, kernel.getObject("draven"));
  const [registration] = engine.layers.registry.list();
  assert.equal(registration.effect.effect.capabilityKind, "target-tax");
  assert.equal(registration.effect.effect.ability.effect.kind, "target.tax");
  handle.unbind();
  assert.deepEqual(engine.layers.registry.list(), []);
});
