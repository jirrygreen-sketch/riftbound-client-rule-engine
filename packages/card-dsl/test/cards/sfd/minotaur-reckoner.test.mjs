import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/minotaur-reckoner.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { moveDuelUnitsStandard } from "../../../../engine-core/dist/zones/movement.js";
import {
  createDuelBoard,
  placeDuelUnit,
  selectDuelBattlefields,
} from "../../../../engine-core/dist/duel/battlefields.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const ID = "card.hash-4707dc730254c2d3c4ed3484a961094d03925ec45f647f561ff4b106e7e22ebe";
const ability = program.abilities[0];

test("sfd-014-221 Minotaur Reckoner: validates identity and the global prohibition", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(ID), program);
  assert.equal(program.canonicalCardId, ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /单数 restriction/);
  assert.match(program.judgeReason, /DuelMovementRuleContext/);
  assert.match(program.judgeReason, /standard-move-executor-v2/);
  assert.equal(program.sourceText, "Units can't move to base.");
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.movement");
  assert.equal(ability.effect.restriction, "move-to-base");
  // 054.1: a prohibition grants nothing.
  assert.equal(ability.effect.addsPermission, false);
  assert.equal(ability.effect.permission, undefined);
  // 053.2: the text names no host, so the prohibition covers the whole board.
  assert.deepEqual(ability.effect.filter, { type: "unit", zone: "board" });
});

test("sfd-014-221 Minotaur Reckoner: the layer engine records the prohibition on the filtered object", () => {
  const kernel = world()
    .unit("minotaur", { location: { type: "battlefield", id: "bf-1" } })
    .build();
  const object = kernel.getObject("minotaur");
  const engine = createLayerEngine([object], [{
    effect: { id: "minotaur-reckoner", layer: "ability", filter: ability.effect.filter, effect: ability.effect },
    duration: { type: "permanent" },
    timestamp: 1
  }]);
  engine.setObjects([object]);
  assert.deepEqual(engine.evaluate(object.ref).movement.restrictions, ["move-to-base"]);
});

test("sfd-014-221 Minotaur Reckoner: default static binding keeps the original restriction shape pending shared normalization", () => {
  const source = world()
    .unit("minotaur", {
      cardId: ID,
      location: { type: "battlefield", id: "bf-1" }
    })
    .unit("u1", { location: { type: "battlefield", id: "bf-1" } })
    .build();
  const sourceObject = source.getObject("minotaur");
  const targetObject = source.getObject("u1");
  const layers = createLayerEngine([sourceObject, targetObject]);
  const binder = createEngineStaticBinder({ layers });
  const handle = binder.bindStatic(ability, sourceObject);
  const [entry] = layers.registry.list();
  assert.equal(entry.effect.effect.kind, "continuous.movement");
  assert.equal(entry.effect.effect.restriction, "move-to-base");
  assert.equal(entry.effect.effect.restrictions, undefined);
  // This is the production-path compatibility guard: movement() consumes
  // normalized restrictions, so the shared engine must normalize the
  // original instruction before this card can become executable.
  assert.deepEqual(movement(layers.registry, targetObject.ref, targetObject, "A").restrictions, []);
  handle.unbind();
});

test("sfd-014-221 Minotaur Reckoner: the production static binder is the only registration path, so the unnormalized field is what ships", () => {
  // 054.1/144.4.b: the prohibition must reach movement(). createEngineStaticBinder
  // is the production binder (programs/statics.ts); it registers the singular
  // `restriction` field verbatim, which the rule query never reads. The snapshot
  // does fold it, which is why the IR itself is not the defect — the normalization
  // and the missing production rule context are.
  const source = world()
    .unit("minotaur", { cardId: ID, location: { type: "battlefield", id: "bf-1" } })
    .unit("u1", { location: { type: "battlefield", id: "bf-1" } })
    .build();
  const sourceObject = source.getObject("minotaur");
  const targetObject = source.getObject("u1");
  const layers = createLayerEngine([sourceObject, targetObject]);
  const handle = createEngineStaticBinder({ layers }).bindStatic(ability, sourceObject);

  const [entry] = layers.registry.list();
  assert.equal(entry.effect.effect.restriction, "move-to-base");
  assert.equal(entry.effect.effect.restrictions, undefined);
  assert.deepEqual(movement(layers.registry, targetObject.ref, targetObject, "A").restrictions, []);
  assert.deepEqual(layers.evaluate(targetObject.ref).movement.restrictions, ["move-to-base"]);
  handle.unbind();
});

