import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import primalStrength from "../../../dist/cards/ogn/primal-strength.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const [speed, play] = primalStrength.abilities;
const [mightInstruction] = play.body;

// The interpreter resolves TargetSpecs at Finalize; golden execution locks the
// already chosen unit through setTargets and runs the real body (the
// smoke-screen / siphon-power convention).
const executionBody = play.body.map(({ targets, ...rest }) => rest);

const registrations = (kernel) => kernel.continuousEffects.map(entry => ({
  effect: entry.effect,
  duration: entry.duration,
  timestamp: 1
}));

const effectiveMight = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;

test("Primal Strength program is structurally valid and executable", () => {
  const result = validateCardProgram(primalStrength);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(primalStrength.status, "executable");
  assert.equal(primalStrength.judgeReason, undefined);
  assert.equal(primalStrength.rulesetVersion, "core-1.5");
  assert.equal(
    primalStrength.canonicalCardId,
    "card.hash-973d0d5d514cd0b81080d51a93fd58adb4be5b542b6ac111f49c4202d30e1abf"
  );
  assert.equal(
    primalStrength.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Give a unit +7 :rb_might: this turn."
  );
  assert.equal(cardRegistryById.get(primalStrength.canonicalCardId), primalStrength);
});

test("Primal Strength structure: [Action] keyword + one-unit +7 Might target", () => {
  assert.equal(primalStrength.abilities.length, 2);
  // [Action] (806) is a speed keyword ability expanded by the keyword registry.
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);

  // "Give a unit +7 [M] this turn": printed amount and duration.
  assert.equal(mightInstruction.id, "primal-strength.give-plus-7");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 7 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  // The chosen unit is read through the contract 3.6 target selector.
  assert.deepEqual(mightInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "primal-strength.unit" }
  });

  // "a unit" is a target on the board (355.9.a.1), so the instruction carries
  // exactly one one-unit TargetSpec.
  assert.equal(mightInstruction.targets.length, 1);
  assert.equal(mightInstruction.targets[0].id, "primal-strength.unit");
  assert.deepEqual(mightInstruction.targets[0].filter, { type: "unit", zone: "board" });
  assert.equal(mightInstruction.targets[0].selection, "one");
  // Exactly one unit: min = max = 1.
  assert.equal(mightInstruction.targets[0].min, 1);
  assert.equal(mightInstruction.targets[0].max, 1);
  assert.equal(mightInstruction.picks, undefined);
  // The instruction is not linkedTo anything: it is the whole effect.
  assert.equal(mightInstruction.linkedTo, undefined);
  assert.equal(mightInstruction.condition, undefined);
});

test("Primal Strength: the printed +7 is not approximated with Buff counters", () => {
  // CR 702/703: a Buff is a +1 Might COUNTER, not a temporary Might
  // modification. The program must not use the merged effect.buff to stand in
  // for the printed +7, and must not use the "effect.might-modify" spelling
  // that has no registered instruction file.
  assert.equal(mightInstruction.op, "continuous.might");
  assert.notEqual(mightInstruction.op, "effect.buff");
  assert.notEqual(mightInstruction.op, "effect.might-modify");
  assert.equal(mightInstruction.args.mode, undefined);
});

test("Primal Strength golden: +7 Might registers an end-of-turn arithmetic effect on the chosen unit", () => {
  const kernel = world().unit("target", { owner: "A", controller: "A", might: 3 }).build();
  kernel.setTargets("primal-strength.unit", [kernel.ref("target")]);

  const outcome = resolveChainBody(executionBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(result => [result.id, result.result.status]),
    [["primal-strength.give-plus-7", "executed"]]
  );
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  // 478 / 478.1.a: Might modifications live in the arithmetic layer, applied
  // through ctx.addContinuous with the end-of-turn duration (317.1.a).
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 7);
  assert.equal(registration.effect.filter.objectId, "target");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.deepEqual(outcome.results[0].result.linkedValues.affected, {
    count: 1,
    objects: [kernel.ref("target")]
  });

  // 143.2.a: Effective Might is the printed 3 plus the +7.
  assert.equal(effectiveMight(kernel, "target"), 10);
});

test("Primal Strength golden: the modification expires at end of turn (317.1.a / 468.7.c)", () => {
  const kernel = world().unit("target", { owner: "A", controller: "A", might: 3 }).build();
  kernel.setTargets("primal-strength.unit", [kernel.ref("target")]);
  resolveChainBody(executionBody, kernel);

  const engine = createLayerEngine(kernel.objects, registrations(kernel));
  assert.equal(engine.evaluate(kernel.ref("target")).might, 10);
  assert.equal(engine.expireAt("turn-end").length, 1);
  assert.equal(engine.evaluate(kernel.ref("target")).might, 3);
});

test("Primal Strength golden: a chosen unit that left the Board is ignored (359.3.e.6)", () => {
  const kernel = world().unit("target", { owner: "A", controller: "A", might: 3 }).build();
  const stale = kernel.ref("target");
  kernel.perform({ type: "kill", object: stale });
  kernel.setTargets("primal-strength.unit", [stale]);

  const outcome = resolveChainBody(executionBody, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.continuousEffects.length, 0);
});

