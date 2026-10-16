import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/grand-strategem.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

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

test("ogn-233-298 Grand Strategem judgeReason names the remaining binding gaps", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /不能把/);
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
  assert.deepEqual(mightInstruction.args.filter, {
    kind: "constant",
    value: { type: "unit", controller: "controller", zone: "board" }
  });

  // "friendly units" is a criteria-based set, not a choice: nothing is targeted
  // (355.5.a / 355.10.d), so there is no TargetSpec and no PickSpec.
  assert.equal(mightInstruction.targets, undefined);
  assert.equal(mightInstruction.picks, undefined);
  assert.equal(mightInstruction.linkedTo, undefined);
  assert.equal(mightInstruction.condition, undefined);
});

test("ogn-233-298 Grand Strategem golden: the real interpreter registers +5 Might for friendly units", () => {
  const base = world()
    .unit("grand-strategem", { owner: "A", controller: "A", might: 4 })
    .unit("friendly-unit", { owner: "A", controller: "A", might: 2 })
    .unit("enemy-unit", { owner: "B", controller: "B", might: 2 })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("grand-strategem") });
  const executableBody = play.body.map(instruction => ({
    ...instruction,
    args: {
      ...instruction.args,
      filter: {
        kind: "constant",
        value: { type: "unit", controller: "A", zone: "board" }
      }
    }
  }));
  const outcome = runAbilityBody(executableBody, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.affected.count, 2);
  const engine = createLayerEngine(
    kernel.objects,
    kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  assert.equal(engine.evaluate(kernel.ref("grand-strategem")).might, 9);
  assert.equal(engine.evaluate(kernel.ref("friendly-unit")).might, 7);
  assert.equal(engine.evaluate(kernel.ref("enemy-unit")).might, 2);
  assert.equal(kernel.continuousEffects[0].duration.type, "end-of-turn");
});

test.todo(
  "Grand Strategem: bind the card program into the complete play adapter so the Action spell " +
    "can execute this body from an actual card play (RIFT-257)."
);

test.todo(
  "Grand Strategem cast: paying 6 energy + 3 Order power and enforcing the [Action] showdown " +
    "permission (RIFT-261 cost plan and RIFT-257 play adapter)."
);
