import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/nidalee-cat-form.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL_ID =
  "card.hash-6c0a37aa2f3f705ccf4e2649f8890740556c17ff53525e6e45bd44c6c16e9bd5";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "When I win a combat, draw 1. (I win if I remain after combat.)";

const [ambush, combatWin] = program.abilities;
const [drawInstruction] = combatWin.body;

test("unl-114-219 Nidalee, Cat Form: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-114-219 Nidalee, Cat Form: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // The stale "no Ambush KeywordDef" gap is gone (RIFT-266) and the card-program
  // binding is merged too (RIFT-257); the reason must name the real gaps.
  assert.match(program.judgeReason, /Ambush/);
  assert.match(program.judgeReason, /822/);
  assert.match(program.judgeReason, /RIFT-266/);
  assert.doesNotMatch(program.judgeReason, /没有 Ambush 文件|没有已合入的 KeywordDef/);
  assert.match(program.judgeReason, /combat-result/);
  assert.match(program.judgeReason, /468\.3/);
  assert.match(program.judgeReason, /EVENT_PATTERN_TYPES/);
});

test("unl-114-219 Nidalee, Cat Form: [Ambush] stays a keyword declaration (822)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(ambush, { kind: "keyword", keyword: "ambush" });
  assert.equal(ambush.value, undefined);
  // 822.1 is a Passive Ability keyword; nothing is rewritten as rules text here.
  assert.equal(program.abilities.filter(ability => ability.kind === "static").length, 0);
});

test("unl-114-219 Nidalee, Cat Form: winning a combat is a combat-result trigger scoped to the source", () => {
  assert.equal(combatWin.kind, "triggered");
  assert.equal(combatWin.trigger.at, "combat-result");
  // 468.3.a: the win belongs to a player; 468.3.c: units at the battlefield
  // inherit their controller's result, so the ability is filtered to itself and
  // to the winning side. The result key is the placeholder recorded in the
  // judgeReason (no merged EventPattern binding exists yet).
  assert.deepEqual(combatWin.trigger.filter, {
    event: "combat-result",
    filter: { source: "self", result: "win" }
  });
  assert.equal(combatWin.trigger.condition, undefined);
  assert.equal(combatWin.trigger.once, undefined);
  // No printed "may": the trigger is mandatory (383.3.a).
  assert.equal(combatWin.optional, false);
});

test("unl-114-219 Nidalee, Cat Form: the body is a single untargeted draw 1 (414.1/414.3)", () => {
  assert.equal(combatWin.body.length, 1);
  assert.equal(drawInstruction.id, "nidalee-cat-form.draw-1");
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.targets, undefined);
  assert.equal(drawInstruction.picks, undefined);
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.condition, undefined);
});

test("unl-114-219 Nidalee, Cat Form golden: the draw body draws the controller's top card", () => {
  const kernel = world().deck(["top-card", "second-card"]).build();
  const outcome = resolveChainBody(combatWin.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["nidalee-cat-form.draw-1", "executed"]
  ]);
  // CR 414.1.a: the draw comes off the top of the controller's Main Deck.
  assert.deepEqual(kernel.zone("A", "hand").map(ref => ref.id), ["top-card"]);
  assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), ["second-card"]);
  assert.deepEqual(outcome.events.map(event => event.action), ["draw"]);
});

test("unl-114-219 Nidalee, Cat Form golden: an empty Main Deck gains no card but still executes (414.4)", () => {
  const kernel = world().build();
  const outcome = resolveChainBody(combatWin.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(kernel.zone("A", "hand"), []);
  assert.equal(kernel.player("A").handSize, 0);
  assert.equal(kernel.player("A").deckSize, 0);
  // Burn Out itself belongs to the kernel (414.4/432); the reference kernel only
  // records the draw task, so the assertion stays at the observable counts.
  assert.equal(outcome.linkedValues["nidalee-cat-form.draw-1.drawn"], 0);
  assert.equal(outcome.linkedValues["nidalee-cat-form.draw-1.drawnTo"], "A");
});

test.todo(
  "unl-114-219 Nidalee, Cat Form: [Ambush] adds the battlefield permission and grants [Reaction] while " +
    "being played there (CR 822.1.b / 822.1.c / 355.2.b) — the merged Ambush expansion is not consumed by " +
    "Finalize's placement check or chain.canAct()"
);
test.todo(
  "unl-114-219 Nidalee, Cat Form: combat-result must reach the ability through the combat -> chain pipeline and " +
    "bind “I win” from 468.3.a/468.3.c — combat/flow.ts still throws combat-start-transaction and "
    + "docs/rules/timing-point-producers.md lists the timing as 待后续"
);

test("unl-114-219 Nidalee, Cat Form: the merged Ambush KeywordDef publishes the two printed permissions", () => {
  const ambushDef = keywordDefinitionsById.get("Ambush");
  assert.ok(ambushDef, "the merged Ambush KeywordDef is registered (CR 822)");
  const expansion = ambushDef.expand({ host: { canonicalCardId: CANONICAL_ID } });
  // 822.2: multiple Ambush instances are redundant.
  assert.equal(ambushDef.stacking, "single");
  // 822.1.b/822.1.c: the placement permission plus the conditional Reaction grant.
  assert.deepEqual(expansion.map(ability => ability.effect.kind), ["play-location-permission", "continuous.timing"]);
  assert.equal(expansion[1].effect.location.battlefield.controller, "controller");
});

test("unl-114-219 Nidalee, Cat Form: the combat-result subscription is outside the closed trigger vocabulary", () => {
  // 468.3.a/468.3.c: the win belongs to the player and units inherit it. The card
  // records that scope with `result: "win"`, but events/trigger-spec.ts's frozen
  // EVENT_PATTERN_TYPES has no combat-result name, so the subscription cannot be
  // registered as written -- which is exactly the documented gap.
  const result = validateTriggerSpec(combatWin.trigger);
  assert.equal(result.ok, false);
  assert.equal(result.issues.some(issue => issue.code === "invalid-event-type"), true);
});
