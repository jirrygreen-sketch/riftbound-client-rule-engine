// RIFT-667 single-card golden: validation, identity, the key IR structure of
// Minotaur Reckoner, and the merged rule-query / Standard Move halves. The
// whole-card execution evidence (its own scenario through the generic card harness
// plus the measured outcome of binding its own static ability with the production
// binder) lives in `test/cards/templates/static-667.test.mjs`.
//
// The card stays judge-required: the rule query really serves the prohibition, but
// no production caller supplies a DuelMovementRuleContext to the Standard Move and
// effect.move never consults the query at all. Nothing here approximates it.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/minotaur-reckoner.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { moveDuelUnitsStandard } from "../../../../engine-core/dist/zones/movement.js";
import { createDuelBoard, placeDuelUnit, selectDuelBattlefields } from "../../../../engine-core/dist/duel/battlefields.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const ID = "card.hash-4707dc730254c2d3c4ed3484a961094d03925ec45f647f561ff4b106e7e22ebe";
const ability = program.abilities[0];

function duelScene() {
  const selection = selectDuelBattlefields([
    { playerId: "A", battlefields: [{ instanceId: "a-1", cardId: "f1" }, { instanceId: "a-2", cardId: "f2" }, { instanceId: "a-3", cardId: "f3" }] },
    { playerId: "B", battlefields: [{ instanceId: "b-1", cardId: "f1" }, { instanceId: "b-2", cardId: "f2" }, { instanceId: "b-3", cardId: "f3" }] },
  ], () => 0);
  const empty = createDuelBoard(selection);
  const battlefield = empty.battlefields[0].locationId;
  const base = empty.bases.find(value => value.ownerPlayerId === "A").locationId;
  const board = placeDuelUnit(empty, { objectId: "u1", controllerPlayerId: "A", locationId: battlefield });
  return { board, base, battlefield };
}

test("sfd-014-221 Minotaur Reckoner: program validates, keeps identity and the global prohibition", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(ID), program);
  assert.equal(program.canonicalCardId, ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "Units can't move to base.");
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.movement");
  // RIFT-667: both spellings ship. The rule query reads the plural and the layer
  // snapshot folds the singular; declaring only one silently broke a path.
  assert.equal(ability.effect.restriction, "move-to-base");
  assert.deepEqual(ability.effect.restrictions, ["move-to-base"]);
  // 054.1: a prohibition grants nothing.
  assert.equal(ability.effect.addsPermission, false);
  assert.equal(ability.effect.permission, undefined);
  // 053.2: the text names no host, so the prohibition covers the whole board.
  assert.deepEqual(ability.effect.filter, { type: "unit", zone: "board" });
});

test("sfd-014-221 Minotaur Reckoner: the production binding really reaches the rule query", () => {
  const kernel = world()
    .unit("minotaur", { cardId: ID, location: { type: "battlefield", id: "bf-1" } })
    .unit("u1", { location: { type: "battlefield", id: "bf-1" } })
    .build();
  const source = kernel.getObject("minotaur");
  const target = kernel.getObject("u1");
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("A static binding must not ask for a choice"); },
    context: (snapshot, controller, timingPoint) => bindResolveContext(kernel, { source: snapshot, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host });
  const handle = createEngineStaticBinder(engine).bindStatic(ability, source);
  const view = movement(engine.layers.registry, target.ref, target, "A");
  assert.deepEqual(view.restrictions, ["move-to-base"]);
  // 054.1: the prohibition removes only the Battlefield-to-Base option.
  assert.equal(view.canMove, true);
  assert.equal(view.canGank, false);
  handle.unbind();
});

test("sfd-014-221 Minotaur Reckoner: a Standard Move from battlefield to base is prohibited with a rules context", () => {
  const scene = duelScene();
  const registry = new ContinuousEffectRegistry();
  registry.register({
    id: "minotaur-reckoner",
    layer: "ability",
    source: { id: "minotaur", zoneEntryId: 1 },
    filter: ability.effect.filter,
    effect: { kind: "movement", restrictions: [ability.effect.restriction] },
  }, { type: "permanent" });
  const kernel = world().unit("u1", { location: { type: "battlefield", id: "bf-1" } }).build();
  const snapshot = kernel.getObject("u1");
  // 144.4.b: with the rule context supplied, the route really is blocked.
  assert.throws(
    () => moveDuelUnitsStandard(scene.board, [{ objectId: "u1", readied: true, hasGanking: false }], {
      actor: "A",
      unitUIDs: ["u1"],
      destinationLocationId: scene.base,
      timing: { phase: "main", stateOpen: true, turnPlayerId: "A", priorityPlayerId: "A" }
    }, { registry, refForUnit: () => ({ id: "u1", zoneEntryId: 1 }), objectForUnit: () => snapshot }),
    /prohibited from moving/
  );
  // The same Move is allowed once the prohibition expires (054 duration).
  const expiring = new ContinuousEffectRegistry();
  expiring.register({
    id: "minotaur-reckoner",
    layer: "ability",
    source: { id: "minotaur", zoneEntryId: 1 },
    filter: ability.effect.filter,
    effect: { kind: "movement", restrictions: [ability.effect.restriction] },
  }, { type: "end-of-turn" });
  expiring.expireAt({ id: "turn-end" }, () => null);
  const moved = moveDuelUnitsStandard(scene.board, [{ objectId: "u1", readied: true, hasGanking: false }], {
    actor: "A",
    unitUIDs: ["u1"],
    destinationLocationId: scene.base,
    timing: { phase: "main", stateOpen: true, turnPlayerId: "A", priorityPlayerId: "A" }
  }, { registry: expiring, refForUnit: () => ({ id: "u1", zoneEntryId: 1 }), objectForUnit: () => snapshot });
  assert.equal(moved.board.units[0].locationId, scene.base);
});

test("sfd-014-221 Minotaur Reckoner: judgeReason names the measured production gap", () => {
  // Re-probed 2026-10-17 (RIFT-667): the rule query serves the prohibition as soon
  // as both spellings are declared; the remaining gap is the missing production
  // rules context and effect.move's missing query.
  assert.match(program.judgeReason, /DuelMovementRuleContext/);
  assert.match(program.judgeReason, /standard-move-executor-v2/);
  assert.match(program.judgeReason, /effect\.move/);
});

test.todo(
  "sfd-014-221 Minotaur Reckoner: units must not be able to move to base (CR 054.1 / 144.4.b / 451.1) - " +
    "duel/standard-move-executor-v2.ts must supply a DuelMovementRuleContext and effect.move must consult the " +
    "same movement restrictions"
);
