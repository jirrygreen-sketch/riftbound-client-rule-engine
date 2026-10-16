import assert from "node:assert/strict";
import test from "node:test";

import program from "../../../dist/cards/ogn/vengeance.js";
import { validateCardProgram } from "../../../dist/ir/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";

const CARD_ID = "card.hash-f67321dac096b3ad1e49b55231663e26f3f9d96efafe79d75719a6eb72fc5caa";

test("ogn-229-298 Vengeance: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(result.value.canonicalCardId, CARD_ID);
  assert.equal(result.value.rulesetVersion, "core-1.5");
  assert.equal(result.value.status, "executable");
});

test("ogn-229-298 Vengeance: structure — one play ability, printed cost, single kill target", () => {
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "play");
  assert.deepEqual(ability.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 4 },
    power: { kind: "constant", value: 2 }
  });
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.op, "effect.kill");
  assert.deepEqual(instruction.args, { target: { kind: "constant", value: "chosen-unit" } });
  assert.equal(instruction.targets.length, 1);
  const [target] = instruction.targets;
  assert.equal(target.id, "chosen-unit");
  assert.deepEqual(target.filter, { type: "unit" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  assert.equal(program.sourceText, "Kill a unit.");
});

test("ogn-229-298 Vengeance: kill clause executes against a board unit (reference kernel)", () => {
  const testWorld = world()
    .unit("vengeance-source", { owner: "A", zone: "chain" })
    .unit("enemy-unit", { owner: "B", zone: "board", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const target = testWorld.ref("enemy-unit");
  const [instruction] = program.abilities[0].body;
  const run = runInstruction(kill, { target: "chosen-unit" }, {
    world: testWorld,
    targets: { "chosen-unit": [target] }
  });
  assert.equal(run.result?.status, "executed");
  assert.equal(testWorld.getObject("enemy-unit")?.zone, "trash");
  assert.deepEqual(run.linked?.killed, [target]);
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].action, "kill");
  assert.equal(instruction.op, kill.op);
});

test("ogn-229-298 Vengeance: a stale target leaves the unit alive (359.3.e recheck)", () => {
  const testWorld = world()
    .unit("vengeance-source", { owner: "A", zone: "chain" })
    .unit("fleeing-unit", { owner: "B", zone: "board", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const stale = testWorld.ref("fleeing-unit");
  testWorld.perform({ type: "return-to-hand", object: stale });
  const run = runInstruction(kill, { target: "chosen-unit" }, {
    world: testWorld,
    targets: { "chosen-unit": [stale] }
  });
  assert.equal(run.result?.status, "ignored");
  assert.equal(run.result?.reason, "mistargeted");
  assert.equal(run.events.length, 0);
  assert.equal(testWorld.getObject("fleeing-unit")?.zone, "hand");
});

test.todo("ogn-229-298 Vengeance: full chain play (cost payment, Action timing admission, became-target trigger emission) — depends on the chain/cost integration tasks RIFT-84/RIFT-85 (cost.printed + chain admission).");
