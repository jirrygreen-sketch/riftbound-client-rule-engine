import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/vilemaws-lair.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { movement as movementQuery } from "../../../../engine-core/dist/layers/rules/query.js";
import { restrictions as ruleRestrictions } from "../../../../engine-core/dist/layers/rules/query.js";
import continuousMovement from "../../../../engine-core/dist/effects/instructions/continuous.movement.js";
import moveInstruction from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-3e2d969f2528a782a98c698fc45d9937d376dd06244c444271adf9cbd4100e77";
const SOURCE_TEXT = "Units can't move from here to base.";

const [ability] = program.abilities;

function unit(id, overrides = {}) {
  return {
    ref: { id, zoneEntryId: 1 },
    cardId: "card:" + id,
    name: id,
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    might: 2,
    energy: 1,
    power: ["Fury"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...overrides
  };
}

test("Vilemaw's Lair program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /054\.1/);
  assert.match(program.judgeReason, /358\.3\.a/);
  assert.match(program.judgeReason, /move-location/);
  assert.match(program.judgeReason, /Standard Move/);
  // Re-probed 2026-10-17: the prohibition really does hold on Standard Move and
  // really is absent from the effect-move path, which is the named gap.
  assert.match(program.judgeReason, /effect\.move/);
  assert.match(program.judgeReason, /routeBlocked/);
  // 054.1 ("Can't beats Can") is the operative rule; the reason must also name
  // the missing consumer, not just "not implemented".
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("Vilemaw's Lair structure: one passive movement restriction on units here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 144.4.b defines the Battlefield→Base Standard Move this restriction removes;
  // 421.1/449 describe Move itself.
  assert.equal(ability.effect.kind, "continuous.movement");
  assert.equal(ability.effect.restriction, "move-from-here-to-base");
  assert.deepEqual(ability.effect.restrictions, ["move-from-here-to-base"]);
  // 054.1: a prohibition only removes the option; it grants nothing.
  assert.equal(ability.effect.addsPermission, false);
  assert.equal(ability.effect.permission, undefined);
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self"
  });
});

test("Vilemaw's Lair golden: the merged layer engine records the declared restriction", () => {
  const unitHere = unit("unit-here");
  const engine = createLayerEngine([unitHere], [
    {
      effect: {
        id: "vilemaws-lair",
        layer: "ability",
        filter: ability.effect.filter,
        effect: ability.effect
      },
      duration: { type: "permanent" },
      timestamp: 1
    }
  ]);
  engine.setObjects([unitHere]);

  const snapshot = engine.evaluate(unitHere.ref);
  // The restriction is recorded on the layered object...
  assert.deepEqual(snapshot.movement.restrictions, ["move-from-here-to-base"]);
  // ...and, being a prohibition, it does not flip the baseline permission flags
  // or create a Ganking-style permission.
  assert.equal(snapshot.movement.allowed, true);
  assert.equal(snapshot.movement.canMove, true);
  assert.equal(snapshot.movement.canGank, false);
  assert.equal(snapshot.keywords.length, 0);
});

test("Vilemaw's Lair golden: the merged continuous.movement primitive registers the declared restriction and movement() reads it back", () => {
  // The declaration itself is executable data: feed the authored effect kind /
  // restriction name through the real primitive and the real layers/rules query.
  // The production static binder is exercised separately below.
  const c = value => ({ kind: "constant", value });
  const kernel = world().unit("unit-here").build();
  const run = runInstruction(
    continuousMovement,
    {
      restriction: c(ability.effect.restriction),
      addsPermission: c(false),
      appliesTo: c({ type: "unit", zone: "board" })
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");

  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  const view = movementQuery(registry, kernel.ref("unit-here"), kernel.getObject("unit-here"));
  assert.deepEqual(view.restrictions, ["move-from-here-to-base"]);
  // 054.1: a prohibition does not flip the baseline permission flags.
  assert.equal(view.canMove, true);
  assert.equal(view.canGank, false);
  assert.deepEqual(view.permissions, []);
});



test("Vilemaw's Lair: production static binding prohibits both players' Standard Moves from here and preserves other locations", async () => {
  const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");
  const { createEngineStaticBinder } = await import("../../../../engine-core/dist/programs/statics.js");
  const { selectDuelBattlefields, createDuelBoard, placeDuelUnit } = await import("../../../../engine-core/dist/duel/battlefields.js");
  const { moveDuelUnitsStandard } = await import("../../../../engine-core/dist/zones/movement.js");
  const selection = selectDuelBattlefields(["A", "B"].map(playerId => ({
    playerId, battlefields: [1, 2, 3].map(index => ({ instanceId: `${playerId}-${index}`, cardId: `${playerId}-field-${index}` }))
  })), () => 0);
  let board = createDuelBoard(selection);
  const [here, elsewhere] = board.battlefields.map(field => field.locationId);
  const bases = Object.fromEntries(board.bases.map(base => [base.ownerPlayerId, base.locationId]));
  const entries = [["here-a", "A", here], ["here-b", "B", here], ["elsewhere-a", "A", elsewhere]];
  const f = fixture({ cards: [
    { id: "lair", cardId: CANONICAL, types: ["battlefield"], energy: null, power: null },
    ...entries.map(([id, owner]) => ({ id, owner, controller: owner, types: ["unit"] }))
  ] });
  for (const [id, owner, locationId] of entries) {
    board = placeDuelUnit(board, { objectId: id, controllerPlayerId: owner, locationId });
    f.engine.commit({ type: "move-zone", object: f.kernel.ref(id), to: "board", location: { type: "battlefield", id: locationId } });
  }
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("lair"), to: "board", location: { type: "battlefield", id: here } });
  const handle = createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject("lair"));
  const readiness = board.units.map(unit => ({ objectId: unit.objectId, readied: true, hasGanking: false }));
  const rules = {
    registry: f.engine.layers.registry,
    refForUnit: unit => f.kernel.ref(unit.objectId),
    objectForUnit: unit => f.kernel.getObject(unit.objectId)
  };
  const request = (actor, id) => ({
    actor, unitUIDs: [id], destinationLocationId: bases[actor],
    timing: { phase: "main", stateOpen: true, turnPlayerId: actor, priorityPlayerId: actor }
  });
  for (const [actor, id] of [["A", "here-a"], ["B", "here-b"]]) {
    assert.throws(() => moveDuelUnitsStandard(board, readiness, request(actor, id), rules), /prohibited from moving/);
  }
  const allowed = moveDuelUnitsStandard(board, readiness, request("A", "elsewhere-a"), rules);
  assert.equal(allowed.board.units.find(unit => unit.objectId === "elsewhere-a").locationId, bases.A);
  assert.equal(allowed.readiness.find(unit => unit.objectId === "elsewhere-a").readied, false);
  handle.unbind();
  const released = moveDuelUnitsStandard(board, readiness, request("A", "here-a"), rules);
  assert.equal(released.board.units.find(unit => unit.objectId === "here-a").locationId, bases.A);
});

