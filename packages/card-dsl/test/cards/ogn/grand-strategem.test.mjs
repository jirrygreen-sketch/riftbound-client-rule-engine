import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/grand-strategem.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-c93cf1fcde5c50351fa2b80cc594925df51669816b5ce25ba223e27376c47b3a";

const [keyword, play] = program.abilities;
const mightInstruction = play.body[0];

test("ogn-233-298 Grand Strategem: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Action] (Play on your turn or in showdowns.)\nGive friendly units +5 :rb_might: this turn."
  );
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-233-298 Grand Strategem judgeReason names the temporary Might gap and its owners", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /effect\.buff/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ogn-233-298 Grand Strategem structure: [Action] plus a non-target +5 Might-this-turn instruction", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.equal(play.body.length, 1);

  assert.equal(mightInstruction.id, "grand-strategem.might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "literal", value: 5 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "literal", value: "this-turn" });
  assert.deepEqual(mightInstruction.args.appliesTo, {
    kind: "literal",
    value: { type: "unit", controller: "controller", zone: "board" }
  });

  // "friendly units" is a criteria-based set, not a choice: nothing is targeted
  // (355.5.a / 355.10.d), so there is no TargetSpec and no PickSpec.
  assert.equal(mightInstruction.targets, undefined);
  assert.equal(mightInstruction.picks, undefined);
  assert.equal(mightInstruction.linkedTo, undefined);
  assert.equal(mightInstruction.condition, undefined);
});

test.todo(
  "Grand Strategem: applying +5 Might to every friendly unit in the arithmetic layer and " +
    "expiring it at end of turn (continuous.might + continuous.duration, RIFT-91)."
);

test.todo(
  "Grand Strategem cast: paying 6 energy + 3 Order power and enforcing the [Action] showdown " +
    "permission (cost plan / chain timing, RIFT-89 / RIFT-120)."
);
