import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/playful-phantom.js";

const CANONICAL_ID =
  "card.hash-0c30d89586c6f97097bcf06afbf4ce2ce7cdedb38ca96c30510f807c7811d024";

test("ogn-049-298 Playful Phantom: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-049-298 Playful Phantom: no-ability unit identity", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "no-ability");
  assert.equal(program.judgeReason, undefined);
  assert.deepEqual(program.abilities, []);
});

test("ogn-049-298 Playful Phantom: sourceText records the confirmable absence of printed abilities", () => {
  // The official gallery record for this printing has an empty ability string;
  // CardProgram requires a non-empty sourceText, so the repository uses the
  // "[NO TEXT]" no-text sentinel. A unit with no printed ability needs no
  // ability entries: its printed cost, Might, domain and tags live in the
  // card-data catalog, and its behavior comes from the general rules.
  assert.equal(program.sourceText, "[NO TEXT]");
});
