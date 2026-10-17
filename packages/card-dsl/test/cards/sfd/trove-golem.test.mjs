// Execution evidence: templates/triggered-card-played-effect-token-661.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/trove-golem.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-6e0d0c7e82324687174e1c1585a9fdba369a29e517e743eb601994ed2edb5de9";
const [ability] = program.abilities;
const [instruction] = ability.body;

test("sfd-174-221 Trove Golem: program validates, is registered and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /184\.1/);
  assert.match(program.judgeReason, /token-definition-or-abilities-judge-required/);
  assert.match(program.judgeReason, /LocationExpr/);
  assert.equal(
    program.sourceText,
    "When you play me, play four Gold gear tokens exhausted."
  );
});

test("sfd-174-221 Trove Golem: card-played self trigger plays four Gold tokens", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(instruction.op, "effect.token");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(instruction.args.location, {
    kind: "location",
    value: "ability-controller-base"
  });
  assert.deepEqual(instruction.args.entersExhausted, { kind: "constant", value: true });
  assert.equal(instruction.linkedTo, undefined);
});
