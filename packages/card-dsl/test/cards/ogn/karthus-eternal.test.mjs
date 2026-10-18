// Scenario execution evidence: ../templates/static-666.test.mjs (one row per card plus condition boundaries).
// This file retains validation, identity, and key IR structure checks; whole-card status stays judge-required until all consumers exist.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/karthus-eternal.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import deathknell from "../../../../engine-core/dist/effects/keywords/Deathknell.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createEngineStaticBinder, createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-f3293211dd6f878acb245cc2cf0f2d2f2b066eed84ddbc009999e2176265a0ae";
const [ability] = program.abilities;

test("ogn-236-298 Karthus, Eternal: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-236-298 Karthus, Eternal: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /808\.1/);
  assert.match(program.judgeReason, /continuous\.trigger-multiplicity/);
  assert.match(program.judgeReason, /EventPipeline\.scan/);
  assert.match(program.judgeReason, /卡牌正文尚未接到死亡触发/);
  // The Deathknell body binding gap is still described in those words.
  assert.match(program.judgeReason, /Deathknell 展开体/);
  assert.match(program.judgeReason, /808\.3/);
  assert.match(program.judgeReason, /staticTarget/);
  assert.equal(program.sourceText, "Your [Deathknell] effects trigger an additional time.");
});

test("ogn-236-298 Karthus, Eternal: one static trigger-multiplicity effect scoped to friendly Deathknells", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.trigger-multiplicity");
  assert.equal(ability.effect.mode, "additional");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(ability.effect.appliesTo, {
    keyword: "Deathknell",
    controller: "controller",
    zone: "board"
  });
  assert.equal(ability.condition, undefined);
  assert.equal(keywordDefinitionsById.get(ability.effect.appliesTo.keyword), deathknell);
});

test("ogn-236-298 Karthus, Eternal: Deathknell declares independent self-death triggers (808.1/808.2)", () => {
  assert.equal(keywordDefinitionsById.get("Deathknell"), deathknell);
  assert.equal(deathknell.stacking, "separate");
  const [expanded] = deathknell.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.kind, "triggered");
  assert.equal(expanded.trigger.at, "object-killed");
  assert.deepEqual(expanded.trigger.filter, { self: true, cause: "kill", destination: "trash" });
  assert.equal(expanded.optional, false);
});

test.todo(
  "Karthus: collect an additional friendly Deathknell trigger, with separate chain item/targets, " +
    "using continuous.trigger-multiplicity and a bound Deathknell effect body (CR 808.1/808.2, 383.4.g.2)"
);

test("ogn-236-298 Karthus, Eternal: the merged static binder cannot map continuous.trigger-multiplicity", () => {
  // RIFT-258's layer mapping covers copy/trait/ability/arithmetic and the continuous.might/
  // grant-keyword/keyword/movement/restriction kinds; the multiplication kind has no branch.
  // Binding under an executable status (the registry refuses judge-required programs;
  // sfd/honest-broker precedent) proves the block is the missing consumer, not the status.
  const kernel = world().unit("karthus", { cardId: program.canonicalCardId, types: ["unit"], might: 3 }).build();
  const source = kernel.getObject("karthus");
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const [staticAbility] = binding.inspect(source).abilities.filter((ability) => ability.kind === "static");
  assert.equal(staticAbility.effect.kind, "continuous.trigger-multiplicity");
  const binder = createEngineStaticBinder({
    layers: { addContinuous: () => {}, removeContinuous: () => {} },
    pipeline: {
      host: { objects: () => kernel.objects, context: () => kernel.clone({ sourceSnapshot: source }) },
      registerReplacement: () => {}
    }
  });
  // The declared keyword/appliesTo selector is rejected by the static filter vocabulary...
  assert.throws(
    () => binder.bindStatic(staticAbility, source),
    /Unsupported static appliesTo/
  );
  // ...and even the self-anchored form stops at the missing layer mapping, so no
  // registration ever reaches the layer registry or EventPipeline.scan.
  assert.throws(
    () => binder.bindStatic({ kind: "static", effect: { ...staticAbility.effect, appliesTo: "self" } }, source),
    /trigger-multiplicity has no layer mapping/
  );
});

test("ogn-236-298 Karthus, Eternal: no registry consumer reads trigger multiplicity or trigger.leave", () => {
  // Both dependencies named by judgeReason are absent from the merged instruction registry,
  // so the additional-collection and the Deathknell body binding cannot be executed.
  assert.equal(instructionDefinitionsById.has("trigger.leave"), false);
  assert.equal(instructionDefinitionsById.has("continuous.trigger-multiplicity"), false);
});
