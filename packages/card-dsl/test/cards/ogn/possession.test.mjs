import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/possession.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.equal(program.judgeReason.includes("take-control"), true);
  assert.equal(program.judgeReason.includes("RIFT-117"), true);
  assert.equal(program.judgeReason.includes("Recall"), true);
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
  assert.deepEqual(takeControl.args, { target: { kind: "constant", value: "possession.unit" } });
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

test("Possession golden: the merged recall path refuses to fake a Move (458 / 421)", () => {
  // effect.move documents Recall as explicitly BLOCKED: the frozen move-location
  // action cannot distinguish a Recall from a Move (457, 458, 458.3, 460), so a
  // nonzero recall reports negated/impossible with a blockedReason instead of
  // relocating the unit through a substitute action.
  const kernel = world()
    .unit("enemy-unit", {
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "battlefield-1" },
      might: 4,
      damage: 2
    })
    .build();
  const run = runInstruction(
    move,
    {
      objects: { kind: "constant", value: { target: unitSpec.id } },
      to: { kind: "constant", value: "controller-base" },
      mode: { kind: "constant", value: "recall" }
    },
    { world: kernel, targets: { [unitSpec.id]: [kernel.ref("enemy-unit")] } }
  );

  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(run.linked.moved.count, 0);
  assert.equal(run.linked.moved.blockedReason.length > 0, true);
  // No move-zone/move-location substitute: the unit keeps its location, damage
  // and controller (458.2 / 460.1 would be the Recall's own behavior).
  const after = kernel.getObject("enemy-unit");
  assert.deepEqual(after.location, { type: "battlefield", id: "battlefield-1" });
  assert.equal(after.damage, 2);
  assert.equal(after.controller, "B");
  assert.deepEqual(kernel.events.map(event => event.action), []);
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
  const run = runInstruction(
    move,
    {
      objects: { kind: "constant", value: { target: unitSpec.id } },
      to: { kind: "constant", value: "controller-base" },
      mode: { kind: "constant", value: "recall" }
    },
    { world: kernel, targets: { [unitSpec.id]: [stale] } }
  );

  // The target selector is resolved first, so the invalidated reference is
  // dropped (359.3.e.2-e.6): effect.move sees an empty target set and
  // reports the instruction as ignored (contract 3.3), doing nothing.
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("enemy-unit").zone, "hand");
  assert.deepEqual(kernel.events.map(event => event.action), ["return-to-hand"]);
});

test.todo(
  "Possession: \"Take control of it\" needs the effect.control instruction primitive over the " +
    "frozen take-control GameAction (RIFT-117 prim-effect-control)."
);

test.todo(
  "Possession: a real Recall (457/458: relocate to the new controller's Base, not a Move, no " +
    "Move triggers, ignore movement restrictions, keep damage and statuses) needs a Recall " +
    "action distinct from move-location (RIFT-109 follow-up)."
);

test.todo(
  "Possession: Finalize-time target selection for { controller: opponent, location: battlefield } " +
    "(355.3, pending-chain exclusion, became-target triggers) belongs to the target system (RIFT-90)."
);
