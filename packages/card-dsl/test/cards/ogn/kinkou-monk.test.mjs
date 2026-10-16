import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/kinkou-monk.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { default: buff } = await import(new URL("effects/instructions/effect.buff.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));

const CANONICAL = "card.hash-0090d6c57ba7da68b80e9f14bdad99780bc1a22b8d69745d43c32f5af9185f9a";
const [playedTrigger] = program.abilities;
const buffInstruction = playedTrigger.body[0];
const targetSpec = buffInstruction.targets[0];

/** Run the card's own buff instruction with the locked friendly units. */
const buffChosen = (kernel, ids) =>
  runInstruction(
    buff,
    { mode: "buff", target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: ids.map(id => kernel.ref(id)) } }
  );

test("Kinkou Monk program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("identity: canonicalCardId, ruleset, status, judgeReason, verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /other/);
  assert.match(program.judgeReason, /355\.7/);
  assert.equal(
    program.sourceText,
    "When you play me, buff up to two other friendly units. (Each one that doesn't have a buff gets a +1 :rb_might: buff.)"
  );
});

test("structure: played trigger with an up-to-two other friendly units target", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(playedTrigger.kind, "triggered");
  assert.equal(playedTrigger.trigger.at, "card-played");
  assert.deepEqual(playedTrigger.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(playedTrigger.optional, false);

  assert.equal(playedTrigger.body.length, 1);
  assert.equal(buffInstruction.id, "kinkou.buff-up-to-two");
  assert.equal(buffInstruction.op, "effect.buff");
  assert.deepEqual(buffInstruction.args, {
    mode: { kind: "constant", value: "buff" },
    target: { kind: "constant", value: "kinkou.other-friendly-units" }
  });
  // "up to two other friendly units": a target group of 0..2 (CR 355.7, 355.13)
  // limited to the controller's other units.
  assert.equal(buffInstruction.targets.length, 1);
  assert.deepEqual(targetSpec, {
    id: "kinkou.other-friendly-units",
    filter: { type: "unit", zone: "board", controller: "controller", other: true },
    min: 0,
    max: 2,
    selection: "up-to"
  });
  assert.equal(buffInstruction.picks, undefined);
  assert.equal(buffInstruction.linkedTo, undefined);
});

test("golden: both chosen units are buffed once each (CR 702.2.a)", () => {
  const kernel = world()
    .unit("monk", { might: 4, owner: "A" })
    .unit("ally-one", { owner: "A" })
    .unit("ally-two", { owner: "A" })
    .build();
  const run = buffChosen(kernel, ["ally-one", "ally-two"]);
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("ally-one").buffs, 1);
  assert.equal(kernel.getObject("ally-two").buffs, 1);
  assert.equal(kernel.getObject("monk").buffs, 0);
  assert.deepEqual(run.linked.buffedCount, 2);
  assert.deepEqual(run.events.map(event => event.action), ["buff", "buff"]);
});

test("golden: locking zero units leaves every unit untouched (effect.buff reports ignored)", () => {
  // CR 355.13 allows choosing zero for "up to two". With an empty locked set,
  // the merged effect.buff reports ignored/mistargeted (its documented boundary:
  // no still-legal objects). Either way nothing is buffed; the zero-choice
  // classification is tracked by the target-system TODO below.
  const kernel = world().unit("monk", { owner: "A" }).unit("ally-one", { owner: "A" }).build();
  const run = buffChosen(kernel, []);
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
  assert.equal(kernel.getObject("ally-one").buffs, 0);
  assert.equal(run.events.length, 0);
});

test("golden: units that already have a buff are skipped, the rest are buffed (CR 702.3.a/427.1.c)", () => {
  const kernel = world()
    .unit("monk", { owner: "A" })
    .unit("charged", { owner: "A", buffs: 1 })
    .unit("fresh", { owner: "A" })
    .build();
  const run = buffChosen(kernel, ["charged", "fresh"]);
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("charged").buffs, 1);
  assert.equal(kernel.getObject("fresh").buffs, 1);
  assert.deepEqual(run.linked.buffedCount, 1);
});

test.todo(
  "Kinkou Monk: classifying a legal zero-target choice for 'up to two' (CR 355.13) — the merged " +
    "effect.buff returns ignored/mistargeted when its locked target set is empty, which is a target-system " +
    "/ primitive boundary (RIFT-90)"
);
test.todo(
  "Kinkou Monk: 'up to two other friendly units' — the merged target/target-plan.ts and interpreter " +
    "prepareTargets do not implement the `other` filter key, so the source cannot be excluded from the " +
    "candidate set and the 0..2 bound is not re-verified by the target system (CR 355.7/355.13, RIFT-90)"
);
test.todo(
  "Kinkou Monk: the played trigger only becomes reachable once the card-played timing emitted by " +
    "chain/engine.ts is wired through the server-facing runtime (engine batch 4)"
);
