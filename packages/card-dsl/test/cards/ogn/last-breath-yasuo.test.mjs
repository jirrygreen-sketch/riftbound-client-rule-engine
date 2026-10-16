import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import lastBreath from "../../../dist/cards/ogn/last-breath-yasuo.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CANONICAL = "card.hash-adadfbd360eec79d9a637667e3d360e2baf6b619cf07ad535bf57a5e10ed3d86";
const BASE = player => ({ type: "base", player });
const BATTLEFIELD = id => ({ type: "battlefield", id });

const [keyword, play] = lastBreath.abilities;
const [readyInstruction, damageInstruction] = play.body;
const readyTargetSpec = readyInstruction.targets[0];
const damageTargetSpec = damageInstruction.targets[0];

/**
 * Run the card body through the production chain adapter path.
 *
 * The TargetSpecs are dropped before execution, exactly as the merged sibling
 * goldens do (pit-rookie, veiled-temple, frigid-touch): the reference kernel
 * matches filters by plain value comparison, so the production predicates
 * "controller: self" and "location: battlefield" (normalized by
 * chain/engine.ts and matched by layers/filter.ts) cannot be satisfied there.
 * Finalize locking is supplied through setTargets, which is the same contract
 * the production caller honours.
 */
const lockedBody = play.body.map(({ targets, ...rest }) => rest);

function runBody(kernel) {
  return resolveChainBody(lockedBody, kernel);
}

function kernelWith(friend, enemy = {}) {
  return world()
    .unit("friend", { owner: "A", location: BASE("A"), exhausted: true, might: 4, ...friend })
    .unit("enemy", { owner: "B", location: BATTLEFIELD("bf1"), might: 3, ...enemy })
    .build();
}

test("Last Breath program is structurally valid EffectIR v2 data", () => {
  const result = validateCardProgram(lastBreath);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Last Breath identity, ruleset, status and printed text", () => {
  assert.equal(lastBreath.canonicalCardId, CANONICAL);
  assert.equal(lastBreath.rulesetVersion, "core-1.5");
  assert.equal(lastBreath.status, "executable");
  assert.equal(lastBreath.judgeReason, undefined);
  assert.equal(
    lastBreath.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Ready a friendly unit. It deals damage equal to its Might to an enemy unit at a battlefield."
  );
  assert.equal(cardRegistryById.get(lastBreath.canonicalCardId), lastBreath);
});

test("Last Breath declares the printed [Action] keyword (CR 806 / 159.2.a)", () => {
  assert.equal(lastBreath.abilities.length, 2);
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });
  assert.equal(keyword.value, undefined);
});

