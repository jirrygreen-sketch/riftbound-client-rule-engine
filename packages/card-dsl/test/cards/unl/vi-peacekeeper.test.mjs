import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/vi-peacekeeper.js";
import stun from "../../../../engine-core/dist/effects/instructions/effect.stun.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { queryObjects } from "../../../../engine-core/dist/effects/interpreter/selectors.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { actionTimings, playLocations } from "../../../../engine-core/dist/layers/rules/query.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-940239e930273675dbfef51d216846a7ba2391c6eb507a28893f250c32eee6cd";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "When I attack, [Stun] an enemy unit here. (It doesn't deal combat damage this turn.)";

const [ambush, attackTrigger] = program.abilities;
const [stunInstruction] = attackTrigger.body;
const [enemyHere] = stunInstruction.targets;

test("unl-176-219 Vi, Peacekeeper: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-176-219 Vi, Peacekeeper: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Ambush/);
  assert.match(program.judgeReason, /822\.1\.b/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /sameLocationAs/);
  // The refreshed reason names the observed blocked surfaces, not merged tasks.
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /playLocations/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.doesNotMatch(program.judgeReason, /RIFT-/);
});

test("unl-176-219 Vi, Peacekeeper: [Ambush] is declared without a value", () => {
  // 822.1: Ambush is a Passive Ability keyword; the printed form carries no value.
  assert.deepEqual(ambush, { kind: "keyword", keyword: "ambush" });
  assert.equal(ambush.value, undefined);
});

test("unl-176-219 Vi, Peacekeeper: the attack trigger points at attack-declared and the host", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(attackTrigger.kind, "triggered");
  // 383.4.e / 466.2.c: Attack Triggers fire when the unit gains the Attacker
  // designation; the closed timing enum spells that attack-declared.
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(attackTrigger.trigger.condition, undefined);
  assert.equal(attackTrigger.trigger.once, undefined);
  assert.equal(attackTrigger.optional, false);
});

test("unl-176-219 Vi, Peacekeeper: the effect stuns one enemy unit at the source location", () => {
  assert.equal(attackTrigger.body.length, 1);
  assert.equal(stunInstruction.id, "vi-peacekeeper.stun-enemy-here");
  assert.equal(stunInstruction.op, "effect.stun");
  assert.deepEqual(stunInstruction.args, {
    target: { kind: "constant", value: "vi-peacekeeper.enemy-here" }
  });
  assert.equal(stunInstruction.linkedTo, undefined);
  assert.equal(stunInstruction.picks, undefined);
  assert.equal(enemyHere.id, "vi-peacekeeper.enemy-here");
  // 355.9/355.10 target semantics + 053.3 / 359.3.f.1 "here".
  assert.deepEqual(enemyHere.filter, {
    type: "unit",
    zone: "board",
    controller: "opponent",
    sameLocationAs: "source"
  });
  assert.equal(enemyHere.min, 1);
  assert.equal(enemyHere.max, 1);
  assert.equal(enemyHere.selection, "one");
});

