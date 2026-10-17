// Golden test for Dangerous Duo (ogn-016-298).
// The Legion gate is expressed as a trigger condition over the cards-finalized
// history; the +2 Might body executes through continuous.might, while the
// trigger gate remains pending on the history-condition adapter.
import test from "node:test";
import assert from "node:assert/strict";
import { validateCardProgram } from "../../../../../packages/card-dsl/dist/ir/index.js";
import program from "../../../../../packages/card-dsl/dist/cards/ogn/dangerous-duo.js";
import { runAbilityBody } from "../../../../../packages/engine-core/dist/effects/interpreter.js";
import { world } from "../../../../../packages/engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-d4e849d845765608b07bf4af4aa19877f6303dfff539b541d0d070320dd05d91";

test("program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason ?? "", /continuous\.might/);
  assert.match(program.sourceText, /\[Legion\]/);
});

test("Legion gate is a trigger condition requiring another card finalized this turn", () => {
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { role: "self" } });
  assert.deepEqual(ability.trigger.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "cards-finalized-this-turn",
      filter: { player: "controller", exclude: "self" }
    },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
});

test("body grants +2 Might to exactly one unit until end of turn", () => {
  const [instruction] = program.abilities[0].body;
  assert.equal(instruction.id, "dangerous-duo.grant-might");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.deepEqual(instruction.args.target, { kind: "constant", value: "dangerous-duo.unit" });
  assert.equal(instruction.targets?.length, 1);
  assert.deepEqual(instruction.targets?.[0], {
    id: "dangerous-duo.unit",
    filter: { zone: "board", type: "unit" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("golden execution: the selected unit receives a registered end-of-turn Might effect", () => {
  const kernel = world()
    .unit("duo", { owner: "A", controller: "A" })
    .unit("chosen", { owner: "A", controller: "A", might: 4 })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("duo") });
  scoped.setTargets("dangerous-duo.unit", [scoped.ref("chosen")]);

  const outcome = runAbilityBody(program.abilities[0].body, scoped);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.continuousEffects.length, 1);
  assert.equal(scoped.continuousEffects[0].effect.filter.objectId, "chosen");
  assert.equal(scoped.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(scoped.continuousEffects[0].effect.effect.amount, 2);
  assert.deepEqual(scoped.continuousEffects[0].duration, { type: "end-of-turn" });
});

test.todo(
  "bind the Legion history gate once TriggerSpec conditions can read ResolveContext.history " +
    "and exclude the source card from the turn play count"
);
