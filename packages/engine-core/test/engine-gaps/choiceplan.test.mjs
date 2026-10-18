import assert from "node:assert/strict";
import test from "node:test";

import udyrWildman from "../../../card-dsl/dist/cards/ogn/udyr-wildman.js";
import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import { ChoiceMemory } from "../../dist/chain/finalize/choice-memory.js";
import { ChoicePlanError, choicePlanAnswers, finalizeChoicePlan, resolveChoicePlan } from "../../dist/chain/finalize/choices.js";
import { world } from "../../dist/effects/testing/index.js";

const constant = value => ({ kind: "constant", value });

function modeBody(id, targetId, amount) {
  return {
    id,
    op: "effect.damage",
    args: { amount: constant(amount), target: constant(targetId) },
    targets: [{ id: targetId, filter: { type: "unit", zone: "board" }, min: 1, max: 1, selection: "one" }]
  };
}

function choiceBody() {
  return [{
    id: "choose-one",
    op: "choice.mode",
    args: {
      count: constant(1),
      different: constant(true),
      modes: constant([
        { id: "damage-a", body: [modeBody("damage-a-effect", "target-a", 2)] },
        { id: "damage-b", body: [modeBody("damage-b-effect", "target-b", 3)] }
      ])
    }
  }];
}

function answerContext(worldValue, answers) {
  worldValue.setAnswers(answers);
  return worldValue;
}

function finalizeWithAnswers(kernel, body, answers, options = {}) {
  return finalizeChoicePlan(answerContext(kernel, answers), body, options);
}

test("Finalize locks only the selected mode branch and the production adapter resolves that raw IR", () => {
  const kernel = world()
    .unit("source", { owner: "A", cardId: "ogn-157-298", location: { type: "battlefield" } })
    .unit("target-a", { owner: "B", location: { type: "battlefield" } })
    .unit("target-b", { owner: "B", location: { type: "battlefield" } })
    .build();
  // Udyr, Wildman is a representative blocked card whose original activated
  // ability contains the mode list and branch-local targets.
  const body = udyrWildman.abilities[0].body;
  const plan = finalizeWithAnswers(kernel, body, {
    "udyr.choose-mode/mode%3A0": "udyr.damage-mode",
    "target:udyr.damage-target": [kernel.ref("target-a")]
  });

  assert.deepEqual(plan.selectedModes.map(item => item.selected), [["udyr.damage-mode"]]);
  assert.deepEqual(plan.targets.map(item => item.instructionId), ["udyr.deal-2"]);
  assert.deepEqual(plan.targets[0].plan.selected, [kernel.ref("target-a")]);
  assert.equal(plan.targets.some(item => item.instructionId === "udyr.stun-unit"), false);
  // Feed the finalized target binding into the production Resolve adapter;
  // Resolve retests this exact incarnation instead of making a new choice.
  kernel.setTargets("udyr.damage-target", plan.targets[0].plan.selected);

  // The unmodified card IR is passed through the normal interpreter adapter.
  // It asks the same mode and target choices, then performs the authoritative
  // damage action through the reference ResolveContext.
  kernel.setAnswers(choicePlanAnswers(plan));
  const execution = resolveChainBody(body, kernel);
  assert.equal(execution.status, "executed");
  assert.equal(kernel.getObject("target-a").damage, 2);
  assert.equal(kernel.getObject("target-b").damage, 0);
});

test("optional and repeat bodies own independent target lifecycles", () => {
  const optional = [{
    id: "optional",
    op: "choice.optional",
    args: { body: constant([modeBody("optional-effect", "optional-target", 1)]) }
  }];
  const optionalKernel = world().unit("source").unit("optional-target", { owner: "B" }).build();
  const declined = finalizeWithAnswers(optionalKernel, optional, { "optional/optional": false });
  assert.equal(declined.status, "declined");
  assert.deepEqual(declined.optionalChoices, [{ instructionId: "optional", requestId: "optional/optional", accepted: false, modePath: [] }]);
  assert.deepEqual(declined.targets, []);

  const repeated = [{
    id: "repeat",
    op: "repeat",
    args: {
      count: constant(2),
      body: constant([modeBody("repeat-effect", "repeat-target", 1)])
    }
  }];
  const repeatKernel = world().unit("source").unit("repeat-target", { owner: "B" }).build();
  const repeatedPlan = finalizeWithAnswers(repeatKernel, repeated, {
    "target:repeat-target:repeat:0": [repeatKernel.ref("repeat-target")],
    "target:repeat-target:repeat:1": [repeatKernel.ref("repeat-target")]
  });
  assert.deepEqual(repeatedPlan.repeats, [{ instructionId: "repeat", count: 2, modePath: [] }]);
  assert.deepEqual(repeatedPlan.targets.map(item => item.repeatIndex), [0, 1]);
  assert.deepEqual(repeatedPlan.targets.map(item => item.plan.selected), [[repeatKernel.ref("repeat-target")], [repeatKernel.ref("repeat-target")]]);
});

