import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/possession.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-18e556f7feed1c4774ba2262a9ef50441960dfa08dadbf07fd4011f655b4f544";
const [action, play] = program.abilities;
const [takeControl, recall] = play.body;
const unitSpec = takeControl.targets[0];

test("Possession program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Possession identity and judge-required status match the printing", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The control half is now executable (effect.control, RIFT-117); the recall
  // half keeps the card judge-required.
  assert.equal(program.judgeReason.includes("effect.control"), true);
  assert.equal(program.judgeReason.includes("effect.control 原语已合入"), true);
  assert.equal(program.judgeReason.includes("Recall"), true);
  assert.match(program.judgeReason, /TurnCombatBlockedError/);
  assert.match(program.judgeReason, /blockedReason/);
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Choose an enemy unit at a battlefield. Take control of it and recall it. (Send it to your base. This isn't a move.)"
  );
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Possession structure: Action keyword, printed cost, control then a linked recall", () => {
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 8 },
    power: { kind: "constant", value: 3 }
  });
  assert.equal(play.body.length, 2);

  // "Choose an enemy unit at a battlefield": 355.5 makes this a Choice, so the
  // enemy unit is an ordinary target (355.7, 355.9.b).
  assert.equal(takeControl.op, "effect.control");
  assert.equal(takeControl.linkedTo, undefined);
  assert.deepEqual(takeControl.args, {
    objects: { kind: "constant", value: { target: "possession.unit" } }
  });
  assert.deepEqual(unitSpec, {
    id: "possession.unit",
    filter: { types: "unit", controller: "opponent", location: { type: "battlefield" } },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "and recall it" (457-460): mode recall, not a Move; the instruction is
  // linked to the control half (359.3.e.14 "it").
  assert.equal(recall.op, "effect.move");
  assert.equal(recall.linkedTo, "possession.take-control");
  assert.deepEqual(recall.args.objects, { kind: "constant", value: { target: "possession.unit" } });
  assert.deepEqual(recall.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(recall.args.mode, { kind: "constant", value: "recall" });
  assert.equal(recall.targets, undefined);
});

test("Possession golden: take-control changes the chosen unit's controller (127.1 / 188-192)", () => {
  const kernel = world()
    .unit("enemy-unit", {
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "battlefield-1" },
      might: 4,
      damage: 2
    })
    .build();
  kernel.setTargets(unitSpec.id, [kernel.ref("enemy-unit")]);

  // Drive the card's own body (minus the TargetSpec, which the interpreter
  // resolves at Finalize): the control half executes against the real kernel.
  // The Recall half is covered by the test.todo below, so its own result is
  // not asserted here (it must not become a "this action is still missing"
  // assertion).
  const body = play.body.map(({ targets, ...rest }) => rest);
  const outcome = resolveChainBody(body, kernel);

  const takeControlResult = outcome.results.find(entry => entry.id === "possession.take-control").result;
  assert.equal(takeControlResult.status, "executed");
  // 127.1: control changes; owner never does.
  const after = kernel.getObject("enemy-unit");
  assert.equal(after.controller, "A");
  assert.equal(after.owner, "B");
  assert.deepEqual(after.location, { type: "battlefield", id: "battlefield-1" });
  assert.equal(after.damage, 2);
  assert.deepEqual(outcome.linkedValues["possession.take-control.controlled"].changes, [
    { object: { id: "enemy-unit", zoneEntryId: 1 }, owner: "B", from: "B", to: "A" }
  ]);
  assert.equal(outcome.events.some(event => event.action === "take-control"), true);
});

test("Possession golden: an already-controlled unit reports no control change (190.6.d)", () => {
  const kernel = world()
    .unit("own-unit", {
      owner: "A",
      controller: "A",
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  kernel.setTargets(unitSpec.id, [kernel.ref("own-unit")]);
  const body = play.body.map(({ targets, ...rest }) => rest);

  const outcome = resolveChainBody(body, kernel);
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(kernel.getObject("own-unit").controller, "A");
  // No change to report for an object the ability controller already controls.
  assert.deepEqual(outcome.linkedValues["possession.take-control.controlled"], {
    count: 0,
    objects: [],
    changes: []
  });
});

test("Possession golden: a stale chosen unit makes the recall observe nothing", () => {
  const kernel = world()
    .unit("enemy-unit", {
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  const stale = kernel.ref("enemy-unit");
  kernel.perform({ type: "return-to-hand", object: stale });
  kernel.setTargets(unitSpec.id, [stale]);
  const body = play.body.map(({ targets, ...rest }) => rest);

  // The target selector is resolved first, so the invalidated reference is
  // dropped (359.3.e.2-e.6): the take-control half has nothing left to act on
  // and the unit stays in its owner's hand under its original controller.
  const outcome = resolveChainBody(body, kernel);
  const takeControlResult = outcome.results.find(entry => entry.id === "possession.take-control").result;
  assert.deepEqual(takeControlResult, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("enemy-unit").zone, "hand");
  assert.equal(kernel.getObject("enemy-unit").controller, "B");
});

test.todo(
  "Possession: a real Recall (457/458: relocate to the new controller's Base, not a Move, no " +
    "Move triggers, ignore movement restrictions, keep damage and statuses) needs a Recall " +
    "action distinct from move-location (the effect.move primitive is merged); the merged effect.move recall " +
    "path deliberately reports negated/impossible (see judgeReason)."
);

