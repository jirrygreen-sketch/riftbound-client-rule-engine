import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/unforgiven.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { runInstruction, createTestWorld } = await import(
  new URL("effects/testing/index.js", engineCore)
);
const { resolveChainBody } = await import(
  new URL("chain/interpreter-adapter.js", engineCore)
);
const moveDefinition = (await import(new URL("effects/instructions/effect.move.js", engineCore)))
  .default;

const ability = program.abilities[0];
const move = ability.body[0];
const targetSpec = move.targets[0];

function kernelWithUnit({ location, exhausted = false } = {}) {
  const kernel = createTestWorld();
  kernel.addObject(
    {
      ref: { id: "unit", zoneEntryId: 1 },
      name: "unit",
      owner: "A",
      controller: "A",
      zone: "board",
      location: location ?? { type: "battlefield", id: "battlefield-1" },
      exhausted,
      might: 2,
      types: ["unit"],
      tags: [],
      keywords: [],
      energy: null,
      power: null
    },
    "board"
  );
  return kernel;
}

test("unforgiven program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("unforgiven identity: canonicalCardId, ruleset, judge-required status and verbatim text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-6c69039e3668542be770179f1820017af14307a2e3e79a1c71a35edc3e408061"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.4/);
  assert.match(program.judgeReason, /target\.location/);
  assert.match(program.judgeReason, /your base/);
  assert.match(program.judgeReason, /RIFT-109/);
  assert.equal(
    program.sourceText,
    ":rb_energy_2:, :rb_exhaust:: Move a friendly unit to or from your base."
  );
});

test("unforgiven structure: action-speed activated ability, printed cost, one-target move", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.equal(ability.restriction, undefined);
  assert.deepEqual(ability.cost.energy, { kind: "constant", value: 2 });
  assert.deepEqual(ability.cost.payments, [{ kind: "exhaust" }]);
  // The legend itself has no printed energy/power/might; the activated cost is
  // separate and must not be folded into printed values.
  assert.equal(ability.body.length, 1);
  assert.equal(move.id, "unforgiven.move");
  assert.equal(move.op, "effect.move");
  assert.deepEqual(move.args.objects, { kind: "constant", value: { target: "unit" } });
  assert.deepEqual(move.args.to, { kind: "constant", value: "controller-base" });
  assert.equal(move.linkedTo, undefined);
  assert.equal(move.picks, undefined);
  assert.equal(targetSpec.id, "unit");
  assert.deepEqual(targetSpec.filter, { type: "unit", controller: "controller", zone: "board" });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
});

// effect.move parses raw IR Exprs (`argsSchema.parse` receives the unevaluated
// instruction args), so the golden runs the card's own args through
// runInstruction — the same convention as the merged effect.move tests. Full
// body execution through the production chain adapter is covered by the
// golden below.
test("unforgiven golden: the mergeable to-base half really moves a battlefield unit to its controller's base", () => {
  const kernel = kernelWithUnit({ location: { type: "battlefield", id: "battlefield-1" } });
  const run = runInstruction(
    moveDefinition,
    { objects: move.args.objects, to: move.args.to },
    { world: kernel, targets: { unit: [kernel.ref("unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("unit").location, { type: "base", player: "A" });
  assert.equal(run.linked.moved.count, 1);
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
});

test("unforgiven golden: the whole ability body executes through the production chain adapter", () => {
  const kernel = kernelWithUnit({ location: { type: "battlefield", id: "battlefield-1" } });
  kernel.setTargets("unit", [kernel.ref("unit")]);
  const body = ability.body.map(({ targets, ...rest }) => rest);

  const outcome = resolveChainBody(body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["unforgiven.move", "executed"]
  ]);
  assert.deepEqual(kernel.getObject("unit").location, { type: "base", player: "A" });
  assert.deepEqual(outcome.events.map((event) => event.action), ["move-location"]);
});

test("unforgiven golden: a unit already at its base is not moved by the to-base destination", () => {
  const kernel = kernelWithUnit({ location: { type: "base", player: "A" } });
  const run = runInstruction(
    moveDefinition,
    { objects: move.args.objects, to: move.args.to },
    { world: kernel, targets: { unit: [kernel.ref("unit")] } }
  );
  assert.equal(run.result.status, "executed");
  // Same-location Move moves nothing (effect.move: a same-location
  // instruction performs no action and produces no events).
  assert.deepEqual(kernel.getObject("unit").location, { type: "base", player: "A" });
  assert.equal(run.linked.moved.count, 0);
  assert.deepEqual(run.events, []);
});

test("unforgiven golden: a stale target ignores the whole instruction (CR 359.3.e)", () => {
  const kernel = kernelWithUnit();
  const stale = kernel.ref("unit");
  kernel.perform({ type: "kill", object: stale });
  const before = kernel.stateForTest();
  const run = runInstruction(
    moveDefinition,
    { objects: move.args.objects, to: move.args.to },
    { world: kernel, targets: { unit: [stale] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.deepEqual(kernel.stateForTest(), before);
});

test.todo(
  "unforgiven from-base half: Finalize-time legal Battlefield set (CR 355.4/451.1) and the " +
    "direction derived from the unit's current location; needs RIFT-9 target.location and the " +
    "P2 batch-6 card-program wiring."
);

test.todo(
  "unforgiven data issue: ogn-259-298 \"your base\" vs ogn-305-298 / star \"its base\" " +
    "(survey unclassified-ogn §37) must be resolved in card data before the teammate-game " +
    "semantics can be executed (no dataset edits in this task)."
);
