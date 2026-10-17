// RIFT-684: full execution evidence is in templates/play-effect-kill-684.test.mjs.
// This file keeps the card's validation, identity, status and IR structure.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/decree-of-unity.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-0e433716a00b8132f28b20fbf6ccf140068457e64d2ef62cba8d491d4396dc15";
const SOURCE_TEXT = "Kill an enemy Chaos (:rb_rune_chaos:) unit or gear.";
const TARGET_ID = "decree-of-unity.enemy-chaos-object";
const [play] = program.abilities;
const [killInstruction] = play.body;
const [targetSpec] = killInstruction.targets;

test("Decree of Unity validates and preserves its printing identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /134/);
  assert.match(program.judgeReason, /power/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("Decree of Unity keeps its printed cost and enemy Chaos unit-or-gear target", () => {
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.equal(killInstruction.id, "decree-of-unity.kill");
  assert.equal(killInstruction.op, "effect.kill");
  assert.deepEqual(killInstruction.args, {
    target: { kind: "constant", value: TARGET_ID }
  });
  assert.deepEqual(targetSpec, {
    id: TARGET_ID,
    filter: {
      type: ["unit", "gear"],
      zone: "board",
      controller: "opponent",
      power: ["Chaos"]
    },
    min: 1,
    max: 1,
    selection: "one"
  });
});
