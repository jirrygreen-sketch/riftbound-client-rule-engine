import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/lingering-animus.js";

// Execution evidence for the supported replacement body lives in
// ../templates/replacement-effect-ready-655.test.mjs.
const CARD_ID =
  "card.hash-bc88b399b22771c1b0e8eea598eb3d2815cb30e736bb70aa1852191e66c735e3";
const SOURCE_TEXT = "I enter ready if a friendly unit or gear died this turn.";

const [replacement] = program.abilities;
const [enterReady] = replacement.with;

test("rad-005-167 Lingering Animus: validates identity and preserves the unresolved status", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /matchesEnterAction/);
});

test("rad-005-167 Lingering Animus: records the conditional ready-entry replacement", () => {
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  assert.deepEqual(replacement.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "friendly-unit-or-gear-died-this-turn",
      filter: { zone: "history-record", type: ["unit", "gear"], controller: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
  assert.deepEqual(enterReady, {
    id: "lingering-animus.enter-ready",
    op: "effect.ready",
    args: { objects: { kind: "constant", value: { kind: "source" } } }
  });
});
