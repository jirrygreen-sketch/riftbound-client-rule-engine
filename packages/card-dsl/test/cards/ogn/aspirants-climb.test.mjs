import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/aspirants-climb.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

test("ogn-276-298 Aspirant's Climb: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("ogn-276-298 Aspirant's Climb: identity, ruleset, status and printed text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-fcad8933f7d202b4257c42152d9db853ca4833cb50e75d63d54ab0462883e34d"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // deck-catalog.json (ogn-276-298) carries this text verbatim.
  assert.equal(program.sourceText, "Increase the points needed to win the game by 1.");
  // The unresolved part is the missing Victory Score operation.
  assert.match(program.judgeReason, /Victory Score/);
  assert.match(program.judgeReason, /194\.3/);
  // The static binding half is merged; the remaining dependency is the primitive.
  assert.match(program.judgeReason, /static binding is merged/);
});

test("ogn-276-298 Aspirant's Climb: no ability is encoded because no primitive changes the Victory Score", () => {
  // Contract 3.2: an Instruction is `op: OpcodeId` into
  // effects/instructions/<op>.ts. The merged registry contains no victory
  // threshold operation (effect.score awards points per CR 470/473.1, and
  // effect.win declares a winner per CR 195/196), and the closed GameAction set
  // of contract 3.6 has no such action either. Inventing an opcode here would
  // describe a card as executable when nothing can execute it.
  assert.deepEqual(program.abilities, []);
});

test.todo(
  "ogn-276-298 Aspirant's Climb: bind a continuous Victory Score +1 rule to the battlefield's active lifetime, stacking and removing it in TurnFlow (CR 194.3.a/485.3.a); the independent scoring-state setter is insufficient."
);
