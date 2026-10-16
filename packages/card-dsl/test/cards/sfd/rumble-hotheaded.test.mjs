// Golden test for Rumble, Hotheaded (sfd-026-221).
// The static Assault grant needs the continuous keyword layer (RIFT-91/81),
// while the conquer trigger body only uses merged primitives and is executed
// against the reference kernel.
import test from "node:test";
import assert from "node:assert/strict";
import { validateCardProgram } from "../../../../../packages/card-dsl/dist/ir/index.js";
import program from "../../../../../packages/card-dsl/dist/cards/sfd/rumble-hotheaded.js";
import recycleDef from "../../../../../packages/engine-core/dist/effects/instructions/effect.recycle.js";
import playDef from "../../../../../packages/engine-core/dist/effects/instructions/effect.play.js";
import { world, runInstruction } from "../../../../../packages/engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-11c889b9d655c822e7ce3ec82c5a5f1e2d716ac6d3c2ed6fb9bb7b22c32ce870";

test("program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason ?? "", /continuous\.grant-keyword/);
  assert.match(program.judgeReason ?? "", /RIFT-91/);
  assert.match(program.judgeReason ?? "", /RIFT-81/);
  assert.match(program.judgeReason ?? "", /RIFT-89/);
  assert.match(program.sourceText, /Your Mechs each have \[Assault\]/);
});

test("static ability grants Assault to friendly Mech units", () => {
  const [grant] = program.abilities;
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.equal(grant.effect.keyword, "Assault");
  assert.deepEqual(grant.effect.value, { kind: "constant", value: 1 });
  assert.deepEqual(grant.effect.filter, {
    zone: "board",
    controller: "controller",
    tag: "Mech",
    type: "unit"
  });
});

test("conquer trigger is optional, self-scoped, and links recycle into play", () => {
  const [, trigger] = program.abilities;
  assert.equal(trigger.kind, "triggered");
  assert.equal(trigger.optional, true);
  assert.equal(trigger.trigger.at, "conquer");
  assert.deepEqual(trigger.trigger.filter, { event: "conquer", filter: { role: "self" } });
  assert.equal(trigger.body.length, 2);

  const [recycle, play] = trigger.body;
  assert.equal(recycle.op, "effect.recycle");
  assert.equal(recycle.targets?.length, 1);
  assert.deepEqual(recycle.targets?.[0], {
    id: "rumble.fodder",
    filter: { zone: "board", controller: "controller", type: "unit", role: "other-friendly" },
    min: 1,
    max: 1,
    selection: "one"
  });

  assert.equal(play.op, "effect.play");
  assert.equal(play.linkedTo, "rumble.recycle-fodder");
  assert.deepEqual(play.args.target, { kind: "constant", value: "rumble.mech-in-trash" });
  assert.deepEqual(play.args.cost, {
    kind: "constant",
    value: {
      finalized: true,
      energy: {
        kind: "linked-value",
        instructionId: "rumble.recycle-fodder",
        key: "recycledMight"
      }
    }
  });
  assert.deepEqual(play.targets?.[0], {
    id: "rumble.mech-in-trash",
    filter: { zone: "trash", owner: "controller", tag: "Mech", type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("reference kernel: recycling the fodder unit moves it to the bottom of its deck", () => {
  const testWorld = world().base("fodder", { owner: "A", might: 3 }).build();
  const run = runInstruction(
    recycleDef,
    { target: "rumble.fodder" },
    { world: testWorld, targets: { "rumble.fodder": [testWorld.ref("fodder")] } }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked["recycledCount"], 1);
  assert.equal(testWorld.getObject("fodder")?.zone, "deck");
  assert.deepEqual(testWorld.objectsInZone("A", "deck"), [{ id: "fodder", zoneEntryId: 2 }]);
});

test("reference kernel: the linked play moves the chosen Mech from trash to the board", () => {
  const testWorld = world()
    .card("mech-card", { owner: "A", zone: "trash", types: ["unit"], tags: ["Mech"], energy: 5 })
    .build();
  const run = runInstruction(
    playDef,
    {
      target: "rumble.mech-in-trash",
      cost: { kind: "constant", value: { finalized: true, energy: 0 } }
    },
    {
      world: testWorld,
      targets: { "rumble.mech-in-trash": [testWorld.ref("mech-card")] },
      linked: { recycledMight: 3 }
    }
  );
  assert.equal(run.result?.status, "executed");
  assert.equal(run.linked["played"], 1);
  assert.equal(testWorld.getObject("mech-card")?.zone, "board");
});

test.todo(
  "materialize the reduced Energy cost plan from the recycled unit's Might (cost.modify, RIFT-89) and assert the payment events"
);
test.todo(
  "grant Assault through continuous.grant-keyword and expand the keyword via RIFT-81 once the layers work (RIFT-91) lands"
);