test("mode memory survives replay, rejects a third same-turn choice, and resets at the turn boundary", () => {
  const memory = new ChoiceMemory();
  const memoryKey = { controller: "A", source: { id: "source", zoneEntryId: 1 }, abilityId: "udyr-ability" };
  const body = [{
    id: "remembered-mode",
    op: "choice.mode",
    args: {
      count: constant(1),
      different: constant(true),
      modes: constant([{ id: "first", body: [] }, { id: "second", body: [] }])
    }
  }];

  const first = finalizeChoicePlan(answerContext(world().unit("source").build(), { "remembered-mode/mode%3A0": "first" }), body, { memory, turn: 7, memoryKey });
  assert.deepEqual(first.memoryEntries[0].modes, ["first"]);
  assert.deepEqual(choicePlanAnswers(first), { "remembered-mode/mode%3A0": "first" });
  const replay = new ChoiceMemory();
  replay.restore(memory.snapshot());
  assert.deepEqual(replay.available({ ...memoryKey, choiceId: "remembered-mode" }, ["first", "second"], 7), ["second"]);

  const second = finalizeChoicePlan(answerContext(world().unit("source").build(), { "remembered-mode/mode%3A0": "second" }), body, { memory, turn: 7, memoryKey });
  assert.deepEqual(second.selectedModes[0].selected, ["second"]);
  assert.throws(
    () => finalizeChoicePlan(answerContext(world().unit("source").build(), { "remembered-mode/mode%3A0": "first" }), body, { memory, turn: 7, memoryKey }),
    error => error instanceof ChoicePlanError && error.code === "no-mode-options"
  );

  const nextTurn = finalizeChoicePlan(answerContext(world().unit("source").build(), { "remembered-mode/mode%3A0": "first" }), body, { memory, turn: 8, memoryKey });
  assert.deepEqual(nextTurn.selectedModes[0].selected, ["first"]);
});

test("illegal or stale targets fail closed and roll back mode memory", () => {
  const memory = new ChoiceMemory();
  const memoryKey = { controller: "A", source: { id: "source", zoneEntryId: 1 }, abilityId: "rollback" };
  const body = [{
    id: "mode",
    op: "choice.mode",
    args: {
      count: constant(1),
      different: constant(true),
      modes: constant([{ id: "kill", body: [modeBody("kill-effect", "target", 1)] }])
    }
  }];
  const kernel = world().unit("source").unit("target", { owner: "B" }).build();
  assert.throws(
    () => finalizeChoicePlan(answerContext(kernel, { "mode/mode%3A0": "kill", "target:target": [{ id: "target", zoneEntryId: 999 }] }), body, { memory, turn: 1, memoryKey }),
    /target choice contains a duplicate or illegal target/i
  );
  assert.deepEqual(memory.snapshot().entries, []);
  const valid = finalizeChoicePlan(answerContext(kernel, { "mode/mode%3A0": "kill", "target:target": [kernel.ref("target")] }), body, { memory, turn: 1, memoryKey });
  kernel.addObject({ ...kernel.getObject("target"), ref: { id: "target", zoneEntryId: 2 } }, "board");
  const stale = resolveChoicePlan(kernel, valid);
  assert.equal(stale.status, "ignored");
  const fresh = finalizeChoicePlan(answerContext(kernel, { "mode/mode%3A0": "kill", "target:target": [{ id: "target", zoneEntryId: 2 }] }), body, { memory, turn: 2, memoryKey });
  kernel.setTargets("target", fresh.targets[0].plan.selected);
  const resolved = resolveChoicePlan(kernel, fresh);
  assert.equal(resolved.status, "resolved");
  assert.deepEqual(resolved.targets[0].selected, [{ id: "target", zoneEntryId: 2 }]);
});