test("unl-176-219 Vi, Peacekeeper golden: the printed stun resolves on a locked enemy unit", () => {
  // 424.1: Stun is an effect-directed limited action; the merged primitive
  // submits it for a locked target.
  const kernel = world()
    .unit("vi", { location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(stun, { target: enemyHere.id }, {
    world: kernel,
    targets: { [enemyHere.id]: [kernel.ref("enemy-here")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.stunned.count, 1);
  assert.equal(kernel.getObject("enemy-here").stunned, true);
  assert.deepEqual(run.events.map(event => event.action), ["stun"]);
});

test("unl-176-219 Vi, Peacekeeper golden: the sameLocationAs anchor keeps the stun at here", () => {
  const kernel = world()
    .unit("vi", { location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-elsewhere", { owner: "B", location: { type: "battlefield", id: "bf-2" } })
    .build();
  kernel.setTargets(enemyHere.id, [kernel.ref("enemy-here")]);
  const { targets, ...instruction } = stunInstruction;
  assert.equal(targets.length, 1);

  const outcome = runAbilityBody([instruction], kernel, undefined, { host: kernel.ref("vi") });
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["vi-peacekeeper.stun-enemy-here", "executed"]
  ]);
  assert.equal(kernel.getObject("enemy-here").stunned, true);
  assert.equal(kernel.getObject("enemy-elsewhere").stunned, false);

  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("vi"), source: kernel.ref("vi") });
  const environment = {
    context: scoped,
    query: filter => scoped.query(filter),
    linked: () => undefined,
    canLookBack: () => false,
    isIgnored: () => false
  };
  // The interpreter resolves the anchor; the bare kernel query compares keys
  // literally and does not know sameLocationAs (see ogn/leona-determined).
  const anchored = queryObjects({ type: "unit", sameLocationAs: "source" }, environment)
    .map(object => object.ref.id);
  assert.deepEqual(anchored, ["vi", "enemy-here"]);
});

test("unl-176-219 Vi, Peacekeeper golden: a stun target that already left the board is ignored (359.3.e.5)", () => {
  const kernel = world().unit("vi").unit("enemy", { owner: "B" }).build();
  const stale = kernel.ref("enemy");
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setTargets(enemyHere.id, [stale]);
  const { targets, ...instruction } = stunInstruction;
  assert.equal(targets.length, 1);

  const outcome = runAbilityBody([instruction], kernel, undefined, { host: kernel.ref("vi") });
  assert.deepEqual(outcome.results.map(result => [result.result.status, result.result.reason]), [
    ["ignored", "mistargeted"]
  ]);
  assert.equal(kernel.getObject("enemy").stunned, false);
});

test.todo(
  "unl-176-219 Vi, Peacekeeper: [Ambush] keyword expansion (822.1.b battlefield entry permission + " +
    "Reaction timing) — the Ambush expansion is present, but no continuous.timing/location-permission consumer is connected"
);
test.todo(
  "unl-176-219 Vi, Peacekeeper: reach the attack-declared timing point from the real combat flow and register " +
    "the CardProgram trigger through the production combat emitter (attack-declared is not emitted yet)"
);

test("unl-176-219 Vi, Peacekeeper gap: neither Ambush declaration can be bound by the production static binder", () => {
  // 822.1.b needs the play-location permission and the conditional Reaction to
  // reach the layers/chain. The production binder rejects both kinds, so the
  // merged keyword expansion stays inert. Pinned as evidence for judgeReason (1).
  const expansion = keywordDefinitionsById.get("Ambush").expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(expansion.map(ability => [ability.kind, ability.effect.kind]), [
    ["static", "play-location-permission"],
    ["static", "continuous.timing"]
  ]);
  const f = fixture({ cards: [{ id: "vi", cardId: CANONICAL_ID, types: ["unit"], might: 5 }] });
  const binder = createEngineStaticBinder(f.engine);
  assert.throws(
    () => binder.bindStatic(expansion[0], f.kernel.getObject("vi")),
    /Static ability kind play-location-permission has no layer mapping/
  );
  assert.throws(
    () => binder.bindStatic(expansion[1], f.kernel.getObject("vi")),
    /Unsupported static appliesTo/
  );
  assert.deepEqual(f.engine.layers.registry.list(), []);
});

test("unl-176-219 Vi, Peacekeeper gap: neither Ambush declaration is consumed even if it reaches the registry", () => {
  // 822.1.b: the location permission grants a battlefield play option. The
  // merged layer query reads effect.permission (a string), while the expansion
  // writes value: { zone: battlefield, ... }; registering the raw declaration
  // anyway shows playLocations() still returns nothing. The conditional
  // Reaction half is readable through actionTimings() once registered, but the
  // binder refuses to register it at all (appliesTo ["card"]). Both halves are
  // measured against the merged query surface.
  const f = fixture({ cards: [{ id: "vi", cardId: CANONICAL_ID, types: ["unit"], might: 5 }] });
  const source = f.kernel.getObject("vi");
  const expansion = keywordDefinitionsById.get("Ambush").expand({ host: { canonicalCardId: CANONICAL_ID } });
  const filter = { objectId: "vi", zone: source.zone, zoneEntryId: source.ref.zoneEntryId };
  f.engine.layers.addContinuous({ id: "ambush-location", layer: "ability", source: source.ref, filter, effect: expansion[0].effect }, { type: "permanent" });
  f.engine.layers.addContinuous({ id: "ambush-timing", layer: "ability", source: source.ref, filter, effect: expansion[1].effect }, { type: "permanent" });
  f.engine.layers.setObjects(f.kernel.objects);
  assert.equal(expansion[0].effect.value.kind, "constant");
  assert.equal(expansion[0].effect.value.value.zone, "battlefield");
  assert.deepEqual(expansion[0].effect.value.value.battlefield, { occupied: true, controller: "controller" });
  assert.equal(Object.hasOwn(expansion[0].effect, "permission"), false);
  assert.deepEqual(playLocations(f.engine.layers.registry, source.ref, source, "A"), { permissions: [], restrictions: [] });
  assert.deepEqual(actionTimings(f.engine.layers.registry, source.ref, source, "A"), ["showdown", "closed-state"]);
  // The binder is what production uses, and it rejects both declarations.
  const binder = createEngineStaticBinder(f.engine);
  assert.throws(() => binder.bindStatic(expansion[0], source), /has no layer mapping/);
  assert.throws(() => binder.bindStatic(expansion[1], source), /Unsupported static appliesTo/);
});

test("unl-176-219 Vi, Peacekeeper gap: the target filter's sameLocationAs anchor is rejected at binding time", () => {
  // 053.3 / 359.3.f.1 spells "here" as the source's own location. The card-side
  // trigger translation refuses the anchor, so the attack-declared subscription
  // cannot be registered even once the timing point exists. Evidence for (3).
  const { judgeReason: _reason, ...rest } = program;
  const binding = createProgramBinding({ cardPrograms: [{ ...rest, status: "executable" }] });
  const source = {
    ref: { id: "vi", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    name: "Vi, Peacekeeper",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: 5,
    energy: 5,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    combatRole: null
  };
  assert.throws(
    () => triggerRegistrations(binding.registry, source),
    /Unsupported filter field sameLocationAs/
  );
  // The battle-damage path is what would emit attack-declared, and it is still
  // blocked, so there is no producer to reach either.
  assert.equal(typeof binding.describeActivate, "function");
});
