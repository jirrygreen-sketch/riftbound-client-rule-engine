// RIFT-668 partial execution / boundaries: ../templates/static-668.test.mjs.
// Published status stays judge-required; existing component coverage is retained below.
// RIFT-643: static|| execution evidence is consolidated in ../templates/static-643.test.mjs.
// This file retains the card's identity, status, sourceText, and key IR guards.

import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/baron-pit.js";
// The Ganking expansion is what an approximation of this card would silently
// reuse if "can move here from anywhere" were written as [Ganking].
import ganking from "../../../../engine-core/dist/effects/keywords/Ganking.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-9a277d1f603718992521dc7464de01bdb5cc00d5d35d10081db5b0c9cfc4c3db";
const SOURCE_TEXT =
  "(You can't start the game with a token battlefield.)\nUnits can move here from anywhere.";

const [ability] = program.abilities;

test("unl-t01 Baron Pit: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-t01 Baron Pit: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /187\.9/);
  assert.match(program.judgeReason, /449\.1/);
  assert.match(program.judgeReason, /zones\/movement/);
  // The reason still documents that the declared routes/endpoints shape is
  // registered and readable; only the file-level wording changed.
  assert.match(program.judgeReason, /standard-move-to-here-from-anywhere/);
  assert.match(program.judgeReason, /endpoints=\{source:anywhere,destination:self\}/);
  // Third-sweep refresh: the remaining blocker is the Standard Move endpoint
  // consumer (route name vs destination/self endpoint) plus the Battlefield
  // Board lifecycle; the stale routeKinds wording no longer describes it.
  assert.match(program.judgeReason, /destinationLocationId/);
  assert.match(program.judgeReason, /destination:self/);
  assert.match(program.judgeReason, /route 名/);
  assert.doesNotMatch(program.judgeReason, /routeKinds/);
  assert.doesNotMatch(program.judgeReason, /位置选择 RIFT-357|RIFT-357 的/);
  // The reminder parenthetical is part of the printed text even though it adds
  // no ability (135.2.d.1 / 135.2.d.3).
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("unl-t01 Baron Pit: one passive move permission with this Battlefield as the destination", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 187.9: "Units can move here from anywhere." 449.1/449.2: a Move is defined
  // by its Origin and Destination, so the permission must record both halves.
  assert.equal(ability.effect.kind, "continuous.movement");
  assert.deepEqual(ability.effect.permission, {
    routes: ["standard-move-to-here-from-anywhere"],
    source: "anywhere", destination: "self", move: "standard"
  });
  // It grants a destination permission only; it is not Ganking and does not
  // touch 449.2.a / 451.2's other destination restrictions.
  assert.equal(ability.effect.canGank, undefined);
  assert.equal(ability.effect.restriction, undefined);
  assert.deepEqual(ability.effect.filter, { type: "unit", zone: "board" });
  // The 053.3 "here" referent is NOT expressed as sameLocationAs: that anchor
  // constrains where the affected object sits, not where a Move ends (see
  // judgeReason).
  assert.equal(ability.effect.filter.sameLocationAs, undefined);
});

test("unl-t01 Baron Pit: the declared permission is not the [Ganking] expansion", () => {
  // 810.1.b / 810.1.c: Ganking adds the Battlefield→Battlefield option to the
  // holder's own Standard Move. Baron Pit neither grants Ganking nor restricts
  // itself to "battlefield to battlefield": it opens the DESTINATION at this
  // Battlefield to units coming from anywhere (187.9, 449.1/449.2). The two
  // declared shapes must therefore differ; reusing the Ganking expansion here
  // would implement another ability.
  const [gankingAbility] = ganking.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(gankingAbility.kind, "static");
  assert.equal(gankingAbility.effect.kind, ability.effect.kind);
  assert.notDeepEqual(gankingAbility.effect, ability.effect);
  assert.notEqual(gankingAbility.effect.permission, ability.effect.permission);
  assert.equal(ability.effect.permission.destination, "self");
});

