import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/smite.js";
import banish from "../../../../engine-core/dist/effects/instructions/effect.banish.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindReplacement, BlockedReplacementError } from "../../../../engine-core/dist/replacement/index.js";
import { planReplacementBody } from "../../../../engine-core/dist/replacement/planner.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import replacementEvent from "../../../../engine-core/dist/effects/instructions/replacement.event.js";

const CANONICAL_ID =
  "card.hash-f2df74bd99eb5d2087462817264a1b9f0becc96353a67b98a7401ca7e5a5109a";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Deal 3 to a unit at a battlefield. If it would die this turn, banish it instead.";

const [speed, play] = program.abilities;
const [dealThree, banishInstead] = play.body;
const banishInstruction = banishInstead.args.instead.value[0];
const UNIT = "smite.unit";
const constant = value => ({ kind: "constant", value });

function pipelineKernel(kernel) {
  Object.defineProperty(kernel, "source", { value: kernel.objects[0], configurable: true });
  const pipeline = new EventPipeline({
    checkpoint: () => kernel.snapshot(), restore: state => kernel.restore(state),
    execute: action => ({ outcome: kernel.perform(action), emissions: [] }),
    context: () => kernel, objects: () => kernel.objects,
    choose: request => request.type === "mode" ? request.options[0] : true
  }, ["A", "B"], "A");
  Object.defineProperty(kernel, "replacement", {
    value: { host: { object: ref => kernel.object(ref), objects: () => kernel.objects, context: () => kernel }, pipeline },
    configurable: true
  });
  return pipeline;
}

test("unl-007-219 Smite: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-007-219 Smite: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The refreshed reason names the three real, still-open blockers instead of
  // the merged replacement binder itself.
  assert.match(program.judgeReason, /369\.1/);
  assert.match(program.judgeReason, /370\.1\.b/);
  assert.match(program.judgeReason, /replacement\.event/);
  assert.match(program.judgeReason, /replacementDependencies/);
  assert.match(program.judgeReason, /host \+ pipeline/);
  assert.match(program.judgeReason, /Finalize target adapter/);
  assert.match(program.judgeReason, /Unsupported replacement opcode: effect\.banish/);
  assert.match(program.judgeReason, /355\.10\.c\.1/);
  // The merged pieces are named as merged and are no longer the blocker.
  assert.match(program.judgeReason, /replacement\.event 原语已合入/);
  assert.match(program.judgeReason, /428\.1/);
});

