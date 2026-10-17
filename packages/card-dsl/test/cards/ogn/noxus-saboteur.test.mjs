// Scenario evidence: ../templates/static-641.test.mjs (supported paths and explicit binding gaps).
// Whole-card execution remains pending; the existing component evidence below is retained.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/noxus-saboteur.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import restrict from "../../../../engine-core/dist/effects/instructions/continuous.restrict.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";

const CARD_ID = "card.hash-e5d5e81a865437ba16c7a9dd066d67dc5f437867e4ec858ae5245045cc548caf";
const [restriction] = program.abilities;

test("noxus-saboteur: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("noxus-saboteur: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /425\.2\.a/);
  assert.match(program.judgeReason, /811\.5\.a/);
  assert.match(program.judgeReason, /controller: opponent/);
  assert.match(program.judgeReason, /effect\.reveal/);
  assert.equal(program.sourceText, "Your opponents' [Hidden] cards can't be revealed here.");
});

test("noxus-saboteur: a single static continuous restriction forbids revealing opponent Hidden cards", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(restriction.kind, "static");
  assert.equal(restriction.condition, undefined);
  assert.equal(restriction.effect.kind, "continuous.restrict");
  assert.deepEqual(restriction.effect.actions, ["reveal"]);
  assert.equal(restriction.effect.restriction, "opponent-hidden-cards-cannot-be-revealed-here");
});

test("noxus-saboteur: the restricted set is the opponents' Hidden cards at this location (811.5, 421.1)", () => {
  assert.deepEqual(restriction.effect.appliesTo, {
    keyword: "Hidden",
    controller: "opponent",
    zone: "board",
    sameLocationAs: "self",
    characteristics: { faceDown: false }
  });
  // CR 811.5/811.5.a: Hidden is a keyword characteristic, not a tag, and is
  // absent while the card is facedown.
  assert.equal(restriction.effect.appliesTo.tag, undefined);
  // 811.1.a: Hidden appears on Spells, Units, and Gear, so the restriction must
  // not be narrowed to one card type (811.5 lets effects check the characteristic).
  assert.equal(restriction.effect.appliesTo.type, undefined);
});

test("noxus-saboteur: continuous.restrict registers the printed reveal prohibition", () => {
  const kernel = world().unit("saboteur", { owner: "A" }).build();
  const literal = value => ({ kind: "constant", value });
  const run = runInstruction(
    restrict,
    {
      action: literal(restriction.effect.actions),
      restriction: literal(restriction.effect.restriction),
      appliesTo: literal(restriction.effect.appliesTo),
      duration: literal("permanent")
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.deepEqual(kernel.continuousEffects[0].effect.effect.actions, ["reveal"]);
  assert.equal(
    kernel.continuousEffects[0].effect.effect.restriction,
    "opponent-hidden-cards-cannot-be-revealed-here"
  );
  assert.deepEqual(kernel.continuousEffects[0].effect.filter, restriction.effect.appliesTo);
});

test("noxus-saboteur: the static binder refuses the declared Hidden/opponent appliesTo", () => {
  const kernel = world()
    .unit("noxus-saboteur", { cardId: program.canonicalCardId, location: { type: "base", player: "A" } })
    .build();
  const source = kernel.getObject("noxus-saboteur");
  const layers = createLayerEngine([source]);
  const binder = createEngineStaticBinder({ layers });
  assert.throws(
    () => binder.bindStatic(program.abilities[0], source),
    /Unsupported static appliesTo \{"keyword":"Hidden","controller":"opponent","zone":"board","sameLocationAs":"self","characteristics":\{"faceDown":false\}\}/
  );
  assert.deepEqual(layers.registry.list(), []);
});

test.todo(
  "noxus-saboteur: resolve the relative opponent filter in the static binder and consume " +
    "continuous.restrict from Reveal legality, including the 811.5.a facedown/Hidden distinction " +
    "(the binder currently rejects controller:opponent and effect.reveal does not query continuous.restrict)"
);
