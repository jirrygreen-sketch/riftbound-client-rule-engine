// RIFT-684: full execution evidence is in templates/play-effect-kill-684.test.mjs.
// This file keeps the card's validation, identity, status and IR structure.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/soul-harvest.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-1874eb10cc2af76bced76159e28914196dd012c232435193372275264084a018";
const [play] = program.abilities;
const [killInstruction] = play.body;
const [targetSpec] = killInstruction.targets;

test("Soul Harvest validates and preserves its printing identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.9\.b/);
  assert.match(program.judgeReason, /mightLte/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.equal(program.sourceText, "Kill a unit at a battlefield with 3 :rb_might: or less.");
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("Soul Harvest keeps its battlefield target restriction and kill", () => {
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.equal(killInstruction.id, "soul-harvest.kill");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args, {
    target: { kind: "constant", value: "soul-harvest.battlefield-unit" }
  });
  assert.deepEqual(targetSpec, {
    id: "soul-harvest.battlefield-unit",
    filter: {
      type: "unit",
      zone: "board",
      location: "battlefield",
      mightLte: 3
    },
    min: 1,
    max: 1,
    selection: "one"
  });
});
