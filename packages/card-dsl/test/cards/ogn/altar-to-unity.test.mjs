import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/altar-to-unity.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world as testWorld } from "../../../../engine-core/dist/effects/testing/index.js";

const [ability] = program.abilities;
const [resolveBase, instruction] = ability.body;

test("ogn-275-298 Altar to Unity: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("ogn-275-298 Altar to Unity: identity, ruleset, status and printed text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-235642b62ac009ff34cfa13db7debd2bf1e71c1a9bf411cf5ffab5dfd06e5099"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // deck-catalog.json (ogn-275-298) carries this text verbatim.
  assert.equal(
    program.sourceText,
    "When you hold here, play a 1 :rb_might: Recruit unit token in your base."
  );
  // The remaining unresolved part is only the hold/here trigger scope.
  assert.match(program.judgeReason, /held/);
  assert.doesNotMatch(program.judgeReason, /kind:'location'/);
});

test("ogn-275-298 Altar to Unity: mandatory hold trigger playing a CR 187.1 Recruit token", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // CR 383.4.d.1: "When you hold here" = this battlefield's controller holds
  // here (timing point "hold", CR 315.2.b.2 / 471.2 / 473.2.b).
  assert.equal(ability.trigger.at, "hold");
  // "held" is the validator's event name; "here" and "controller" stay as the
  // printed scope until the binding layer can express this battlefield.
  assert.deepEqual(ability.trigger.filter, { event: "held", here: true, player: "controller" });
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 2);
  assert.equal(resolveBase.id, "altar-to-unity.resolve-base");
  assert.equal(resolveBase.op, "condition.value");
  assert.deepEqual(resolveBase.args.value, {
    kind: "location",
    value: "ability-controller-base"
  });
  assert.deepEqual(resolveBase.args.key, { kind: "constant", value: "base" });
  assert.equal(instruction.id, "altar-to-unity.play-recruit");
  assert.equal(instruction.op, "effect.token");
  assert.equal(instruction.linkedTo, "altar-to-unity.resolve-base");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  // CR 440.2.c / 185.2.a: "play a … token" creates it on the Chain and hands
  // it to the play action.
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(instruction.args.location, {
    kind: "linked-value",
    instructionId: "altar-to-unity.resolve-base",
    key: "base"
  });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
});

test("ogn-275-298 Altar to Unity: A and B controllers each receive the Recruit in their own base", () => {
  for (const controller of ["A", "B"]) {
    const kernel = testWorld()
      .unit("altar", {
        owner: controller,
        controller,
        location: { type: "battlefield", id: "battlefield-1" }
      })
      .build()
      .clone({ controller });
    const outcome = resolveChainBody(ability.body, kernel);

    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.events.map(event => event.action), ["create-token", "play"]);
    const recruits = kernel.query({ zone: "board", type: "unit" }).filter(object => object.isToken);
    assert.equal(recruits.length, 1);
    const [recruit] = recruits;
    assert.equal(recruit.name, "Recruit");
    assert.equal(recruit.might, 1);
    assert.deepEqual(recruit.tags, ["Recruit"]);
    assert.deepEqual(recruit.location, { type: "base", player: controller });
    assert.equal(recruit.controller, controller);
    assert.equal(recruit.energy, null);
    assert.equal(recruit.power, null);
  }
});

test.todo(
  "ogn-275-298 Altar to Unity: the hold trigger still cannot register: the held emission " +
    "(turn/flow.ts Score wave) carries no object for 'here' to anchor, and no merged field can " +
    "express this battlefield's scope (here:true is rejected by events/trigger-spec.ts and by " +
    "the binding layer), so player:'self' would only approximate the controller's every hold."
);
