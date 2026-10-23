import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/emperors-divide.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createEngineStaticBinder, expandProgram, hiddenPermissionFor } from "../../../../engine-core/dist/programs/index.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { finalizeTargetPlan, resolveTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID = "card.hash-ecb9b44b724f5cf8fc83e9f49da0b24bed461053303201914a0ce0ef8db8ed45";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Move any number of friendly units at a battlefield to their base.";

const [hidden, action, play] = program.abilities;
const [move] = play.body;
const targetSpec = move.targets[0];

/**
 * The reference kernel compares filter values literally, while the production
 * chain query (chain/engine.ts) normalizes controller/owner "self"/"opponent"
 * and the layer matcher (layers/filter.ts) understands a location-type string.
 * Reproduce those two paths so the card's own query shape is what executes.
 */
function productionQuery(kernel) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") {
        return (filter) => {
          const normalized = { ...filter };
          const kernelFilter = { ...normalized };
          const opponents = [];
          for (const playerKey of ["controller", "owner"]) {
            if (normalized[playerKey] === "self") {
              kernelFilter[playerKey] = target.controller;
            } else if (normalized[playerKey] === "opponent") {
              delete kernelFilter[playerKey];
              opponents.push(playerKey);
            }
          }
          if (typeof normalized.location === "string") delete kernelFilter.location;
          return target
            .query(kernelFilter)
            .filter((object) => opponents.every((playerKey) => object[playerKey] !== target.controller))
            .filter((object) => normalized.location === undefined || typeof normalized.location !== "string" ||
              (object.location !== null && object.location.type === normalized.location));
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

test("sfd-043-221 Emperor's Divide: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("sfd-043-221 Emperor's Divide: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("sfd-043-221 Emperor's Divide: judgeReason names the three measured gaps", () => {
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /811\.1\.d\.2/);
  assert.match(program.judgeReason, /811\.1\.b/);
  assert.match(program.judgeReason, /355\.10\.b/);
  // 2026-10-18 re-sweep: name the measured halves instead of the merged tasks.
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /invalid-location-kind/);
  assert.match(program.judgeReason, /isLocationSelectorValue/);
  assert.match(program.judgeReason, /355\.11\.b/);
  assert.match(program.judgeReason, /only has a type definition|只有类型定义/);
  assert.doesNotMatch(program.judgeReason, /RIFT-/);
});

test("sfd-043-221 Emperor's Divide: [Hidden] and [Action] keywords plus the printed cost", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  // Catalog printed cost: 2 energy, no printed Power (null is never 0).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
});

test("sfd-043-221 Emperor's Divide: any-number friendly units at a battlefield move to their base", () => {
  assert.equal(play.body.length, 1);
  assert.equal(move.id, "emperors-divide.move-units");
  assert.equal(move.op, "effect.move");
  assert.equal(move.linkedTo, undefined);
  assert.deepEqual(move.args.objects, {
    kind: "constant",
    value: { target: "emperors-divide.units" }
  });
  // 107.1.c: each unit's Base is its controller's Base.
  assert.deepEqual(move.args.to, { kind: "constant", value: "controller-base" });
  // "any number" ceiling = the number of units locked at Finalize.
  assert.deepEqual(move.args.amount, {
    kind: "count",
    subject: "units",
    filter: { object: { target: "emperors-divide.units" } }
  });

  // 355.12: every chosen unit is a target chosen independently of the Move;
  // 355.13: "any number" includes zero, so min 0 with selection "up-to".
  assert.equal(targetSpec.id, "emperors-divide.units");
  assert.deepEqual(targetSpec.filter, {
    type: "unit",
    controller: "self",
    location: "battlefield"
  });
  assert.equal(targetSpec.min, 0);
  assert.equal(targetSpec.max, null);
  assert.equal(targetSpec.selection, "up-to");
});

