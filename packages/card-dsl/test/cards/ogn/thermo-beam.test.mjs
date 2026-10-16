import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/thermo-beam.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [speed, play] = program.abilities;
const killInstruction = play.body[0];

test("Thermo Beam program is valid EffectIR v2 data and judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.status, "judge-required");
  // The reason must cite the untargeted-set rule and the missing selection.
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /355\.5/);
  assert.match(program.judgeReason, /target\.many/);
});

test("Thermo Beam identity, status and sourceText match the printing", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-6a20eaa5d0de7ffae215ad7179d8429ac1a7b0cf0e32667d6cdaf0a546cc7edf"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\n" +
      "Kill all gear."
  );
  assert.match(program.sourceText, /Kill all gear\./);
});

test("Thermo Beam structure: [Action] plus one untargeted gear query kill", () => {
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  // Printed cost (5 Energy + 2 Fury power) comes from the catalog.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 5 },
    power: { kind: "constant", value: 2 }
  });
  assert.deepEqual(
    play.body.map(instruction => [instruction.id, instruction.op]),
    [["thermo-beam.kill-all-gear", "effect.kill"]]
  );

  // "Kill all gear" is not a choice and not targeted (355.5, 355.10.d): the
  // selection is a characteristic query, with no TargetSpec and no PickSpec.
  assert.equal(killInstruction.targets, undefined);
  assert.equal(killInstruction.picks, undefined);
  assert.deepEqual(killInstruction.args.objects, {
    kind: "constant",
    value: { kind: "query", filter: { type: "gear", zone: "board" } }
  });
  assert.equal(killInstruction.linkedTo, undefined);
});

test("Thermo Beam golden execution: the merged kill primitive rejects the untargeted query shape", () => {
  // This is the executable guard: effect.kill only resolves target/picks/self
  // sets, so the untargeted query is rejected by the primitive's own schema
  // rather than silently degrading into target selection (which would emit
  // became-target events that 355.10.d forbids).
  assert.throws(
    () => kill.argsSchema.parse({ objects: killInstruction.args.objects.value }),
    /effect\.kill requires args\.target, args\.picks, or args\.self: true/
  );
});

test("Thermo Beam golden execution: a gear resolved as an explicit set is killed, showing the primitive boundary", () => {
  // Control case: the merged effect.kill does kill every object in a resolved
  // set when no count is given, but the set must arrive as a TargetSpec/PickSpec.
  // That is exactly why "Kill all gear" cannot be expressed without inventing a
  // target selection, and why the card stays judge-required.
  const kernel = world()
    .unit("friendly-gear", { owner: "A", types: ["gear"] })
    .unit("enemy-gear", { owner: "B", types: ["gear"] })
    .unit("plain-unit", { owner: "B", types: ["unit"] })
    .build();

  const run = runInstruction(
    kill,
    { target: "all-gear" },
    {
      world: kernel,
      targets: {
        "all-gear": [kernel.ref("friendly-gear"), kernel.ref("enemy-gear")]
      }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("friendly-gear").zone, "trash");
  assert.equal(kernel.getObject("enemy-gear").zone, "trash");
  assert.equal(kernel.getObject("plain-unit").zone, "board");
  assert.equal(run.linked.killed.length, 2);
});

test.todo(
  "Thermo Beam: 'Kill all gear' needs an untargeted each/all set selection " +
    "consumed by effect.kill (RIFT-9 target.many; 355.10.d, 355.5), so every gear " +
    "on the board dies with no selection step and no became-target events, " +
    "including a unit that is also a gear (178.3)."
);
