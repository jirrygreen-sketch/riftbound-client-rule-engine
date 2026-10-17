// Execution evidence for the merged slice (exhaust me + Draw 1) lives in the
// RIFT-689 parameterized template golden:
// test/cards/templates/activated-activated-effect-draw-689.test.mjs
// This file keeps validation, identity, verbatim text, the declared status and
// the key structure of the printed cost/restriction/body.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/prodigal-explorer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-0f2d2889821a45fbe61cc42c0f59fd9c445a9a0a9cab9d8af29603770ea28aff";
const SOURCE_TEXT =
  ":rb_exhaust:: [Reaction] — Draw 1. Use only if you've chosen enemy units and/or gear twice this turn " +
  "with spells or unit abilities.";

test("sfd-199-221 Prodigal Explorer: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-199-221 Prodigal Explorer: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // Each stated gap carries its v1.5 anchor and the merged evidence measured by
  // the RIFT-689 golden: the condition, the Restriction adapter, the Legend
  // Zone and the production activation path (assertCanControl).
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /412\.4/);
  assert.match(program.judgeReason, /754/);
  assert.match(program.judgeReason, /054\.2/);
  assert.match(program.judgeReason, /use-only-if/);
  assert.match(program.judgeReason, /needs a rules adapter/);
  assert.match(program.judgeReason, /107\.4/);
  assert.match(program.judgeReason, /assertCanControl/);
  // 108.3 is the Champion Zone; the Legend Zone is 107.4 in v1.5.
  assert.doesNotMatch(program.judgeReason, /108\.3/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-199-221 Prodigal Explorer: one [Reaction]-speed activated ability exhausting the source", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "activated");
  // 813.1.c.2 / 813.1.d: the printed [Reaction] on an ability is the Closed
  // State activation permission on any player's turn.
  assert.equal(ability.timing, "reaction");
  assert.equal(ability.cost.kind, "activated");
  assert.equal(ability.cost.energy, undefined);
  // 404.1.a / 415.5: the leading :rb_exhaust: is the cost "Exhaust me"; 415.4
  // requires the action to be completable.
  assert.deepEqual(ability.cost.payments, [{ kind: "exhaust", object: "self" }]);
});

test("sfd-199-221 Prodigal Explorer: the printed 'use only if' clause stays a restriction", () => {
  const [ability] = program.abilities;
  assert.deepEqual(ability.restriction, {
    kind: "use-only-if",
    value: {
      kind: "constant",
      value: "chosen-enemy-units-or-gear-twice-this-turn-with-spells-or-unit-abilities"
    }
  });
});

test("sfd-199-221 Prodigal Explorer: the body is one unlinked Draw 1 for the controller", () => {
  const [ability] = program.abilities;
  assert.equal(ability.body.length, 1);
  const [draw] = ability.body;
  assert.equal(draw.id, "prodigal-explorer.draw-1");
  assert.equal(draw.op, "effect.draw");
  assert.deepEqual(draw.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(draw.linkedTo, undefined);
  assert.equal(draw.targets, undefined);
  assert.equal(draw.picks, undefined);
  assert.equal(draw.condition, undefined);
});