test("Vilemaw's Lair boundary: effect.move still moves a unit from here to base with the restriction registered in the same world (CR 054.1 / 358.3.a / 359.3.e.14.b)", () => {
  // Re-probed 2026-10-17: Standard Move consults the route table, but effect.move
  // submits a move-location GameAction and neither that primitive nor the
  // ChainEngine move path reads layers/rules movement restrictions. The
  // restriction below is registered in the very world the effect Move runs in
  // (the primitive's own contract: move-location owns path restrictions).
  const f = fixture({ cards: [
    { id: "lair", cardId: CANONICAL, types: ["battlefield"], energy: null, power: null },
    { id: "unit-here", owner: "A", controller: "A", types: ["unit"], might: 2 }
  ] });
  const here = { type: "battlefield", id: "battlefield-1" };
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("lair"), to: "board", location: here });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("unit-here"), to: "board", location: { ...here } });
  createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject("lair"));
  f.engine.layers.setObjects(f.kernel.objects);
  const view = movementQuery(f.engine.layers.registry, f.kernel.ref("unit-here"), f.engine.layers.snapshot(f.kernel.ref("unit-here")), "A");
  assert.deepEqual(view.restrictions, ["move-from-here-to-base"]);
  // The rule query only serves continuous.restrict/requirement effects, so the
  // declared movement kind records nothing for the move action name.
  assert.deepEqual(ruleRestrictions(f.engine.layers.registry, "move", f.kernel.ref("unit-here"), f.engine.layers.snapshot(f.kernel.ref("unit-here")), "A"), []);
  assert.deepEqual(ruleRestrictions(f.engine.layers.registry, "move-location", f.kernel.ref("unit-here"), f.engine.layers.snapshot(f.kernel.ref("unit-here")), "A"), []);

  // Register the same declaration in the world itself, then run the effect Move
  // against it: the restriction is live and the Move still happens.
  const c = value => ({ kind: "constant", value });
  runInstruction(continuousMovement, {
    restriction: c("move-from-here-to-base"), addsPermission: c(false), appliesTo: c({ type: "unit", zone: "board" })
  }, { world: f.kernel });
  assert.deepEqual(
    f.kernel.continuousEffects.map(entry => entry.effect.effect.restrictions),
    [["move-from-here-to-base"]]
  );
  // The live registry really reports the restriction for this unit, so the Move
  // below happens with the prohibition active rather than with an inert piece of
  // data.
  const liveRegistry = new ContinuousEffectRegistry();
  for (const entry of f.kernel.continuousEffects) liveRegistry.register(entry.effect, entry.duration);
  const liveUnit = f.kernel.getObject("unit-here");
  assert.deepEqual(movementQuery(liveRegistry, liveUnit.ref, liveUnit, "A").restrictions, ["move-from-here-to-base"]);

  const scoped = f.kernel.clone({ sourceSnapshot: f.kernel.getObject("unit-here") });
  const run = runInstruction(
    moveInstruction,
    { objects: { kind: "constant", value: "self" }, to: { kind: "constant", value: { type: "base", player: "A" } } },
    { world: scoped }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.moved.count, 1);
  assert.deepEqual(scoped.getObject("unit-here").location, { type: "base", player: "A" });
});
