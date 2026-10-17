import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/iascylla.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { isTimingPointId } from "../../../../engine-core/dist/events/timing-points.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-0167db5ef0a7cb8ad9866e8d7785e98b8be61001fe1303b0a80af41c6bdfffcc";
const SOURCE_TEXT =
  "When I hold, at the start of your next Main Phase, you may move an enemy unit to this battlefield.";

const [ability] = program.abilities;
const [delayed] = ability.body;
const [mayMove] = delayed.args.body.value;
const [moveInstruction] = mayMove.args.body.value;
const [enemySpec] = mayMove.targets;

test("unl-050-219 Iascylla: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-050-219 Iascylla: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /391\.2/);
  assert.match(program.judgeReason, /359\.3\.f\.3\.b/);
});

test("unl-050-219 Iascylla: 'When I hold' is a hold trigger scoped to this card (383.4.d)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "hold");
  assert.equal(isTimingPointId("hold"), true);
  assert.deepEqual(ability.trigger.filter, { event: "held", filter: { source: "self" } });
  assert.equal(ability.trigger.condition, undefined);
  // 383.3.a.3: the printed "you may" is not the first part of the effect (the
  // timing window is), so the trigger itself stays mandatory and the choice is
  // wrapped in the delayed body per contract 3.9.
  assert.equal(ability.optional, false);
});

test("unl-050-219 Iascylla: the delayed registration records the next-Main-Phase window and the held battlefield referent", () => {
  assert.equal(delayed.id, "iascylla.delayed-move");
  assert.equal(delayed.op, "trigger.delayed");
  assert.deepEqual(delayed.args.at, { kind: "constant", value: "main-start" });
  assert.equal(isTimingPointId(delayed.args.at.value), true);
  assert.deepEqual(delayed.args.window, { kind: "constant", value: "next-main-phase" });
  assert.deepEqual(delayed.args.referent, {
    kind: "constant",
    value: "iascylla-held-battlefield"
  });
});

test("unl-050-219 Iascylla: the may-move wraps the effect.move inside choice.optional (contract 3.9)", () => {
  assert.equal(mayMove.id, "iascylla.may-move");
  assert.equal(mayMove.op, "choice.optional");
  assert.equal(mayMove.args.body.kind, "constant");
  assert.deepEqual(mayMove.args.body.value.map(instruction => instruction.id), [
    "iascylla.move-enemy-unit"
  ]);
  // 355.5.b / 359.3.f.3.b: the choice of which enemy unit moves belongs to the
  // delayed trigger's finalize, so the TargetSpec sits on the may node.
  assert.deepEqual(enemySpec, {
    id: "iascylla.enemy-unit",
    filter: { type: "unit", zone: "board", controller: "opponent" },
    min: 1,
    max: 1,
    selection: "one"
  });

  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "iascylla.enemy-unit" }
  });
  assert.deepEqual(moveInstruction.args.amount, { kind: "constant", value: 1 });
  // The destination is the held battlefield referent (359.3.f.3.b), written as
  // a descriptive marker because no ObjectSelector can name it; effect.move's
  // destination() rejects it outright rather than guessing a battlefield.
  assert.deepEqual(moveInstruction.args.to, {
    kind: "constant",
    value: { kind: "destination-selector", referent: "iascylla-held-battlefield" }
  });
  assert.equal(moveInstruction.linkedTo, undefined);
});

test("unl-050-219 Iascylla golden: effect.move really relocates the locked enemy unit to the held battlefield", () => {
  // The held battlefield is locked when the delayed trigger is generated
  // (359.3.f.3.b); the golden supplies it as the evaluated destination so the
  // merged move primitive runs its real relocation.
  const kernel = world()
    .unit("enemy-unit", {
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "battlefield-2" }
    })
    .build();
  const run = runInstruction(
    move,
    {
      objects: { kind: "constant", value: { target: "iascylla.enemy-unit" } },
      to: { kind: "constant", value: { type: "battlefield", id: "battlefield-1" } },
      amount: { kind: "constant", value: 1 }
    },
    { world: kernel, targets: { "iascylla.enemy-unit": [kernel.ref("enemy-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.moved, {
    count: 1,
    objects: [{ id: "enemy-unit", zoneEntryId: 1 }],
    movements: [
      {
        object: { id: "enemy-unit", zoneEntryId: 1 },
        from: { type: "battlefield", id: "battlefield-2" },
        to: { type: "battlefield", id: "battlefield-1" }
      }
    ]
  });
  assert.deepEqual(kernel.getObject("enemy-unit").location, {
    type: "battlefield",
    id: "battlefield-1"
  });
  assert.deepEqual(run.events.map(event => event.action), ["move-location"]);
});

test("unl-050-219 Iascylla golden: a stale enemy target ignores the move instead of moving a rebind", () => {
  const kernel = world()
    .unit("enemy-unit", { owner: "B", controller: "B" })
    .build();
  const stale = kernel.ref("enemy-unit");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    move,
    {
      objects: { kind: "constant", value: { target: "iascylla.enemy-unit" } },
      to: { kind: "constant", value: { type: "battlefield", id: "battlefield-1" } },
      amount: { kind: "constant", value: 1 }
    },
    { world: kernel, targets: { "iascylla.enemy-unit": [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("enemy-unit").zone, "trash");
});

test("unl-050-219 Iascylla golden: the descriptive destination marker is rejected, never guessed", () => {
  const kernel = world()
    .unit("enemy-unit", { owner: "B", controller: "B" })
    .build();
  assert.throws(
    () => runInstruction(
      move,
      {
        objects: { kind: "constant", value: { target: "iascylla.enemy-unit" } },
        to: {
          kind: "constant",
          value: { kind: "destination-selector", referent: "iascylla-held-battlefield" }
        },
        amount: { kind: "constant", value: 1 }
      },
      { world: kernel, targets: { "iascylla.enemy-unit": [kernel.ref("enemy-unit")] } }
    ),
    /effect\.move to must be a location/
  );
  assert.deepEqual(kernel.getObject("enemy-unit").location, {
    type: "battlefield",
    id: "battlefield-1"
  });
});

test.todo(
  "unl-050-219 Iascylla: register the delayed trigger 'at the start of your next Main Phase' " +
    "(CR 391.2/391.4, 393) through a card-facing trigger.delayed instruction with a one-shot " +
    "next-main-phase window"
);

test.todo(
  "unl-050-219 Iascylla: bind 'this battlefield' to the battlefield she held, locked when the " +
    "delayed trigger is generated (CR 359.3.f.3.b uses this exact card) — depends on the " +
    "hold-event battlefieldId capture and delayed-trigger binding (generic linked-location is merged)"
);

test("unl-050-219 Iascylla: the held alias passes the production trigger schema", () => {
  const translated = translateTriggerFilter(ability.trigger.filter, "iascylla", ability.trigger.at);
  const result = validateTriggerSpec({ ...ability.trigger, filter: translated });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.deepEqual(translated, { event: "held", object: { objectId: "iascylla" } });
});
