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
const captureOrigin = ability.body[0];
const moveFromBase = ability.body[1];
const moveToBase = ability.body[2];
const targetSpec = moveFromBase.targets[0];

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
  kernel.addObject(
    {
      ref: { id: "battlefield-occupant", zoneEntryId: 1 },
      name: "battlefield-occupant",
      owner: "B",
      controller: "B",
      zone: "board",
      location: { type: "battlefield", id: "battlefield-2" },
      exhausted: false,
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

test("unforgiven identity: canonicalCardId, ruleset, executable status and verbatim text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-6c69039e3668542be770179f1820017af14307a2e3e79a1c71a35edc3e408061"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(
    program.sourceText,
    ":rb_energy_2:, :rb_exhaust:: Move a friendly unit to or from your base."
  );
});

test("unforgiven structure: action-speed activated ability, printed cost, captured origin and two directional moves", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.equal(ability.restriction, undefined);
  assert.deepEqual(ability.cost.energy, { kind: "constant", value: 2 });
  assert.deepEqual(ability.cost.payments, [{ kind: "exhaust" }]);
  // The legend itself has no printed energy/power/might; the activated cost is
  // separate and must not be folded into printed values.
  assert.equal(ability.body.length, 3);
  assert.equal(captureOrigin.id, "unforgiven.capture-origin");
  assert.equal(captureOrigin.op, "condition.value");
  assert.deepEqual(captureOrigin.args.value, {
    kind: "object-property",
    object: { target: "unit" },
    property: "location"
  });
  assert.deepEqual(captureOrigin.args.key, { kind: "constant", value: "origin" });
  assert.equal(moveFromBase.id, "unforgiven.move-from-base");
  assert.equal(moveFromBase.op, "effect.move");
  assert.equal(moveFromBase.condition.operator, "eq");
  assert.deepEqual(moveFromBase.args.objects, { kind: "constant", value: { target: "unit" } });
  assert.deepEqual(moveFromBase.args.to, {
    kind: "location",
    value: {
      kind: "choose",
      id: "unforgiven.battlefield",
      filter: { type: "battlefield" }
    }
  });
  assert.equal(moveToBase.id, "unforgiven.move-to-base");
  assert.equal(moveToBase.op, "effect.move");
  assert.equal(moveToBase.condition.operator, "ne");
  assert.deepEqual(moveToBase.args.objects, { kind: "constant", value: { target: "unit" } });
  assert.deepEqual(moveToBase.args.to, {
    kind: "location",
    value: { kind: "target-controller-base", target: "unit" }
  });
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
    {
      objects: moveToBase.args.objects,
      // Direct primitive execution predates LocationExpr normalization; the
      // production chain test below covers the card's typed location form.
      to: { kind: "constant", value: "controller-base" }
    },
    { world: kernel, targets: { unit: [kernel.ref("unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("unit").location, { type: "base", player: "A" });
  assert.equal(run.linked.moved.count, 1);
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
});

test("unforgiven golden: the battlefield-to-base branch executes through the production chain adapter", () => {
  const kernel = kernelWithUnit({ location: { type: "battlefield", id: "battlefield-1" } });
  kernel.setTargets("unit", [kernel.ref("unit")]);
  const body = ability.body.map(({ targets, ...rest }) => rest);

  const outcome = resolveChainBody(body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["unforgiven.capture-origin", "executed"],
    ["unforgiven.move-from-base", "negated"],
    ["unforgiven.move-to-base", "executed"]
  ]);
  assert.deepEqual(kernel.getObject("unit").location, { type: "base", player: "A" });
  assert.deepEqual(outcome.events.map((event) => event.action), ["move-location"]);
});

test("unforgiven golden: a unit at its base moves to a chosen Battlefield", () => {
  const kernel = kernelWithUnit({ location: { type: "base", player: "A" } });
  kernel.setTargets("unit", [kernel.ref("unit")]);
  kernel.setAnswers({
    "unforgiven.move-from-base/unforgiven.battlefield": {
      type: "battlefield",
      id: "battlefield-2"
    }
  });
  const body = ability.body.map(({ targets, ...rest }) => rest);
  const outcome = resolveChainBody(body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["unforgiven.capture-origin", "executed"],
    ["unforgiven.move-from-base", "executed"],
    ["unforgiven.move-to-base", "negated"]
  ]);
  assert.deepEqual(kernel.getObject("unit").location, { type: "battlefield", id: "battlefield-2" });
  assert.deepEqual(outcome.events.map((event) => event.action), ["move-location"]);
});

test("unforgiven golden: a stale target ignores the whole instruction (CR 359.3.e)", () => {
  const kernel = kernelWithUnit();
  const stale = kernel.ref("unit");
  kernel.perform({ type: "kill", object: stale });
  const before = kernel.stateForTest();
  const run = runInstruction(
    moveDefinition,
    { objects: moveToBase.args.objects, to: { kind: "constant", value: "controller-base" } },
    { world: kernel, targets: { unit: [stale] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.deepEqual(kernel.stateForTest(), before);
});