test("Baron Pit: the production static binder registers the declared route and preserves its destination", () => {
  const f = fixture({ cards: [
    { id: "pit", cardId: CANONICAL_ID, types: ["battlefield"], energy: null, power: null },
    { id: "traveller", types: ["unit"], might: 3 }
  ] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("pit"), to: "battlefield", location: { type: "battlefield", id: "pit" } });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("traveller"), to: "battlefield", location: { type: "battlefield", id: "elsewhere" } });
  const handle = createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject("pit"));
  const object = f.kernel.getObject("traveller");
  const view = movement(f.engine.layers.registry, object.ref, object, "A");
  assert.equal(view.permissions.length, 1);
  assert.deepEqual(view.permissions[0].routes, ["standard-move-to-here-from-anywhere"]);
  assert.deepEqual(view.permissions[0].endpoints, { source: "anywhere", destination: "self" });
  assert.deepEqual(view.permissions[0].source, f.kernel.ref("pit"));
  assert.equal(view.permissions[0].move, "standard");
  handle.unbind();
  assert.deepEqual(movement(f.engine.layers.registry, object.ref, object, "A").permissions, []);
});

test("Baron Pit: the merged movement query reads the route but still gates Battlefield→Battlefield on Ganking alone (144.4.c)", () => {
  // Evidence for the remaining gap: movement() exposes the registered
  // destination:self permission, yet the Standard Move legality check reads only
  // canGank for a Battlefield→Battlefield move, so this permission grants no
  // usable move and the card cannot be called executable.
  const f = fixture({ cards: [
    { id: "pit", cardId: CANONICAL_ID, types: ["battlefield"], energy: null, power: null, zone: "board", location: { type: "battlefield", id: "pit" } },
    { id: "traveller", types: ["unit"], might: 3, zone: "board", location: { type: "battlefield", id: "elsewhere" } }
  ] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("pit"), to: "board", location: { type: "battlefield", id: "pit" } });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("traveller"), to: "board", location: { type: "battlefield", id: "elsewhere" } });
  createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject("pit"));
  const object = f.kernel.getObject("traveller");
  const view = movement(f.engine.layers.registry, object.ref, object, "A");

  assert.deepEqual(view.permissions.map(permission => permission.endpoints),
    [{ source: "anywhere", destination: "self" }]);
  // The route carries the whole permission, so canGank stays false: the card is
  // not Ganking and the endpoint-aware consumer is the missing half.
  assert.equal(view.canGank, false);
  assert.equal(view.battlefieldToBattlefield, false);
  // The rule-query half is already correct: the declaration is registered with
  // both endpoints and is not mistaken for the Ganking route.
  assert.deepEqual(view.permissions.map(permission => permission.routes),
    [["standard-move-to-here-from-anywhere"]]);
});

test.todo("baron-pit: consume the destination:self endpoint (source anywhere) in the Standard Move legality check, without granting routes to other battlefields (CR 187.9/449.1/449.2)");

test("Baron Pit: production only binds on object-enters-board, and a Chain-zone Battlefield never gets there", () => {
  // Third-sweep evidence for the refreshed judgeReason: game/lifecycle.ts
  // creates every Battlefield as a Chain-zone token and never moves it to the
  // Board, while attachProgramLifecycle attaches static/trigger bindings only
  // when it observes object-enters-board. The declaration itself is bindable,
  // so the missing half is the lifecycle wiring, not this card's IR.
  const f = fixture({ cards: [
    { id: "pit", cardId: CANONICAL_ID, types: ["battlefield"], energy: null, power: null, isToken: true, controller: "A" }
  ] });
  // game/lifecycle.ts issues create-token without a Board destination, so the
  // physical object stays on the Chain; reproduce that state with the real
  // zone-change action instead of hand-writing the snapshot.
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("pit"), to: "chain" });
  const source = f.kernel.getObject("pit");
  assert.equal(source.zone, "chain");
  assert.equal(source.location, null);
  // The declaration binds directly even from the Chain, so nothing here is a
  // "this card cannot be expressed" failure.
  const direct = createEngineStaticBinder(f.engine).bindStatic(ability, source);
  assert.equal(f.engine.layers.registry.list().length, 1);
  direct.unbind();
  assert.equal(f.engine.layers.registry.list().length, 0);

  // The merged production lifecycle attaches nothing until the Board entry
  // timing is emitted for this incarnation.
  const executable = { ...program, status: "executable", judgeReason: undefined };
  const binding = createProgramBinding({ cardPrograms: [executable] });
  const lifecycle = binding.attachLifecycle(f.engine);
  assert.deepEqual(f.engine.layers.registry.list(), []);
  assert.equal(f.engine.pipeline.triggers.size, 0);
  f.engine.pipeline.emit({ timingPoint: "object-enters-board", object: source, player: "A" });
  assert.equal(f.engine.layers.registry.list().length, 1, "the Board entry attaches the declared permission");
  lifecycle.detach();
});
