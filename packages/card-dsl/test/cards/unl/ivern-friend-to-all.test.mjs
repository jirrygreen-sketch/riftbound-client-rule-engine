import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/ivern-friend-to-all.js";
import score from "../../../../engine-core/dist/effects/instructions/effect.score.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-4f9132b39e7882b566918d9e149431cd5ca28810eebc329edb678b0585a346a8";
const SOURCE_TEXT =
  "As you play me, choose Bird, Cat, Dog, or Poro. I gain that tag.\n" +
  "When I conquer or hold, score 1 point if your units have all of the following tags among them — Bird, Cat, Dog, and Poro.";

const [tagChoice, conquerScore, holdScore] = program.abilities;
const [chooseTag] = tagChoice.body;
const conquerScoreInstruction = conquerScore.body[0];
const holdScoreInstruction = holdScore.body[0];
const conquerCondition = conquerScoreInstruction.condition;

test("unl-177-219 Ivern, Friend to All: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-177-219 Ivern, Friend to All: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /choice\.mode/);
  assert.match(program.judgeReason, /continuous\.add-tag/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /并集/);
});

test("unl-177-219 Ivern, Friend to All: the play-time tag choice is one choice.mode of four tags (355.1)", () => {
  assert.equal(tagChoice.kind, "play");
  assert.equal(tagChoice.body.length, 1);
  assert.equal(chooseTag.op, "choice.mode");
  assert.deepEqual(chooseTag.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(chooseTag.args.different, { kind: "constant", value: true });
  assert.deepEqual(chooseTag.args.modes.value.map(mode => mode.id), [
    "ivern-friend-to-all.bird",
    "ivern-friend-to-all.cat",
    "ivern-friend-to-all.dog",
    "ivern-friend-to-all.poro"
  ]);
  // Contract 3.9: the chosen instruction lives inside each mode's body; the
  // four tags are spelled exactly as printed (133.8: tags have no inherent rules
  // meaning beyond the text that references them).
  assert.deepEqual(
    chooseTag.args.modes.value.map(mode => [mode.body[0].id, mode.body[0].op, mode.body[0].args.tag.value]),
    [
      ["ivern-friend-to-all.gain-bird", "continuous.add-tag", "Bird"],
      ["ivern-friend-to-all.gain-cat", "continuous.add-tag", "Cat"],
      ["ivern-friend-to-all.gain-dog", "continuous.add-tag", "Dog"],
      ["ivern-friend-to-all.gain-poro", "continuous.add-tag", "Poro"]
    ]
  );
  for (const mode of chooseTag.args.modes.value) {
    assert.deepEqual(mode.body[0].args.layer, { kind: "constant", value: "trait" });
    assert.deepEqual(mode.body[0].args.object, { kind: "constant", value: "self" });
  }
});

test("unl-177-219 Ivern, Friend to All: conquer and hold each score 1 point, gated in the effect (383.2.a.1)", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual([conquerScore.trigger.at, holdScore.trigger.at], ["conquer", "hold"]);
  assert.deepEqual(conquerScore.trigger.filter, {
    event: "conquer",
    filter: { source: "self" }
  });
  assert.deepEqual(holdScore.trigger.filter, {
    event: "hold",
    filter: { source: "self" }
  });
  // The "if your units have all …" clause follows the effect, not the trigger
  // condition, so it is evaluated on the instruction (383.2.a.1 / Loose Cannon).
  assert.equal(conquerScore.trigger.condition, undefined);
  assert.equal(holdScore.trigger.condition, undefined);
  for (const instruction of [conquerScoreInstruction, holdScoreInstruction]) {
    assert.equal(instruction.op, "effect.score");
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
    assert.equal(instruction.linkedTo, undefined);
    assert.equal(instruction.targets, undefined);
    assert.equal(instruction.picks, undefined);
  }
  // The union predicate is a retained shape: subject names the cross-object
  // union, the filter only anchors the ability's controller.
  assert.equal(conquerCondition.kind, "compare");
  assert.equal(conquerCondition.operator, "gte");
  assert.deepEqual(conquerCondition.right, { kind: "constant", value: 4 });
  assert.equal(conquerCondition.left.kind, "count");
  assert.equal(conquerCondition.left.subject, "controller-units-distinct-listed-tags-union");
  assert.deepEqual(conquerCondition.left.filter, { player: "controller" });
  assert.deepEqual(holdScoreInstruction.condition, conquerCondition);
});

test("unl-177-219 Ivern, Friend to All golden: the score body gains exactly 1 point for the controller", () => {
  // 470.1 / 470.2 / 194.1.c: "score 1 point" is Gaining a Point; the merged
  // effect.score primitive awards it to the ability's controller by default.
  const kernel = world().player("A", { score: 2 }).build();
  const run = runInstruction(score, conquerScoreInstruction.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").score, 3);
  assert.deepEqual(run.events.map(event => event.action), ["score"]);
  assert.deepEqual(run.linked.scored, [{ player: "A", amount: 1 }]);
});

test("unl-177-219 Ivern, Friend to All golden: the effect-level condition really gates the score instruction", () => {
  // The predicate evaluates false on the reference kernel (no merged union
  // counter), so a false gate turns the instruction into negated/skipped and the
  // player's score does not move — the gate is live, not decorative.
  const kernel = world().player("A", { score: 2 }).unit("ivern", { tags: ["Ivern"] }).build();
  const conditionResult = kernel.test(conquerCondition);
  assert.equal(conditionResult, false);

  const guard = {
    id: "ivern-friend-to-all.guard-probe",
    op: "effect.score",
    args: { amount: { kind: "constant", value: 1 } },
    condition: conquerCondition
  };
  const outcome = runAbilityBody([guard], kernel);
  assert.deepEqual(outcome.results.map(result => [result.result.status, result.result.reason]), [
    ["negated", "skipped"]
  ]);
  assert.equal(kernel.player("A").score, 2);
});

test.todo(
  "unl-177-219 Ivern, Friend to All: evaluate the cross-object tag union ('your units have Bird, Cat, Dog and Poro among them') — " +
    "ObjectFilter.tags is an every-match on a single object in layers/filter.ts and the reference kernel, so the union needs a new predicate (contract change request)"
);
test.todo(
  "unl-177-219 Ivern, Friend to All: execute the play-time choice.mode of four tags — chain/engine.ts assertFinalizationSurface blocks mode choices " +
    "pending a Finalize/Resolve choice-plan adapter (RIFT-89/90)"
);
test.todo(
  "unl-177-219 Ivern, Friend to All: grant the chosen tag to the host (133.8) — no registered continuous.add-tag primitive and no CardProgram -> ContinuousEffectSpec wiring (RIFT-91)"
);
test.todo(
  "unl-177-219 Ivern, Friend to All: reach the conquer/hold timing points from the real scoring flow and register the two CardProgram triggers (engine batch 4/5, RIFT-120)"
);
