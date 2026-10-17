import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/vilemaws-lair.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { movement as movementQuery } from "../../../../engine-core/dist/layers/rules/query.js";
import continuousMovement from "../../../../engine-core/dist/effects/instructions/continuous.movement.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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

test.todo("Vilemaw's Lair: effect Move must read the same route restriction, negate Battlefield-to-Base movement and continue later independent instructions (CR 054.1 / 358.3.a / 359.3.e.14.b; ChainEngine move-location consumer)");
