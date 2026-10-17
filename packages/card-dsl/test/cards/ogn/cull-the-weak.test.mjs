// RIFT-684: full execution evidence is in templates/play-effect-kill-684.test.mjs.
// This file keeps the card's validation, identity, status and IR structure.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/cull-the-weak.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-3f533cd1f26b1998b23e4537e0fd7e5c386685bf6abffe0e6e211b3f43845744";
const [play] = program.abilities;
const [killInstruction] = play.body;
const [pickSpec] = killInstruction.picks;

test("Cull the Weak validates and preserves its printing identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.10\.e/);
  assert.match(program.judgeReason, /chooser/);
  assert.match(program.judgeReason, /自己控制/);
  assert.equal(program.sourceText, "Each player kills one of their units.");
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("Cull the Weak keeps one non-targeted per-player pick and kill", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.equal(killInstruction.id, "cull-the-weak.kill");
  assert.equal(killInstruction.op, "effect.kill");
  assert.equal(killInstruction.targets, undefined);
  assert.deepEqual(killInstruction.args, {
    picks: { kind: "constant", value: "cull-the-weak.units" }
  });
  assert.deepEqual(pickSpec, {
    id: "cull-the-weak.units",
    options: ["one-unit-per-player"],
    filter: { types: "unit", owner: "controller" },
    selection: "any"
  });
});
