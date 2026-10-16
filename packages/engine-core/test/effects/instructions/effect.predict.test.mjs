import assert from "node:assert/strict";
import test from "node:test";

import effectInspect from "../../../src/effects/instructions/effect.inspect.ts";
import { runInstruction, world } from "../../../src/effects/testing/index.ts";
import { resolveChainBody } from "../../../dist/chain/interpreter-adapter.js";

const literal = value => ({ kind: "literal", value });

const predictBody = amount => [
  {
    id: "predict-look",
    op: "effect.inspect",
    args: {
      player: literal("A"),
      zone: literal("deck"),
      scope: literal("top"),
      amount: literal(amount),
      picksSpecId: literal("predict-top"),
      choose: literal(true),
      chooseCount: literal({ min: 0, max: amount }),
      choiceId: literal("predict-select"),
      choosePicksKey: literal("recycle")
    }
  },
  {
    id: "predict-recycle",
    op: "effect.recycle",
    linkedTo: "predict-look",
    args: {
      objects: {
        kind: "linked",
        instructionId: "predict-look",
        key: "recycle"
      }
    }
  },
  {
    id: "predict-put-back",
    op: "effect.order",
    linkedTo: "predict-recycle",
    args: {
      destination: literal("top"),
      count: {
        kind: "arithmetic",
        operator: "sub",
        operands: [
          literal(amount),
          {
            kind: "linked-value",
            instructionId: "predict-recycle",
            key: "recycledCount"
          }
        ]
      },
      chooseOrder: literal(true)
    }
  }
];

const runBody = (body, kernel, answers = {}) => {
  let outcome;
  const wrapper = {
    op: "test.predict-body",
    argsSchema: { parse: value => value },
    execute(context) {
      outcome = resolveChainBody(body, context);
      return { status: "executed", events: [...outcome.events] };
    }
  };
  return { ...runInstruction(wrapper, {}, { world: kernel, answers }), outcome };
};

const deckIds = kernel => kernel.zoneSlice("A", "deck", "top").map(object => object.ref.id);

test("Predict 2 is inspect with non-target picks, recycle chosen cards, then order the rest", () => {
  const kernel = world().deck(["top", "second", "rest"]).build();
  const [top, second] = kernel.zoneSlice("A", "deck", "top", 2).map(object => object.ref);
  kernel.setPicks("predict-top", [top, second]);

  const asked = runBody(predictBody(2), kernel);
  assert.equal(asked.asked?.request.type, "select-objects");
  assert.deepEqual(asked.asked?.request.options, [top, second]);

  const selected = runBody(predictBody(2), kernel, {
    "predict-look/predict-select": [top],
    "predict-put-back/effect.order:top:A": [second]
  });
  assert.equal(selected.result?.status, "executed");
  assert.deepEqual(deckIds(kernel), ["second", "rest", "top"]);
  assert.equal(selected.outcome.results.find(result => result.id === "predict-recycle").result.linkedValues.recycledCount, 1);
  assert.equal(selected.outcome.results.find(result => result.id === "predict-put-back").result.linkedValues.ordered, 1);
});

test("Predict with an empty deck executes without Burn Out or a choice", () => {
  const kernel = world().build();
  kernel.setPicks("predict-top", []);
  const run = runBody(predictBody(2), kernel);

  assert.equal(run.result?.status, "executed");
  assert.equal(run.asked, null);
  assert.deepEqual(deckIds(kernel), []);
  assert.deepEqual(run.outcome.events, []);
  assert.equal(run.outcome.results.find(result => result.id === "predict-look").result.linkedValues.inspected, 0);
  assert.equal(run.outcome.results.find(result => result.id === "predict-recycle").result.linkedValues.recycledCount, 0);
  assert.equal(run.outcome.results.find(result => result.id === "predict-put-back").result.linkedValues.ordered, 0);
});

test("Predict refuses to infer top order when the non-target pick provider is absent", () => {
  const kernel = world().deck("top").build();
  const run = runInstruction(effectInspect, {
    player: literal("A"),
    scope: literal("top"),
    amount: literal(1),
    choose: literal(true),
    chooseCount: literal({ min: 0, max: 1 })
  }, { world: kernel });

  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.deepEqual(deckIds(kernel), ["top"]);
});
