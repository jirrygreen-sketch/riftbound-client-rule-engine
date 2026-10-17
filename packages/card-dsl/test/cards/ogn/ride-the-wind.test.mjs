import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/ride-the-wind.js";
// Card bodies are executed through the chain's own interpreter adapter (the
// production entry point): it re-wraps each instruction's Expr arguments so
// the registered primitives validate and evaluate them exactly as the engine
// does. Calling runAbilityBody directly would see already-evaluated arguments.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";

const CARD_ID = "card.hash-2df39111dd690c251a044601ce12b0c17ee57b43f9d29ce2de47654b25a9110c";
const play = program.abilities.find((ability) => ability.kind === "play");
const [moveInstruction, readyInstruction] = play.body;
const targetSpec = moveInstruction.targets[0];

const battlefieldUnit = (extra = {}) =>
  world()
    .unit("friendly-unit", {
      owner: "A",
      controller: "A",
      exhausted: true,
      location: { type: "battlefield", id: "battlefield-1" },
      ...extra
    })
    .build();

// The reference kernel compares filter values literally, so "controller: self"
// cannot be resolved from inside the test kernel. The interpreter normally
// receives Finalize-locked targets through ctx.targets(); supply them directly
// (the same convention the merged pit-rookie golden test uses) and keep the
// TargetSpec itself asserted structurally above.
const executionBody = play.body.map(({ targets, ...instruction }) => instruction);

// CR 355.4: the Move destination is chosen by the spell's controller during
// Finalize, so the options list is runtime-derived (data only records the
// "choose" shape). The golden test supplies the destination that player chose,
// exactly as it supplies locked targets.
const moveDestination = { type: "battlefield", id: "battlefield-2" };
const executionBodyTo = (destination) =>
  executionBody.map((instruction) =>
    instruction.id === "ride-the-wind.move"
      ? { ...instruction, args: { ...instruction.args, to: { kind: "constant", value: destination } } }
      : instruction
  );

test("ogn-173-298 Ride the Wind: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /RIFT-84/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /RIFT-259/);
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Move a friendly unit and ready it."
  );
});

test("ogn-173-298 Ride the Wind: [Action] keyword plus move-then-ready on one friendly unit", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "action" });

  assert.equal(play.kind, "play");
  assert.deepEqual(play.body.map((instruction) => [instruction.id, instruction.op]), [
    ["ride-the-wind.move", "effect.move"],
    ["ride-the-wind.ready", "effect.ready"]
  ]);

  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "ride-the-wind.friendly-unit" }
  });
  // The destination is the Finalize-time Location choice (355.4), recorded as
  // the primitive's choose shape with runtime-derived options.
  assert.deepEqual(moveInstruction.args.to, {
    kind: "constant",
    value: {
      kind: "choose",
      id: "ride-the-wind.destination",
      options: ["legal-locations-other-than-the-units-current-location"]
    }
  });
  assert.deepEqual(targetSpec, {
    id: "ride-the-wind.friendly-unit",
    filter: { type: "unit", zone: "board", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "and ready it": same TargetSpec read back through a symbolic selector, and
  // deliberately NOT linked to the Move (CR 359.3.e.14.b).
  assert.deepEqual(readyInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "ride-the-wind.friendly-unit" }
  });
  assert.deepEqual(readyInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(readyInstruction.linkedTo, undefined);
  assert.equal(readyInstruction.targets, undefined);
});

test("ogn-173-298 Ride the Wind golden: the chosen destination is applied and the unit is readied", () => {
  const kernel = battlefieldUnit();
  const run = runInstruction(
    move,
    { objects: moveInstruction.args.objects, to: { kind: "constant", value: moveDestination } },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("friendly-unit")] } }
  );
  assert.equal(run.result.status, "executed");

  const readied = runInstruction(
    ready,
    { objects: readyInstruction.args.objects, amount: readyInstruction.args.amount },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("friendly-unit")] } }
  );
  assert.equal(readied.result.status, "executed");
  assert.deepEqual(kernel.getObject("friendly-unit").location, moveDestination);
  assert.equal(kernel.getObject("friendly-unit").exhausted, false);
  assert.deepEqual(run.linked.moved.count, 1);
  assert.deepEqual(readied.linked.readied.count, 1);
});

test("ogn-173-298 Ride the Wind golden: a negated Move still lets the ready execute (359.3.e.14.b)", () => {
  for (const [status, reason] of [
    ["replaced", "replaced"],
    ["prevented", "skipped"],
    ["impossible", "impossible"]
  ]) {
    const kernel = battlefieldUnit();
    kernel.addReplacement((action) => (action.type === "move-location" ? status : null));
    kernel.setTargets(targetSpec.id, [kernel.ref("friendly-unit")]);
    const outcome = resolveChainBody(executionBodyTo(moveDestination), kernel);

    assert.equal(outcome.status, "partial");
    assert.deepEqual(
      outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
      [
        ["ride-the-wind.move", "negated", reason],
        ["ride-the-wind.ready", "executed", null]
      ]
    );
    // The Move never happened, but the unit still readies ("the ready
    // instruction will still execute").
    assert.deepEqual(kernel.getObject("friendly-unit").location, { type: "battlefield", id: "battlefield-1" });
    assert.equal(kernel.getObject("friendly-unit").exhausted, false);
  }
});

test("ogn-173-298 Ride the Wind golden: a stale unit keeps the ready a no-op, not a resurrection", () => {
  const kernel = battlefieldUnit();
  const stale = kernel.ref("friendly-unit");
  kernel.setTargets(targetSpec.id, [stale]);
  kernel.perform({ type: "return-to-hand", object: stale });
  const outcome = resolveChainBody(executionBodyTo(moveDestination), kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason ?? null]),
    [
      ["ride-the-wind.move", "ignored", "mistargeted"],
      ["ride-the-wind.ready", "ignored", "mistargeted"]
    ]
  );
  assert.equal(kernel.getObject("friendly-unit").zone, "hand");
});

test.todo(
  "ogn-173-298 Ride the Wind: the 355.4 destination choice (a legal Location other than the " +
    "unit's current one) needs the Finalize/Make-relevant-choices lifecycle (RIFT-84/RIFT-90); " +
    "the [Action] Showdown permission is now decidable through the merged continuous.timing grant consumer (RIFT-259)"
);
