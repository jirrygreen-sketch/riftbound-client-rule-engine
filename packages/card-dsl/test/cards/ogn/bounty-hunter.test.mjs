import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/bounty-hunter.js";

const ability = program.abilities[0];
const instruction = ability.body[0];
const targetSpec = instruction.targets[0];

test("bounty-hunter program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("bounty-hunter identity: canonicalCardId, ruleset, judge-required status and verbatim text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-c26c4c53932bf73803251e7f0e60d3d3f8c1995783f4e6451d025fc6099f5ff6"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.keyword/);
  assert.match(program.judgeReason, /Ganking/);
  assert.equal(
    program.sourceText,
    ":rb_exhaust:: Give a unit [Ganking] this turn. (It can move from battlefield to battlefield.)"
  );
});

test("bounty-hunter structure: exhaust-only activated ability granting Ganking for the turn", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.equal(ability.cost.energy, undefined);
  assert.deepEqual(ability.cost.payments, [{ kind: "exhaust" }]);
  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "bounty-hunter.grant-ganking");
  assert.equal(instruction.op, "continuous.grant-keyword");
  assert.deepEqual(instruction.args.keyword, { kind: "constant", value: "Ganking" });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.picks, undefined);
  // "a unit" (not "a friendly unit"): the target is any Board unit, so the
  // filter must not carry a controller restriction.
  assert.equal(targetSpec.id, "bounty-hunter.unit");
  assert.deepEqual(targetSpec.filter, { type: "unit", zone: "board" });
  assert.equal(targetSpec.filter.controller, undefined);
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
});

test.todo(
  "bounty-hunter execution: register an end-of-turn Ganking keyword grant through a merged " +
    "continuous-keyword instruction primitive (RIFT-9 continuous.keyword); Granting the keyword " +
    "to an enemy unit is legal and must be covered by the same scenario when it lands."
);

test.todo(
  "bounty-hunter end-to-end: the granted Ganking expands to the CR 810 movement permission and " +
    "the battlefield-to-battlefield Standard Move is legal this turn only (keyword expansion " +
    "RIFT-83 + layers expiry at end-of-turn; P2 batch-6 wiring)."
);
