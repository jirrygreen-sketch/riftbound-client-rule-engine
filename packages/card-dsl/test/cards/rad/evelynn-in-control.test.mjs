// Golden test for Evelynn, In Control (rad-109-167).
// The [Disarm] keyword and the facedown condition keep the card judge-required;
// the hold trigger's condition placement and its effect.score body are verifiable.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/evelynn-in-control.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import score from "../../../../engine-core/dist/effects/instructions/effect.score.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-7e71cd4d3c2627a9d36c7f7721c81b82138aba4816e45b83c1e9c58026ef9c9a";
const SOURCE_TEXT =
  "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn.)\n" +
  "When I hold, if you control a facedown card here, score 1 point.";

const [disarmKeyword, holdTrigger] = program.abilities;
const [scoreOne] = holdTrigger.body;
const condition = holdTrigger.trigger.condition;

test("rad-109-167 Evelynn, In Control: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-109-167 Evelynn, In Control: judgeReason names Disarm, the Facedown Zone and the hold emitter", () => {
  assert.match(program.judgeReason, /Disarm/);
  assert.match(program.judgeReason, /831\.1\.d/);
  assert.match(program.judgeReason, /facedown-zone/);
  assert.match(program.judgeReason, /RIFT-76/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("rad-109-167 Evelynn, In Control: [Disarm] is declared without a bespoke expansion (831.1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(disarmKeyword, { kind: "keyword", keyword: "disarm" });
  // No Disarm KeywordDef is registered yet; the card must not hand-write the
  // attack trigger + temporary -1 Might itself (README section 5).
  assert.equal(keywordDefinitionsById.has("Disarm"), false);
  assert.equal(program.abilities.filter(ability => ability.kind === "static").length, 0);
});

test("rad-109-167 Evelynn, In Control: 'When I hold' is the self-scoped hold trigger (383.4.d.2.a)", () => {
  assert.equal(holdTrigger.kind, "triggered");
  assert.equal(holdTrigger.trigger.at, "hold");
  assert.deepEqual(holdTrigger.trigger.filter, { self: true });
  assert.equal(holdTrigger.trigger.once, undefined);
  assert.equal(holdTrigger.optional, false);
});

test("rad-109-167 Evelynn, In Control: the facedown clause is a trigger condition, not an effect clause (383.2.a.1)", () => {
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "facedown-cards-you-control-here");
  assert.deepEqual(condition.left.filter, {
    type: "card",
    controller: "controller",
    zone: "facedown-zone",
    sameLocationAs: "source"
  });
  // The clause is part of the trigger condition, so it must not be duplicated as
  // an instruction-level condition.
  assert.equal(scoreOne.condition, undefined);
});

test("rad-109-167 Evelynn, In Control: the effect scores 1 point through the merged effect.score (194.1.c/470.1)", () => {
  assert.equal(holdTrigger.body.length, 1);
  assert.equal(scoreOne.id, "evelynn.score-one");
  assert.equal(scoreOne.op, "effect.score");
  assert.deepEqual(scoreOne.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(scoreOne.targets, undefined);
  assert.equal(scoreOne.picks, undefined);
  assert.equal(scoreOne.linkedTo, undefined);

  const kernel = world().player("A", { score: 2 }).build();
  const run = runInstruction(score, scoreOne.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").score, 3);
  assert.equal(kernel.player("B").score, 0);
  assert.deepEqual(run.linked.scored, [{ player: "A", amount: 1 }]);
  assert.deepEqual(run.events.map(event => event.action), ["score"]);
});

test.todo(
  "rad-109-167 Evelynn, In Control: [Disarm] 1 expansion — attack-declared trigger giving an enemy unit " +
    "here -1 Might this turn, merged into one trigger for multiple instances (CR 831.1.d/831.1.d.1) — needs " +
    "continuous.might + end-of-turn duration + the here anchor + an attack-declared emitter (RIFT-83~91)"
);
test.todo(
  "rad-109-167 Evelynn, In Control: 'if you control a facedown card here' evaluated against the battlefield's " +
    "Facedown Zone (CR 107.3.a/355.9.a.3) — the contract has no facedown-zone ZoneId (RIFT-84 batch)"
);
test.todo(
  "rad-109-167 Evelynn, In Control: the hold timing point emitted and the card trigger registered " +
    "(CR 315.2.b.2/471.2/473.2.b; scoring -> chain/events single pipeline) — RIFT-76/RIFT-120"
);

