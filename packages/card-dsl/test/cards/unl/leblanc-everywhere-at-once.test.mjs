// Execution evidence for this card lives in ../templates/keyword-static-671.test.mjs (README 4.1); this
// card stays judge-required for the gaps asserted below.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/leblanc-everywhere-at-once.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-00848bf5805bd71357bd0e72b22c97fea424a1b4d5f2cbe6dddfd9d6e709a311";
const SOURCE_TEXT =
  "[Backline] (I must be assigned combat damage last.)\n" +
  "Your [Temporary] effects at my battlefield don't trigger.";

const [backline, suppression] = program.abilities;

test("unl-090-219 LeBlanc, Everywhere at Once: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-090-219 LeBlanc, Everywhere at Once: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Backline/);
  assert.match(program.judgeReason, /826/);
  assert.match(program.judgeReason, /base-combat-allocation/);
  assert.match(program.judgeReason, /trigger-suppression|抑制/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-090-219 LeBlanc, Everywhere at Once: [Backline] is a keyword declaration only", () => {
  // 826.3 / 826.6: Passive Ability keyword; the card declares it and does not
  // restate the combat assignment rule.
  assert.deepEqual(backline, { kind: "keyword", keyword: "backline" });
  assert.equal(backline.value, undefined);
});

test("unl-090-219 LeBlanc, Everywhere at Once: the [Temporary] suppression keeps its battlefield scope", () => {
  // The printed clause suppresses the controller's [Temporary] triggers at the
  // card's battlefield; the trigger-collection stage owns it, so the ability
  // stays a declarative continuous effect with the exact scope.
  assert.equal(suppression.kind, "static");
  assert.equal(suppression.effect.kind, "continuous.trigger-suppression");
  assert.deepEqual(suppression.effect.appliesTo, {
    keyword: "temporary",
    controller: "controller",
    zone: "board",
    here: true
  });
  assert.equal(suppression.condition, undefined);
});

test("unl-090-219 LeBlanc, Everywhere at Once: the declared keywords resolve to the merged definitions", () => {
  const backlineDefinition = keywordDefinitionsById.get("Backline");
  assert.ok(backlineDefinition, "keywords/Backline.ts must be registered for this declaration");
  assert.equal(backlineDefinition.valued, false);
  assert.equal(backlineDefinition.stacking, "single");
  // 826.3 / 826.4.b: the expansion is the declarative combat-restriction shape,
  // not an executable assignment rule.
  const expansion = backlineDefinition.expand({ value: undefined, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.length, 1);
  assert.equal(expansion[0].kind, "static");
  assert.equal(expansion[0].effect.kind, "continuous.combat");
  assert.equal(expansion[0].effect.priority, "last");
});

test("unl-090-219 LeBlanc, Everywhere at Once: the merged Temporary definition expands to a real kill body", () => {
  const temporaryDefinition = keywordDefinitionsById.get("Temporary");
  assert.ok(temporaryDefinition, "keywords/Temporary.ts must be registered");
  const [expansion] = temporaryDefinition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.trigger.at, "beginning-start");
  assert.deepEqual(expansion.trigger.filter, { event: "beginning-start", player: "self" });
  assert.deepEqual(expansion.body.map(instruction => [instruction.id, instruction.op]), [
    [`temporary:${CANONICAL_ID}:kill`, "effect.kill"]
  ]);

  const kernel = world().unit("temporary-token", { zone: "board" }).build();
  const run = runInstruction(kill, { target: "temporary-token" }, {
    world: kernel,
    targets: { "temporary-token": [kernel.ref("temporary-token")] }
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("temporary-token").zone, "trash");
});

test.todo(
  "unl-090-219 LeBlanc, Everywhere at Once: bind the Backline assignment priority in combat damage " +
    "(CR 826.3 / 826.4.b) — combat/base-combat-allocation.ts binds no Tank/Backline requirement"
);
test.todo(
  "unl-090-219 LeBlanc, Everywhere at Once: suppress the [Temporary] triggers collected at this battlefield " +
    "(CR 721.2 / 816.1.b) — the declared continuous.trigger-suppression shape still has no events/ collection-stage consumer"
);
