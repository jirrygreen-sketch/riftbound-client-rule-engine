import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/forgotten-monument.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const [ability] = program.abilities;

test("sfd-209-221 Forgotten Monument: validates, is registered and keeps identity/source text", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(
    program.canonicalCardId,
    "card.hash-b6280b20779b152b78ff7c32ddd405d6d7c490bb00b2e8939b821030dffcab90"
  );
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /third turn/);
  assert.equal(program.sourceText, "Players can't score here until their third turn.");
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("sfd-209-221 Forgotten Monument: static per-player scoring restriction on this battlefield", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.restrict");
  assert.equal(ability.effect.restriction, "score");
  assert.equal(ability.effect.appliesTo, "this-battlefield");
  assert.deepEqual(ability.effect.until, { perPlayerTurn: 3 });
  // Not a controller-scoped ability: the text names no controller (190.6.d does not apply).
  assert.equal(ability.condition, undefined);
  assert.equal(ability.effect.filter, undefined);
});

// The restriction itself is not executable: no continuous.restrict primitive and
// the scoring authority does not consult card restrictions; card IR also has no
// "this is that player's third turn" condition (condition.history is action/timing based).
test.todo(
  "sfd-209-221 Forgotten Monument: continuous.restrict consumer that blocks scoring at this battlefield (470.1/471)"
);
test.todo(
  "sfd-209-221 Forgotten Monument: per-player turn-count condition for 'until their third turn'"
);
