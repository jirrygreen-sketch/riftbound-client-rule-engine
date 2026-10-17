import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shadow-assassin.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

// Execution evidence for the supported replacement body lives in
// ../templates/replacement-effect-ready-655.test.mjs.
const CARD_ID =
  "card.hash-101dc13865ec4192cab5368a9a51d1582968c98f57b52ab293cd35e4c5313b0c";
const SOURCE_TEXT = "I enter ready if you have a card with my name in your trash.";

const [replacement] = program.abilities;
const [enterReady] = replacement.with;

test("ven-013-166 Shadow Assassin: validates and is registered by canonical identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /matchesEnterAction/);
  assert.match(program.judgeReason, /132\.1\/132\.3\/132\.4/);
});

test("ven-013-166 Shadow Assassin: records the same-name Trash condition", () => {
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.deepEqual(replacement.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "cards",
      filter: { zone: "trash", owner: "self", sameNameAs: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
  assert.deepEqual(enterReady, {
    id: "shadow-assassin.enter-ready",
    op: "effect.ready",
    args: { objects: { kind: "constant", value: { kind: "source" } } }
  });
});
