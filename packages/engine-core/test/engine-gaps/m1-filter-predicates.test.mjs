// RIFT-932: ObjectFilter predicates for equipped hosts and printed Energy
// ceilings. Rule evidence: CR v1.5 206, 355.8-355.9.b, 818.3.b.
// The ProgramBinding + ChainEngine + lifecycle harness below is the same
// production assembly used by the engine-gaps goldens.
import assert from "node:assert/strict";
import test from "node:test";

import { queryObjects } from "../../dist/effects/interpreter/selectors.js";
import { world } from "../../dist/effects/testing/index.js";
import { ProgramBindingError } from "../../dist/programs/errors.js";
import { translateObjectFilter } from "../../dist/programs/filters.js";
import { fixture, settle } from "../rules/keywords/support.mjs";

const constant = value => ({ kind: "constant", value });

function environment(kernel, host) {
  return {
    context: kernel,
    host: host.ref,
    linked: id => kernel.linked(id),
    canLookBack: () => false,
    isIgnored: () => false,
  };
}

function energyCeilingProgram() {
  return {
    canonicalCardId: "test:rift-932-energy-ceiling",
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: "Exhaust a unit whose printed Energy cost is at most 3.",
    abilities: [{
      kind: "activated",
      timing: "action",
      cost: { kind: "explicit", energy: constant(0) },
      body: [{
        id: "rift-932-exhaust-energy-ceiling",
        op: "effect.exhaust",
        args: {
          target: constant("cheap-unit"),
          linkKey: constant("exhausted"),
        },
        targets: [{
          id: "cheap-unit",
          filter: { type: "unit", zone: "board", costEnergyLte: 3 },
          min: 1,
          max: 1,
          selection: "one",
        }],
      }],
    }],
  };
}

function energyCeilingFixture() {
  const program = energyCeilingProgram();
  return fixture({
    programs: [program],
    setup: builder => builder
      .base("source", {
        cardId: program.canonicalCardId,
        types: ["gear"],
        energy: null,
        power: null,
        might: null,
      })
      .unit("equal", { energy: 3, power: null, location: { type: "base", player: "A" } })
      .unit("over", { energy: 4, power: null, location: { type: "base", player: "A" } })
      .unit("no-printed-energy", { energy: null, power: null, location: { type: "base", player: "A" } }),
  });
}

test("RIFT-932 equipped is an inverse Equipment-attachment predicate over live board objects", () => {
  const kernel = world()
    .player("A")
    .player("B")
    .unit("equipped-host")
    .unit("other-host")
    .object("equipment", {
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: null,
      power: null,
      might: null,
    })
    .object("ordinary-gear", {
      types: ["gear"],
      tags: [],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: null,
      power: null,
      might: null,
    })
    .build();
  const filter = translateObjectFilter({ type: "unit", zone: "board", equipped: true });
  const ids = () => queryObjects(filter, environment(kernel, kernel.getObject("equipped-host")))
    .map(object => object.ref.id);

  assert.deepEqual(ids(), [], "an unattached Unit is not equipped");
  assert.equal(kernel.perform({
    type: "attach",
    object: kernel.ref("ordinary-gear"),
    host: kernel.ref("other-host"),
  }).status, "done");
  assert.deepEqual(ids(), [], "a non-Equipment attachment does not make its host equipped");

  assert.equal(kernel.perform({
    type: "attach",
    object: kernel.ref("equipment"),
    host: kernel.ref("equipped-host"),
  }).status, "done");
  assert.deepEqual(ids(), ["equipped-host"]);

  assert.equal(kernel.perform({ type: "detach", object: kernel.ref("equipment") }).status, "done");
  assert.deepEqual(ids(), [], "the next query stops counting the host once the Equipment detaches");
});

test("RIFT-932 costEnergyLte normalizes to a nonnegative integer ceiling", () => {
  assert.deepEqual(
    translateObjectFilter({ type: "unit", zone: "trash", costEnergyLte: 3 }),
    { type: "unit", zone: "trash", costEnergyLte: 3 },
  );
  for (const invalid of [-1, 1.5, Number.NaN, "3", null]) {
    assert.throws(
      () => translateObjectFilter({ costEnergyLte: invalid }),
      error => error instanceof ProgramBindingError && error.code === "invalid-program",
    );
  }
});

test("RIFT-932 costPowerLte stays judge-required while ObjectSnapshot has no printed Power count", () => {
  assert.throws(
    () => translateObjectFilter({ type: "unit", zone: "trash", costPowerLte: 1 }),
    error => error instanceof ProgramBindingError && error.code === "judge-required" &&
      /Unsupported filter field costPowerLte/.test(error.message),
  );
});

test("RIFT-932 production Finalize selects exactly the printed-Energy ceiling", () => {
  const f = energyCeilingFixture();
  f.activate("source");

  const request = f.asked.find(candidate => candidate.id === "target:cheap-unit");
  assert.ok(request, "the activated ability reaches the real TargetPlan");
  assert.deepEqual(request.options, [f.ref("equal")], "3 is legal; 4 and null are not");
  const [item] = f.engine.items;
  assert.equal(item.status, "finalized");
  assert.deepEqual(item.targetPlans[0].selected, [f.ref("equal")]);

  settle(f.engine);
  assert.equal(f.get("equal").exhausted, true);
  assert.equal(f.get("over").exhausted, false);
  assert.equal(f.get("no-printed-energy").exhausted, false);
});

test("RIFT-932 a printed-Energy target remains revalidated when it leaves the Board before Resolve", () => {
  const f = energyCeilingFixture();
  f.activate("source");
  const [item] = f.engine.items;
  assert.equal(item.status, "finalized");
  assert.deepEqual(item.targetPlans[0].selected, [f.ref("equal")]);

  assert.equal(f.engine.commit({ type: "return-to-hand", object: f.ref("equal") }).status, "done");
  f.engine.advance();
  settle(f.engine);
  assert.equal(f.get("equal").zone, "hand");
  assert.equal(f.engine.trace.some(entry => entry.step === "resolved"), true);
  assert.equal(f.engine.pipeline.events.some(event => event.action === "exhaust"), false);
});
