import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/smoke-screen.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CARD_ID = "card.hash-e97af51e4273d0e357336eeb9843588d53ddb174bbf2fe8c0ce001f8f5cc3674";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Give a unit -4 :rb_might: this turn, to a minimum of 1 :rb_might:.";

const [reactionKeyword, play] = program.abilities;
const [debuff] = play.body;

test("ogn-093-298 Smoke Screen: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-093-298 Smoke Screen identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-093-298 Smoke Screen judgeReason names the Might primitive and the printed clamp", () => {
  assert.match(program.judgeReason, /continuous\.might|addContinuous/);
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /1/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("ogn-093-298 Smoke Screen structure: [Reaction] keyword plus one targeted -4 Might instruction", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(reactionKeyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);
  assert.equal(debuff.id, "smoke-screen.debuff");
  assert.equal(debuff.op, "continuous.might");
  assert.equal(debuff.linkedTo, undefined);
  assert.equal(debuff.picks, undefined);
  assert.equal(debuff.condition, undefined);

  // "Give a unit -4 Might this turn": the printed -4 with a per-turn duration.
  assert.deepEqual(debuff.args.amount, { kind: "constant", value: -4 });
  assert.deepEqual(debuff.args.duration, { kind: "constant", value: "this-turn" });
  // "to a minimum of 1 Might" is the printing's own floor, not the generic
  // 143.2.c rule, so it is carried as the modification's floor.
  assert.deepEqual(debuff.args.minimum, { kind: "constant", value: 1 });

  // "a unit" — exactly one Board unit, any controller (355.7/355.9.a.1).
  assert.deepEqual(debuff.targets, [
    {
      id: "smoke-screen.unit",
      filter: { type: "unit" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("ogn-093-298 Smoke Screen: the merged Reaction keyword is registered while Might remains pending", () => {
  assert.equal(keywordDefinitionsById.has("Reaction"), true);
  assert.equal(keywordDefinitionsById.get("Reaction").valued, false);
});

test.todo(
  "Smoke Screen: applying -4 Might for the turn (143.2.a/475/478) needs the arithmetic-layer " +
    "continuous.might instruction primitive registering through ResolveContext.addContinuous"
);

test.todo(
  "Smoke Screen: clamping the result at the printed minimum of 1 Might instead of the layer engine's " +
    "generic 0 floor needs a floors/limit channel on the pending Might-modification primitive"
);

test.todo(
  "Smoke Screen: [Reaction] admission (813.1.b/813.1.c) belongs to the chain's canAct check plus the " +
    "continuous.timing consumer (contract 3.5 / RIFT-91)"
);