test("unl-007-219 Smite: [Action] plus a battlefield-restricted damage target", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["smite.deal-3", "effect.damage"],
    ["smite.banish-instead", "replacement.event"]
  ]);

  // 418.1 / 355.10.b: the unit is the target; "at a battlefield" only restricts it.
  assert.deepEqual(dealThree.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(dealThree.args.target, { kind: "constant", value: UNIT });
  assert.deepEqual(dealThree.targets, [
    {
      id: UNIT,
      filter: { type: "unit", zone: "board", location: { type: "battlefield" } },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // 369.1 / 370.1.b: the death-replacement shape references the same TargetSpec,
  // and its instead-body banishes that unit (428.1).
  assert.deepEqual(banishInstead.args.event, { kind: "constant", value: "object-killed" });
  assert.deepEqual(banishInstead.args.window, { kind: "constant", value: "this-turn" });
  assert.deepEqual(banishInstead.args.object, { kind: "constant", value: { target: UNIT } });
  assert.equal(banishInstead.linkedTo, undefined);
  assert.equal(banishInstruction.op, "effect.banish");
  assert.deepEqual(banishInstruction.args.objects, {
    kind: "constant",
    value: { target: UNIT }
  });
});

test("unl-007-219 Smite golden: Deal 3 marks 3 damage on the locked battlefield unit", () => {
  const kernel = world()
    .unit("battlefield-unit", { might: 4, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const run = runInstruction(
    damage,
    { amount: dealThree.args.amount, target: UNIT },
    { world: kernel, targets: { [UNIT]: [kernel.ref("battlefield-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("battlefield-unit").damage, 3);
  assert.equal(run.linked.dealt, 3);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
});

test("unl-007-219 Smite golden: a stale battlefield target is ignored, so no damage is dealt", () => {
  const kernel = world().unit("battlefield-unit", { might: 4 }).build();
  const stale = kernel.ref("battlefield-unit");
  assert.equal(kernel.perform({ type: "move-zone", object: stale, to: "hand" }).status, "done");
  const run = runInstruction(
    damage,
    { amount: dealThree.args.amount, target: UNIT },
    { world: kernel, targets: { [UNIT]: [stale] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test("unl-007-219 Smite golden: the instead-body banishes the unit through the real primitive", () => {
  const kernel = world().unit("doomed-unit", { might: 2 }).build();
  const run = runInstruction(
    banish,
    { objects: banishInstruction.args.objects },
    { world: kernel, targets: { [UNIT]: [kernel.ref("doomed-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("doomed-unit").zone, "banishment");
  assert.equal(run.linked.banishedCount, 1);
  assert.deepEqual(run.events.map(event => event.action), ["banish"]);
});

test("unl-007-219 Smite: the settled body still has no production replacement registration (gap 1)", () => {
  // Evidence for gap (1): the merged replacement.event primitive requires the
  // resolution context to expose replacement dependencies; neither ChainEngine's
  // context overrides nor createActionPipelineHost supply that field, so the
  // card's own registration cannot reach the pipeline at resolution time.
  const kernel = world()
    .player("A", { energy: 3, power: ["Fury"] })
    .unit("battlefield-unit", { might: 4, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  assert.equal(kernel.replacement, undefined, "a plain resolve context must not expose replacement deps");
  assert.throws(
    () => replacementEvent.execute(kernel, { event: constant({ event: "object-killed" }), instead: [] }),
    error => error instanceof BlockedReplacementError && /requires ResolveContext\.replacement dependencies/.test(error.message),
    "replacement.event must fail closed without the dependencies"
  );
});

test("unl-007-219 Smite: the Finalize object binding for 'it' is still missing (gap 2)", () => {
  // Evidence for gap (2): 355.10.c.1's "it" is the previously chosen unit, but
  // the merged primitive rejects the object argument instead of guessing a binding.
  const kernel = world().unit("battlefield-unit", { might: 4 }).build();
  pipelineKernel(kernel);
  assert.throws(
    () => replacementEvent.execute(kernel, {
      event: constant({ event: "object-killed" }),
      object: banishInstead.args.object,
      instead: banishInstead.args.instead
    }),
    /replacement\.event object binding needs a Finalize target adapter/
  );
});

test("unl-007-219 Smite: the replacement planner still cannot plan the banish instead-body (gap 3)", () => {
  // Evidence for gap (3): the instead-body uses effect.banish, which the merged
  // planner does not map onto a frozen GameAction.
  const kernel = world().unit("battlefield-unit", { might: 4 }).build();
  assert.throws(
    () => planReplacementBody([banishInstruction], {
      hostRef: { id: "smite", zoneEntryId: 1 },
      replacedObject: kernel.ref("battlefield-unit"),
      usedWindow: false
    }, {
      host: { object: ref => kernel.object(ref), objects: () => kernel.objects, context: () => kernel },
      controller: "A",
      evaluate: expression => expression.kind === "constant" ? expression.value : null
    }),
    /Unsupported replacement opcode: effect\.banish/
  );
});

test("unl-007-219 Smite: the declared window is not a registration the pipeline consumes (gap 1)", () => {
  // Evidence for gap (1): the declaration is never installed, so a lethal
  // damage/kill still sends the unit to the trash instead of Banishment.
  const kernel = world().unit("battlefield-unit", { might: 3 }).build();
  const pipeline = pipelineKernel(kernel);
  const target = kernel.ref("battlefield-unit");
  assert.equal(pipeline.commit({ type: "damage", source: { id: "smite", zoneEntryId: 1 }, target, amount: 3, combat: false }).status, "done");
  assert.equal(pipeline.commit({ type: "kill", object: target }).status, "done");
  assert.equal(kernel.getObject("battlefield-unit").zone, "trash");
  assert.notEqual(kernel.getObject("battlefield-unit").zone, "banishment");
});

test.todo("unl-007-219 Smite: install the for-this-turn death replacement (CR 369.1 / 370.1.b) so the chosen unit is banished instead of dying — needs the resolution-time replacement dependencies (host + pipeline), a Finalize binding for the chosen unit, and a planner mapping for effect.banish");
