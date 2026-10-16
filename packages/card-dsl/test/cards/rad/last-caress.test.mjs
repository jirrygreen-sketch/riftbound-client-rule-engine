import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/last-caress.js";
import buffInstructionDef from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
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

test("rad-154-167 Last Caress: judgeReason names the delayed-op and play-permission gaps", () => {
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /355\.2\.b/);
  assert.match(program.judgeReason, /801\.3\.a/);
  assert.match(program.judgeReason, /393/);
  assert.match(program.judgeReason, /next/);
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
  // permitted by 355.2.a (355.2.b); no merged op creates it.
  assert.equal(grantLocation.op, "continuous.play-location-permission");
  assert.deepEqual(grantLocation.args.appliesTo, {
    kind: "constant",
    value: { type: "unit", controller: "self", playOrder: "next" }
  });
  assert.deepEqual(grantLocation.args.locations, { kind: "constant", value: ["battlefield"] });
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

test("rad-154-167 Last Caress: neither the location grant nor the delayed registration is registered", () => {
  assert.equal(instructionDefinitionsById.has("continuous.play-location-permission"), false);
  assert.equal(instructionDefinitionsById.has("trigger.delayed"), false);
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

test.todo(
  "rad-154-167 Last Caress: 'The next unit you play this turn can be played to any battlefield' needs a " +
    "play-location permission granted by the resolving spell (CR 355.2.b / 801.3.a); no merged op grants " +
    "one, and a static ability on the card would violate 393 (delayed abilities are created by the spell)"
);

test.todo(
  "rad-154-167 Last Caress: 'When you play it, [Buff] it' needs a card-created delayed trigger " +
    "(CR 391.2 / 420.4.a) whose window is the single next qualifying unit play; ResolveContext." +
    "registerDelayedTrigger exists (contract 3.6) and chain/engine.ts registers delayed triggers, but " +
    "effects/instructions/ has no card-facing op and TriggerSpec.once has no once-per-qualifying-event " +
    "lifetime (RIFT-9 trigger.delayed)"
);
