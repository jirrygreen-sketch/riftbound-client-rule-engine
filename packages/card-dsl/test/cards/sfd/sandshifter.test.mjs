import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sandshifter.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-6c5e86a11835553c21b709846a47353de46fcea93be21041ecaf6f4a50b1ecd7";
const [ability] = program.abilities;
const [instruction] = ability.body;

test("sfd-158-221 Sandshifter: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /mightLte/);
  assert.match(program.judgeReason, /355\.9\.b/);
  assert.equal(
    program.sourceText,
    "When you play me, kill an enemy unit with 3 :rb_might: or less."
  );
});

test("sfd-158-221 Sandshifter: card-played self trigger with one enemy-unit kill", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(instruction.id, "sandshifter.kill-weak-enemy");
  assert.equal(instruction.op, "effect.kill");
  assert.deepEqual(instruction.args.target, {
    kind: "constant",
    value: "sandshifter.weak-enemy-unit"
  });
  assert.equal(instruction.targets.length, 1);
  const [target] = instruction.targets;
  assert.equal(target.id, "sandshifter.weak-enemy-unit");
  assert.equal(target.filter.type, "unit");
  assert.equal(target.filter.controller, "opponent");
  assert.equal(target.filter.zone, "board");
  assert.equal(target.filter.mightLte, 3);
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
});

test("sfd-158-221 Sandshifter: the merged kill primitive resolves a locked target", () => {
  const kernel = world()
    .unit("shifter", { zone: "board" })
    .player("B")
    .unit("weak-enemy", { zone: "board", might: 2, owner: "B", controller: "B" })
    .build();
  const run = runInstruction(
    kill,
    { target: "sandshifter.weak-enemy-unit" },
    { world: kernel, targets: { "sandshifter.weak-enemy-unit": [kernel.ref("weak-enemy")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [{ id: "weak-enemy", zoneEntryId: 1 }]);
  assert.equal(kernel.getObject("weak-enemy").zone, "trash");
});

test("sfd-158-221 Sandshifter: a unit that left the board makes the kill ignored (359.3.e.7)", () => {
  const kernel = world()
    .unit("shifter", { zone: "board" })
    .player("B")
    .unit("weak-enemy", { zone: "board", might: 2, owner: "B", controller: "B" })
    .build();
  const stale = kernel.ref("weak-enemy");
  kernel.perform({ type: "kill", object: stale });
  const run = runInstruction(
    kill,
    { target: "sandshifter.weak-enemy-unit" },
    { world: kernel, targets: { "sandshifter.weak-enemy-unit": [stale] } }
  );
  assert.equal(run.result.status, "ignored");
  assert.equal(run.result.reason, "mistargeted");
});

test.todo(
  "sfd-158-221 Sandshifter: enforce the '3 :rb_might: or less' target ceiling at Finalize/Resolve " +
    "(355.9.b / 143.2.a effective-Might predicate) once a Might filter predicate is merged (RIFT-81~91)"
);
