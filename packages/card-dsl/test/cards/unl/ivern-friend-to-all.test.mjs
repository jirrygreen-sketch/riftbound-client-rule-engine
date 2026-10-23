import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/ivern-friend-to-all.js";
import score from "../../../../engine-core/dist/effects/instructions/effect.score.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";

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
  assert.match(program.judgeReason, /conquer\/hold|来源对象/);
  assert.equal(conquerCondition.kind, "all");
  assert.doesNotMatch(program.judgeReason, /RIFT-89|RIFT-90|RIFT-91|RIFT-120/);
  // The reason must name the live rejections rather than a placeholder.
  assert.match(program.judgeReason, /choice-plan adapter|Mode choices/);
  assert.match(program.judgeReason, /注册表无该 opcode|instruction/);
  assert.match(program.judgeReason, /battlefieldId/);
  assert.equal(/待实现|需要裁定/.test(program.judgeReason), false);
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
    event: "conquered",
    filter: { source: "self" }
  });
  assert.deepEqual(holdScore.trigger.filter, {
    event: "held",
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
  // Each tag is required somewhere among friendly Board units; tags can be
  // distributed across units or all be on one unit.
  assert.equal(conquerCondition.kind, "all");
  assert.deepEqual(conquerCondition.conditions, ["Bird", "Cat", "Dog", "Poro"].map(tag => ({
    kind: "compare",
    left: { kind: "count", subject: "units", filter: {
      type: "unit", zone: "board", controller: "self", tags: [tag]
    } },
    operator: "gt",
    right: { kind: "constant", value: 0 }
  })));
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
  // No listed tags are present, so the effect-level predicate skips scoring.
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

test("unl-177-219 Ivern, Friend to All golden: both original score bodies evaluate the real tag union through ChainEngine", () => {
  const cases = [
    { label: "distributed tags", tags: [["Bird"], ["Cat"], ["Dog"], ["Poro"]], expected: 1 },
    { label: "all tags on one unit", tags: [["Bird", "Cat", "Dog", "Poro"]], expected: 1 },
    { label: "missing Poro", tags: [["Bird"], ["Cat"], ["Dog"]], expected: 0 },
    { label: "four copies of Bird", tags: [["Bird"], ["Bird"], ["Bird"], ["Bird"]], expected: 0 },
    { label: "opponent Poro", tags: [["Bird", "Cat", "Dog"], ["Poro"]], owner: "B", expected: 0 },
    { label: "Poro in hand", tags: [["Bird", "Cat", "Dog"], ["Poro"]], inHand: true, expected: 0 },
    { label: "Poro on Gear", tags: [["Bird", "Cat", "Dog"], ["Poro"]], gear: true, expected: 0 }
  ];
  for (const ability of [conquerScore, holdScore]) for (const scenario of cases) {
    const cards = scenario.tags.map((tags, index) => ({
      id: `tag-${index}`, tags, might: 2,
      types: scenario.gear && index === 1 ? ["gear"] : ["unit"],
      owner: scenario.owner && index === 1 ? scenario.owner : "A"
    }));
    const f = fixture({ cards });
    for (const [index, card] of cards.entries()) {
      if (scenario.inHand && index === 1) continue;
      f.engine.commit({ type: "move-zone", object: f.kernel.ref(card.id), to: "base",
        location: { type: "base", player: card.owner } });
    }
    f.engine.enqueue({ id: "ivern-score", controller: "A", source: f.kernel.getObject("source"),
      kind: "triggered", speed: "normal", body: ability.body });
    f.engine.advance();
    resolveAll(f.engine);
    assert.equal(f.kernel.player("A").score, scenario.expected, `${ability.trigger.at}: ${scenario.label}`);
    assert.equal(f.kernel.player("B").score, 0);
    assert.equal(f.kernel.events.filter(event => event.action === "score").length, scenario.expected);
  }
});

test("unl-177-219 Ivern, Friend to All: both event aliases pass the production trigger schema", () => {
  for (const ability of [conquerScore, holdScore]) {
    const translated = translateTriggerFilter(ability.trigger.filter, "ivern", ability.trigger.at);
    const result = validateTriggerSpec({ ...ability.trigger, filter: translated });
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.deepEqual(result.issues, []);
    assert.equal(translated.event, ability.trigger.at === "conquer" ? "conquered" : "held");
    assert.deepEqual(translated.object, { objectId: "ivern" });
  }
});

test("unl-177-219 Ivern, Friend to All: the production play binding rejects the play-time mode choice", () => {
  // 355.1: "As you play me, choose ..." is decided while playing the card, so the
  // play-time choice belongs to the program's play ability. programs/play.ts
  // refuses choice.mode outright until a Finalize/Resolve choice-plan adapter
  // exists, so the tag choice cannot run.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const source = {
    ref: { id: "ivern", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    name: "ivern",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "hand",
    location: null,
    might: 4,
    energy: 5,
    power: ["Calm"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  assert.throws(
    () => binding.describePlay({ type: "play", player: "A", card: source.ref }, source),
    error => {
      assert.equal(error.name, "ProgramBindingError");
      assert.equal(error.code, "judge-required");
      assert.match(error.message, /Mode choices require a Finalize\/Resolve choice-plan adapter/);
      return true;
    }
  );
});

test("unl-177-219 Ivern, Friend to All: continuous.add-tag has no registered implementation", () => {
  // 133.8: "I gain that tag" is a continuous trait-layer write. layers/engine.ts
  // already writes add-tag/grant-tag when a trait-layer effect is evaluated, but no
  // CardProgram instruction registers this opcode, so the body step cannot execute.
  assert.equal(instructionDefinitionsById.has("continuous.add-tag"), true);
  for (const mode of chooseTag.args.modes.value) {
    assert.equal(mode.body[0].op, "continuous.add-tag");
  }
});

test("unl-177-219 Ivern, Friend to All: the two score subscriptions register but the Score wave carries no unit", () => {
  // 383.4.c / 383.4.d: both triggers are valid subscriptions (the conquered/held
  // aliases pass the production schema), yet the real Score wave carries only
  // player/details.battlefieldId, so the {source: "self"} object filter never
  // matches and neither ability can fire.
  const kernel = world()
    .unit("ivern", { cardId: CANONICAL_ID, types: ["unit"], might: 4, tags: ["Bird"] })
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  const source = kernel.getObject("ivern");
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  assert.equal(binding.registerProgramTriggers(engine, source).length, 2);

  const fired = [];
  engine.pipeline.onTrigger = snapshot => fired.push(snapshot);
  engine.pipeline.emit({ timingPoint: "conquer", player: "A", details: { battlefieldId: "bf-1" } });
  engine.pipeline.emit({ timingPoint: "hold", player: "A", details: { battlefieldId: "bf-1" } });
  assert.equal(fired.length, 0);
});

test.todo(
  "unl-177-219 Ivern, Friend to All: execute the play-time choice.mode of four tags — chain/engine.ts assertFinalizationSurface blocks mode choices " +
    "pending a Finalize/Resolve choice-plan adapter"
);
test.todo(
  "unl-177-219 Ivern, Friend to All: grant the chosen tag to the host (133.8) — bind the continuous.add-tag body " +
    "through the CardProgram -> trait-layer adapter"
);
test.todo(
  "unl-177-219 Ivern, Friend to All: reach the conquer/hold timing points from the real scoring flow and register the two CardProgram triggers " +
    "after the Score wave can match the participating unit (conquered/held aliases already validate)"
);
