// RIFT-684: full execution evidence is in templates/play-effect-kill-684.test.mjs.
// This file keeps the card's validation, identity, status and IR structure.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/the-ruination.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-ba55ed991c377657c67727781733c33b7319e9f6e2abc066c541d2f9e83e7c5e";
const [play] = program.abilities;
const [killInstruction] = play.body;

test("The Ruination validates and preserves its printing identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /TargetSpec/);
  assert.match(program.judgeReason, /each\/all/);
  assert.equal(program.sourceText, "Kill all units.");
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("The Ruination keeps an untargeted all-units query shape", () => {
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 9 },
    power: { kind: "constant", value: 3 }
  });
  assert.equal(killInstruction.id, "the-ruination.kill-all-units");
  assert.equal(killInstruction.op, "effect.kill");
  assert.equal(killInstruction.targets, undefined);
  assert.equal(killInstruction.picks, undefined);
  assert.deepEqual(killInstruction.args, {
    objects: {
      kind: "constant",
      value: { kind: "query", filter: { type: "unit", zone: "board" } }
    }
  });
});
