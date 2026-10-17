import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/shadow-watcher.js";

// Execution evidence for the supported replacement body lives in
// ../templates/replacement-effect-ready-655.test.mjs.
const CARD_ID =
  "card.hash-914ae0a53b785c0cddd76d977413c9c36d1bc8a2bd78e0f3a1d68a71ae5f718e";
const SOURCE_TEXT =
  "If a friendly unit died during your Beginning Phase this turn, I enter ready.";

const [replacement] = program.abilities;
const [enterReady] = replacement.with;

test("unl-037-219 Shadow Watcher: validates identity and preserves the unresolved status", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /315\.2/);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /matchesEnterAction/);
});

test("unl-037-219 Shadow Watcher: records the Beginning-Phase death condition", () => {
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.deepEqual(replacement.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "friendly-units-died-during-your-beginning-phase-this-turn",
      filter: { type: "unit", controller: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
  assert.deepEqual(enterReady, {
    id: "shadow-watcher.enter-ready",
    op: "effect.ready",
    args: { objects: { kind: "constant", value: { kind: "source" } } }
  });
});