test("Last Breath structure: a targeted Ready, then the linked Might damage", () => {
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 2);

  // "Ready a friendly unit." is a Choice (355.5 / 355.7), one target.
  assert.equal(readyInstruction.id, "ready-friendly-unit");
  assert.equal(readyInstruction.op, "effect.ready");
  assert.deepEqual(readyInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "friendly-unit" }
  });
  assert.deepEqual(readyTargetSpec, {
    id: "friendly-unit",
    filter: { type: "unit", controller: "self" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(readyInstruction.linkedTo, undefined);

  // "It deals damage equal to its Might to an enemy unit at a battlefield."
  assert.equal(damageInstruction.id, "damage-enemy-unit");
  assert.equal(damageInstruction.op, "effect.damage");
  // "It" resumes the readied unit: the follow-up is linked, so an ignored
  // Ready also ignores the damage (contract 3.4 / CR 359.3.e).
  assert.equal(damageInstruction.linkedTo, "ready-friendly-unit");
  assert.deepEqual(damageInstruction.args.amount, {
    kind: "object-property",
    object: { target: "friendly-unit" },
    property: "might"
  });
  assert.deepEqual(damageInstruction.args.source, {
    kind: "object-property",
    object: { target: "friendly-unit" },
    property: "ref"
  });
  assert.deepEqual(damageInstruction.args.target, { kind: "constant", value: "enemy-unit-at-battlefield" });
  assert.deepEqual(damageTargetSpec, {
    id: "enemy-unit-at-battlefield",
    filter: { type: "unit", controller: "opponent", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(play.cost, undefined);
});

test("Last Breath golden: readies the friendly unit and deals its Might with the unit as source", () => {
  const kernel = kernelWith({ exhausted: true, might: 4 });
  const friendly = kernel.ref("friend");
  kernel.setTargets("friendly-unit", [friendly]);
  kernel.setTargets("enemy-unit-at-battlefield", [kernel.ref("enemy")]);

  const outcome = runBody(kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["ready-friendly-unit", "executed"],
    ["damage-enemy-unit", "executed"]
  ]);
  assert.equal(kernel.getObject("friend").exhausted, false);
  assert.equal(kernel.getObject("enemy").damage, 4);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready", "damage"]);
  // The readied unit, not the spell, is the damage source (CR 418.6.b.3).
  // The reference kernel records the committed GameAction in its history, so
  // the source on the damage action itself is observable there.
  const damageAction = kernel.history
    ? kernel.stateForTest().history.find(entry => entry.action.type === "damage").action
    : undefined;
  assert.deepEqual(damageAction.source, friendly);
  assert.deepEqual(damageAction.target, kernel.ref("enemy"));
  assert.equal(damageAction.combat, false);
});

test("Last Breath golden: an already-ready unit is not re-readied but still deals its Might (416.1.b)", () => {
  const kernel = kernelWith({ exhausted: false, might: 15 });
  kernel.setTargets("friendly-unit", [kernel.ref("friend")]);
  kernel.setTargets("enemy-unit-at-battlefield", [kernel.ref("enemy")]);

  const outcome = runBody(kernel);

  // 416.1.b/416.1.c: readying an already-ready unit is legal and nothing extra
  // happens; it is not a failure, so the second sentence still resolves.
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["ready-friendly-unit.readied"].count, 0);
  assert.equal(outcome.events.filter(event => event.action === "ready").length, 0);
  assert.equal(kernel.getObject("friend").exhausted, false);
  assert.equal(kernel.getObject("enemy").damage, 15);
});

test("Last Breath golden: the Might is read when the damage resolves, not when the spell is played", () => {
  const kernel = kernelWith({ exhausted: true, might: 2 });
  kernel.setTargets("friendly-unit", [kernel.ref("friend")]);
  kernel.setTargets("enemy-unit-at-battlefield", [kernel.ref("enemy")]);

  const outcome = runBody(kernel);

  assert.equal(outcome.status, "executed");
  // The read uses the unit current Might (contract 3.6: values are evaluated
  // at resolution time), so a 2-Might unit deals 2.
  assert.equal(kernel.getObject("enemy").damage, 2);
  assert.equal(outcome.linkedValues["damage-enemy-unit.dealt"], 2);
});

test("Last Breath golden: a target that left before resolution is ignored, and the linked damage is ignored too", () => {
  const kernel = kernelWith({ exhausted: true, might: 4 });
  const stale = kernel.ref("friend");
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });
  kernel.setTargets("friendly-unit", [stale]);
  kernel.setTargets("enemy-unit-at-battlefield", [kernel.ref("enemy")]);

  const outcome = runBody(kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(outcome.results[1].result, { status: "ignored", reason: "linked-ignored" });
  assert.equal(kernel.getObject("enemy").damage, 0);
  assert.equal(outcome.events.length, 0);
});

test("Last Breath golden: the Ready half runs through the merged effect.ready primitive alone", () => {
  const kernel = world().unit("friend", { exhausted: true }).build();
  const run = runInstruction(
    ready,
    { objects: readyInstruction.args.objects },
    { world: kernel, targets: { "friendly-unit": [kernel.ref("friend")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("friend").exhausted, false);
  assert.equal(run.linked.readied.count, 1);
});

test("Last Breath golden: the damage half runs through the merged effect.damage primitive alone", () => {
  const kernel = world()
    .unit("friend", { might: 6 })
    .unit("enemy", { owner: "B", might: 3 })
    .build();
  const run = runInstruction(
    damage,
    {
      amount: { kind: "constant", value: 6 },
      source: { kind: "constant", value: kernel.ref("friend") },
      target: "enemy-unit-at-battlefield"
    },
    { world: kernel, targets: { "enemy-unit-at-battlefield": [kernel.ref("enemy")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy").damage, 6);
  assert.equal(run.linked.dealt, 6);
});

test("Last Breath: the program body fails closed when nothing is locked", () => {
  // Without Finalize-locked targets the body cannot report a damage value, so
  // nothing is dealt and no event is produced.
  const kernel = world().unit("enemy", { owner: "B" }).build();
  const outcome = runBody(kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.events.length, 0);
  assert.equal(kernel.getObject("enemy").damage, 0);
});

test.todo(
  "Last Breath full chain play: paying 3 energy + 2 Calm power, [Action] showdown admission, and " +
    "Finalize target locking with the production target predicates (the reference kernel matches " +
    "filters by value only, so controller self / location battlefield are locked by the caller) — " +
    "depends on the cost plan and target system integration (RIFT-89 / RIFT-90)"
);