test("sfd-043-221 Emperor's Divide golden: the chosen units leave the battlefield for their base", () => {
  const kernel = world()
    .unit("one", { owner: "A", controller: "A", exhausted: true, damage: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("two", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("home", { owner: "A", controller: "A", location: { type: "base", player: "A" } })
    .unit("enemy", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets("emperors-divide.units", [kernel.ref("one"), kernel.ref("two")]);

  const outcome = resolveChainBody(play.body, productionQuery(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["emperors-divide.move-units", "executed"]]
  );
  assert.equal(outcome.results[0].result.linkedValues.moved.count, 2);
  assert.deepEqual(kernel.getObject("one").location, { type: "base", player: "A" });
  assert.deepEqual(kernel.getObject("two").location, { type: "base", player: "A" });
  // A unit already in Base is not chosen (355.4.a); the enemy unit is untouched.
  assert.deepEqual(kernel.getObject("home").location, { type: "base", player: "A" });
  assert.deepEqual(kernel.getObject("enemy").location, { type: "battlefield", id: "bf-1" });
  // An effect Move is not the Standard Move and not a Recall (457-460):
  // statuses and marked damage stay as they are.
  assert.equal(kernel.getObject("one").exhausted, true);
  assert.equal(kernel.getObject("one").damage, 2);
});

test("sfd-043-221 Emperor's Divide golden: only the still-legal member of a mistargeted group moves (359.3.e.8)", () => {
  const kernel = world()
    .unit("staying", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("leaving", { owner: "A", controller: "A" })
    .build();
  const stale = kernel.ref("leaving");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  kernel.setTargets("emperors-divide.units", [kernel.ref("staying"), stale]);

  const outcome = resolveChainBody(play.body, productionQuery(kernel));

  // One member of the group left the board, so the resolution is partial
  // (359.3.e.8) while the remaining legal unit still moves.
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues.moved.objects.map((ref) => ref.id), ["staying"]);
  assert.deepEqual(kernel.getObject("staying").location, { type: "base", player: "A" });
});

test("sfd-043-221 Emperor's Divide golden: choosing zero units is a legal play that moves nothing (355.13)", () => {
  const kernel = world()
    .unit("one", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets("emperors-divide.units", []);

  const outcome = resolveChainBody(play.body, productionQuery(kernel));

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(kernel.getObject("one").location, { type: "battlefield", id: "bf-1" });
});

test("sfd-043-221 Emperor's Divide: the merged Hidden expansion binds a production permission", () => {
  const kernel = world()
    .card("divide", {
      cardId: program.canonicalCardId,
      types: ["spell"],
      zone: "board",
      energy: 2,
      power: null
    })
    .build();
  const source = kernel.getObject("divide");
  const expanded = expandProgram(program, source).expanded;
  const hiddenExpansion = expanded.find(ability => ability.kind === "static" && ability.effect.kind === "cost.hidden");
  assert.ok(hiddenExpansion, "Hidden must expand to the merged cost.hidden declaration");
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("A static permission must not ask for a choice"); },
    context: (sourceValue, controller, timingPoint) =>
      bindResolveContext(kernel, { source: sourceValue, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host });
  const handle = createEngineStaticBinder(engine).bindStatic(hiddenExpansion, source);
  assert.equal(hiddenPermissionFor(engine, source), "present");
  handle.unbind();
  assert.equal(hiddenPermissionFor(engine, source), "absent");
});

test("sfd-043-221 Emperor's Divide: the engine zone vocabulary still has no facedown zone (811.1.b)", () => {
  // Live evidence for the first half of the refreshed reason: nothing consumes
  // the Hidden expansion, and the engine's own zone contract has no facedown
  // zone for the Hide action to store the card in. The V2 display name exists
  // only in the server projection.
  const zones = ["hand", "deck", "rune-deck", "trash", "banishment", "board", "rune-zone", "chain"];
  assert.equal(zones.includes("facedown"), false);
  const kernel = world().card("divide", {
    cardId: program.canonicalCardId,
    types: ["spell"],
    zone: "board",
    energy: 2,
    power: null
  }).build();
  const source = kernel.getObject("divide");
  // The merged zoneSlice has no facedown bucket: asking for one reads through
  // to an undefined zone array instead of a supported zone.
  let failed = false;
  try { kernel.zoneSlice("A", "facedown", "top"); } catch { failed = true; }
  assert.equal(failed, true, "facedown is not a supported engine zone");
  assert.equal(source.faceDown, false);
});

test("sfd-043-221 Emperor's Divide: the 811.1.d.2 origin-bound location is rejected by card validation", () => {
  // Live evidence for the second half: "all units chosen for the spell must be
  // located at the same battlefield it was played from" needs an origin-bound
  // location, but TargetSpec.location only validates as a LocationFilter. Every
  // symbolic selector spelling the target plan can consume is rejected.
  const [hidden, action, play] = program.abilities;
  const [move] = play.body;
  const spellings = [
    "source-location",
    { kind: "location-selector", locationOf: "source" },
    { kind: "location-of", object: "source" },
    { kind: "target-location", target: "emperors-divide.units" }
  ];
  for (const value of spellings) {
    const candidate = {
      ...program,
      status: "executable",
      judgeReason: undefined,
      abilities: [hidden, action, {
        ...play,
        body: [{ ...move, targets: [{ ...move.targets[0], location: { kind: "location", value } }] }]
      }]
    };
    const result = validateCardProgram(candidate);
    assert.equal(result.ok, false, JSON.stringify({ value, issues: result.ok ? [] : result.issues }));
    assert.ok(
      result.issues.some((issue) => issue.code === "invalid-location-kind"),
      `expected an invalid-location-kind issue for ${JSON.stringify(value)}`
    );
  }

  // The plain battlefield filter (the shape the shipped program carries) is the
  // only one that validates, and it cannot bind the origin.
  const withFilter = {
    ...program,
    status: "executable",
    judgeReason: undefined,
    abilities: [hidden, action, {
      ...play,
      body: [{ ...move, targets: [{ ...move.targets[0], location: { type: "battlefield" } }] }]
    }]
  };
  assert.equal(validateCardProgram(withFilter).ok, true);
});

test("sfd-043-221 Emperor's Divide: the 355.11 group requirement still has no consumer", () => {
  // Live evidence for the third gap: the TargetRequirement contract carries
  // kind/group as data, but nothing in the engine reads it. A same-battlefield
  // choice and the 355.11.b/.b.1 maximal legal subset re-choice at resolution
  // therefore never happen.
  const kernel = world()
    .unit("one", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("two", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-2" } })
    .build();
  const source = kernel.getObject("one");
  // productionQuery normalizes controller "self"/"opponent" and the location
  // type string exactly as the chain query does.
  const context = bindResolveContext(productionQuery(kernel), { source, controller: "A" });
  const [move] = play.body;

  // Locking a group requirement keeps the kind on the plan but applies no
  // group-level constraint: two units at DIFFERENT battlefields are accepted
  // for the same "group" requirement.
  const groupPlan = finalizeTargetPlan(context, {
    ...move.targets[0],
    kind: "group",
    min: 0
  }, { selected: [kernel.ref("one"), kernel.ref("two")] });
  assert.equal(groupPlan.requirement.kind, "group");
  assert.deepEqual(groupPlan.selected.map((ref) => ref.id), ["one", "two"]);

  // Resolution re-tests per object only (359.3.e.8 semantics); a split group is
  // never narrowed to the 355.11.b/.b.1 maximal same-battlefield subset, so the
  // spell would move units from both battlefields.
  const resolution = resolveTargetPlan(context, groupPlan, {});
  assert.equal(resolution.status, "resolved");
  assert.deepEqual(resolution.selected.map((ref) => ref.id), ["one", "two"]);
});
