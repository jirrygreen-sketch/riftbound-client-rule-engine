import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/fading-memories.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CARD_ID = "card.hash-14d6255fe1976a488bb687562e989583b5f23cc0d020651042bf3573f790809b";
const play = program.abilities[0];
const [grantInstruction] = play.body;
const [targetSpec] = grantInstruction.targets;

test("ogn-180-298 Fading Memories: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /816\.1\.b/);
  assert.equal(
    program.sourceText,
    "Give a unit at a battlefield or a gear [Temporary]. (Kill it at the start " +
      "of its controller's Beginning Phase, before scoring.)"
  );
});

test("ogn-180-298 Fading Memories: one Temporary grant over the printed unit-or-gear choice", () => {
  // No speed keyword: the printing has no [Action]/[Reaction] line.
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 1);

  assert.equal(grantInstruction.id, "fading-memories.grant-temporary");
  assert.equal(grantInstruction.op, "continuous.grant-keyword");
  assert.deepEqual(grantInstruction.args, {
    keyword: { kind: "constant", value: "Temporary" },
    target: { kind: "constant", value: "fading-memories.unit-or-gear" }
  });
  assert.equal(grantInstruction.linkedTo, undefined);
  assert.equal(grantInstruction.picks, undefined);

  // "a unit at a battlefield or a gear": a single object choice admitting both
  // shapes (the unit's Location restriction stays descriptive, see judgeReason).
  assert.deepEqual(targetSpec, {
    id: "fading-memories.unit-or-gear",
    filter: { zone: "board", type: ["unit", "gear"] },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("ogn-180-298 Fading Memories golden: the chosen unit gains Temporary", () => {
  const base = world().unit("target", { keywords: [] }).build();
  base.setTargets(targetSpec.id, [base.ref("target")]);
  const kernel = base.clone({ source: base.ref("target"), sourceSnapshot: base.getObject("target") });
  const outcome = runAbilityBody(
    play.body.map(({ targets, ...instruction }) => instruction),
    kernel,
    undefined,
    { host: kernel.ref("target") }
  );

  assert.equal(outcome.results[0].result.status, "executed");
  const layers = createLayerEngine([kernel.getObject("target")], kernel.continuousEffects);
  assert.deepEqual(layers.evaluate(kernel.ref("target")).keywords, [{ id: "Temporary", value: undefined }]);
});

test.todo(
  "ogn-180-298 Fading Memories: CardProgram grants must expand Temporary into its " +
    "beginning-start kill trigger, and the target adapter must support the printed unit-at-battlefield-or-gear " +
    "disjunction (CR 816.1.b/816.1.c; RIFT-257/RIFT-270)"
);