function duelBoard() {
  const board = createDuelBoard(selectDuelBattlefields([
    { playerId: "A", battlefields: [{ instanceId: "a-1", cardId: "f1" }, { instanceId: "a-2", cardId: "f2" }, { instanceId: "a-3", cardId: "f3" }] },
    { playerId: "B", battlefields: [{ instanceId: "b-1", cardId: "f1" }, { instanceId: "b-2", cardId: "f2" }, { instanceId: "b-3", cardId: "f3" }] },
  ], () => 0));
  const base = board.bases.find(value => value.ownerPlayerId === "A").locationId;
  const battlefield = board.battlefields[0].locationId;
  return { board: placeDuelUnit(board, { objectId: "u1", controllerPlayerId: "A", locationId: battlefield }), base, battlefield };
}

const moveRequest = scene => ({
  actor: "A",
  unitUIDs: ["u1"],
  destinationLocationId: scene.base,
  timing: { phase: "main", stateOpen: true, turnPlayerId: "A", priorityPlayerId: "A" }
});
const readiness = [{ objectId: "u1", readied: true, hasGanking: false }];

test("sfd-014-221 Minotaur Reckoner: the movement rule query serves the registered prohibition (CR 054.1)", () => {
  const kernel = world()
    .unit("u1", { location: { type: "battlefield", id: "bf-1" } })
    .build();
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: "minotaur-reckoner",
    layer: "ability",
    source: { id: "minotaur", zoneEntryId: 1 },
    filter: ability.effect.filter,
    effect: { kind: "movement", restrictions: [ability.effect.restriction] },
  }, { type: "permanent" });

  const unit = kernel.getObject("u1");
  const view = movement(registry, unit.ref, unit, "A");
  assert.deepEqual(view.restrictions, ["move-to-base"]);
  // 054.1: the prohibition removes only the Battlefield→Base option.
  assert.equal(view.canMove, true);
  assert.equal(view.canGank, false);
});

test("sfd-014-221 Minotaur Reckoner: a standard move from battlefield to base is prohibited (144.4.b)", () => {
  const scene = duelBoard();
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: "minotaur-reckoner",
    layer: "ability",
    source: { id: "minotaur", zoneEntryId: 1 },
    filter: ability.effect.filter,
    effect: { kind: "movement", restrictions: [ability.effect.restriction] },
  }, { type: "permanent" });
  const kernel = world()
    .unit("u1", { location: { type: "battlefield", id: "bf-1" } })
    .build();
  // The card filter is a rich object filter (type + zone), so the movement
  // gate needs the actual snapshots/refs resolved through the test kernel.
  const snapshot = kernel.getObject("u1");
  assert.throws(
    () => moveDuelUnitsStandard(scene.board, readiness, moveRequest(scene), {
      registry,
      refForUnit: () => ({ id: "u1", zoneEntryId: 1 }),
      objectForUnit: () => snapshot,
    }),
    /prohibited from moving/,
  );
  assert.equal(scene.board.units[0].locationId, scene.battlefield);
});

test("sfd-014-221 Minotaur Reckoner: the same move succeeds once the prohibition expires (054 duration)", () => {
  const scene = duelBoard();
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: "minotaur-reckoner",
    layer: "ability",
    source: { id: "minotaur", zoneEntryId: 1 },
    filter: ability.effect.filter,
    effect: { kind: "movement", restrictions: [ability.effect.restriction] },
  }, { type: "end-of-turn" });
  registry.expireAt({ id: "turn-end" }, () => null);
  const kernel = world()
    .unit("u1", { location: { type: "battlefield", id: "bf-1" } })
    .build();
  const snapshot = kernel.getObject("u1");
  const moved = moveDuelUnitsStandard(scene.board, readiness, moveRequest(scene), {
    registry,
    refForUnit: () => ({ id: "u1", zoneEntryId: 1 }),
    objectForUnit: () => snapshot,
  });
  assert.equal(moved.board.units[0].locationId, scene.base);
});
