import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/the-ruination.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-ba55ed991c377657c67727781733c33b7319e9f6e2abc066c541d2f9e83e7c5e";
const SOURCE_TEXT = "Kill all units.";

const [play] = program.abilities;
const [killInstruction] = play.body;

test("unl-180-219 The Ruination: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /target\.many/);
  assert.match(program.judgeReason, /TargetSpec/);
  // Re-review note: effect.repeat is not an honest route either — its action
  // spec binds object fields from ctx.targets/ctx.picks only, so the untargeted
  // 355.10.d set is still unrepresentable (see judgeReason).
  assert.match(program.judgeReason, /repeat/);
});

test("unl-180-219 The Ruination: printed 9 energy + 3 Order power and one untargeted set kill", () => {
  // No printed [Action]/[Reaction]: spells default to Action timing (159.2.a).
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 9 },
    power: { kind: "constant", value: 3 }
  });

  assert.equal(play.body.length, 1);
  assert.equal(killInstruction.id, "the-ruination.kill-all-units");
  assert.equal(killInstruction.op, "effect.kill");
  // 355.10.d / 355.10.d.1: "all units" is selected programmatically from its
  // characteristics and never chosen, so it is neither a TargetSpec nor a
  // PickSpec and must not emit became-target events.
  assert.equal(killInstruction.targets, undefined);
  assert.equal(killInstruction.picks, undefined);
  assert.equal(killInstruction.linkedTo, undefined);
  assert.deepEqual(killInstruction.args.objects, {
    kind: "constant",
    value: { kind: "query", filter: { type: "unit", zone: "board" } }
  });
});

test("unl-180-219 The Ruination golden: a locked set is killed, showing the primitive boundary", () => {
  // Control case: once every unit is handed to effect.kill as a resolved set it
  // does die. That is exactly what "Kill all units" cannot express without
  // inventing a target selection, and why the card stays judge-required.
  const kernel = world()
    .unit("friendly-unit", { owner: "A", might: 3 })
    .unit("enemy-unit", { owner: "B", controller: "B", might: 3 })
    .unit("enemy-gear", { owner: "B", controller: "B", types: ["gear"], might: null })
    .build();
  const run = runInstruction(
    kill,
    { target: "all-units" },
    {
      world: kernel,
      targets: {
        "all-units": [kernel.ref("friendly-unit"), kernel.ref("enemy-unit")]
      }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("friendly-unit").zone, "trash");
  assert.equal(kernel.getObject("enemy-unit").zone, "trash");
  // 178.3: a gear is only affected when the effect names units, and this
  // resolved set does not include it.
  assert.equal(kernel.getObject("enemy-gear").zone, "board");
  assert.equal(run.linked.killed.length, 2);
});

test.todo(
  "unl-180-219 The Ruination: 'Kill all units' needs an untargeted each/all set selection consumed by effect.kill " +
    "(CR 355.10.d, 355.10.d.1) so every unit on the Board dies with no choice step and no " +
    "became-target events, including a unit that is also a gear (178.3)"
);

test.todo(
  "unl-180-219 The Ruination: the kill attribution (429.5) and the object-killed timing point for each killed unit " +
    "(Deathknell, replacement effects) are emitted by the engine's single event pipeline, not by this card"
);

