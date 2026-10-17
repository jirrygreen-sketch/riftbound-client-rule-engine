import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/last-caress.js";
import buffInstructionDef from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import locationInstruction from "../../../../engine-core/dist/effects/instructions/continuous.location.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { playLocations } from "../../../../engine-core/dist/layers/rules/query.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [speed, play] = program.abilities;
const [grantLocation, delayedBuff] = play.body;
const [buff] = delayedBuff.args.body.value;

test("rad-154-167 Last Caress: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(
    program.canonicalCardId,
    "card.hash-f2018820e58aa6e64632838286e934b24f7c9c49687c3fc847be072739c1b123"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
      "The next unit you play this turn (even from face down) can be played to any battlefield. " +
      "When you play it, [Buff] it. (Give it a +1 :rb_might: buff if it doesn't have one.)"
  );
  // Reminder text carries no rules meaning (135.2.d.3).
  assert.equal(program.sourceText.includes("(even from face down)"), true);
});

test("rad-154-167 Last Caress: judgeReason names the permission, delayed-op and ownership gaps", () => {
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /continuous\.location/);
  assert.match(program.judgeReason, /355\.2\.b/);
  assert.match(program.judgeReason, /801\.3\.a/);
  assert.match(program.judgeReason, /393/);
  assert.match(program.judgeReason, /once-per-qualifying-event/);
  assert.match(program.judgeReason, /playDestinationIsLegal/);
  assert.doesNotMatch(program.judgeReason, /RIFT-120|RIFT-257|RIFT-260/);
});

test("rad-154-167 Last Caress: structure — Reaction keyword, play-location grant, delayed Buff", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "last-caress.grant-play-location",
    "last-caress.delayed-buff"
  ]);

  // "The next unit you play this turn can be played to any battlefield" — a
  // Delayed Passive Ability (391.1 / 391.4) widening the play locations
  // permitted by 355.2.a (355.2.b); the permission spelling follows the merged
  // continuous.location op, whose Finalize consumer is still missing.
  assert.equal(grantLocation.op, "continuous.location");
  assert.deepEqual(grantLocation.args.permission, {
    kind: "constant",
    value: "any-battlefield"
  });
  assert.deepEqual(grantLocation.args.appliesTo, {
    kind: "constant",
    value: { type: "unit", controller: "self", playOrder: "next" }
  });
  assert.deepEqual(grantLocation.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grantLocation.args.once, {
    kind: "constant",
    value: "next-qualifying-play"
  });

  // "When you play it, [Buff] it." — a delayed Triggered Ability (391.2) on
  // the same next unit play; the Buff action itself is merged.
  assert.equal(delayedBuff.op, "trigger.delayed");
  assert.deepEqual(delayedBuff.args.at, { kind: "constant", value: "card-played" });
  assert.deepEqual(delayedBuff.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(delayedBuff.args.once, {
    kind: "constant",
    value: "next-qualifying-play"
  });
  assert.equal(delayedBuff.args.filter.kind, "constant");
  assert.equal(delayedBuff.args.filter.value.event, "card-played");
  assert.deepEqual(delayedBuff.args.filter.value.subject, {
    type: "unit",
    controller: "self",
    playOrder: "next"
  });

  assert.equal(buff.id, "last-caress.buff-played-unit");
  assert.equal(buff.op, "effect.buff");
  assert.deepEqual(buff.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buff.args.target, {
    kind: "constant",
    value: "last-caress.played-unit"
  });
  assert.equal(buff.targets.length, 1);
  assert.deepEqual(buff.targets[0].filter, { type: "unit", controller: "self" });
  assert.equal(buff.targets[0].min, 1);
  assert.equal(buff.targets[0].max, 1);
  assert.equal(buff.targets[0].selection, "one");
});

test("rad-154-167 Last Caress: the delayed Buff body really places a Buff counter (427.3)", () => {
  const kernel = world().player("A").unit("played-unit", { might: 3 }).build();
  const run = runInstruction(
    buffInstructionDef,
    { mode: buff.args.mode.value, target: buff.args.target.value },
    {
      world: kernel,
      targets: { "last-caress.played-unit": [kernel.ref("played-unit")] }
    }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("played-unit").buffs, 1);
  assert.equal(run.result.linkedValues.buffedCount, 1);
});

test("rad-154-167 Last Caress: a unit that already has a Buff is not buffed again (427.1.b.1)", () => {
  const kernel = world().player("A").unit("played-unit", { might: 3, buffs: 1 }).build();
  const run = runInstruction(
    buffInstructionDef,
    { mode: buff.args.mode.value, target: buff.args.target.value },
    {
      world: kernel,
      targets: { "last-caress.played-unit": [kernel.ref("played-unit")] }
    }
  );
  assert.deepEqual(run.result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(kernel.getObject("played-unit").buffs, 1);
});

test.todo(
  "rad-154-167 Last Caress: 'The next unit you play this turn can be played to any battlefield' " +
    "needs a play-location permission created by the resolving spell (CR 355.2.b / 801.3.a) with a " +
    "one-shot 'next unit' window; the merged continuous.location op records the permission but " +
    "chain/engine.ts playDestinationIsLegal reads only restriction names, and a static ability on the " +
    "card would violate 393"
);

test.todo(
  "rad-154-167 Last Caress: 'When you play it, [Buff] it' needs a card-created delayed trigger " +
    "(CR 391.2 / 420.4.a) whose window is the single next qualifying unit play; ResolveContext." +
    "registerDelayedTrigger exists (contract 3.6) and chain/engine.ts registers delayed triggers, but " +
    "effects/instructions/ registers no trigger.delayed op and TriggerSpec.once has no " +
    "once-per-qualifying-event lifetime"
);

test("rad-154-167 Last Caress boundary: continuous.location still refuses the recorded once, trigger.delayed is registered", () => {
  // The printed effect still needs a resolving-spell permission consumer
  // (355.2.b / 801.3.a): the recorded continuous.location declaration carries
  // an `once` argument the merged op rejects. The delayed-Buff half's
  // trigger.delayed opcode is now registered; its next-unit subject anchor
  // still fails trigger-spec validation closed.
  assert.equal(instructionDefinitionsById.has("trigger.delayed"), true);
  assert.throws(
    () => locationInstruction.argsSchema.parse(grantLocation.args),
    /Invalid continuous\.location argument: once/
  );
  // The permission the op can record still has no consumer that widens a play
  // destination: playDestinationIsLegal only looks at restriction names.
  const kernel = world().unit("caster", { might: 3 }).unit("next-unit", { types: ["unit"] }).build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => { throw new Error(`unexpected choice ${request.id}`); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  engine.layers.addContinuous({
    id: "last-caress.probe-permission",
    layer: "ability",
    source: kernel.ref("next-unit"),
    filter: { objectId: "next-unit", zoneEntryId: kernel.ref("next-unit").zoneEntryId },
    effect: { kind: "location", permission: "any-battlefield" }
  }, { type: "end-of-turn" });
  assert.deepEqual(
    playLocations(engine.layers.registry, kernel.ref("next-unit"), kernel.getObject("next-unit"), "A").permissions.map(entry => entry.name),
    ["any-battlefield"]
  );
});
