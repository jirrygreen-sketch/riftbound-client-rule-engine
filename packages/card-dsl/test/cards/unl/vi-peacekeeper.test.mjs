import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/vi-peacekeeper.js";
import stun from "../../../../engine-core/dist/effects/instructions/effect.stun.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { queryObjects } from "../../../../engine-core/dist/effects/interpreter/selectors.js";
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
  assert.match(program.judgeReason, /RIFT-84/);
  assert.match(program.judgeReason, /RIFT-120/);
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
    "Reaction timing) — effects/keywords/ has no Ambush.ts and there is no continuous.timing/location-permission consumer (RIFT-84)"
);
test.todo(
  "unl-176-219 Vi, Peacekeeper: reach the attack-declared timing point from the real combat flow and register " +
    "the CardProgram trigger as a TriggerRegistration (combat emitters are engine batch 5, RIFT-120)"
);
