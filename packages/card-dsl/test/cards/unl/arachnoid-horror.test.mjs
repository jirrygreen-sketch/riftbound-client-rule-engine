// Golden test for Arachnoid Horror (unl-117-219).
//
// Execution evidence (the real printed 6 Energy + 1 Body Power payment, the
// fail-closed play-location-permission binds and the blocked Hunt trigger
// registration) lives in the RIFT-673 parameterized template golden:
// test/cards/templates/keyword-static-static-673.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of the printed abilities.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/arachnoid-horror.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-158f0c8fe09a511b90b88574669f5f31fbfc1742ef2b6dea8f7b903e7a448423";
const SOURCE_TEXT =
  "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
  "I can be played to an occupied battlefield if an enemy unit is alone there.\n" +
  "Friendly units can be played to an occupied battlefield if an enemy unit is alone there.";

const [hunt, selfPermission, friendlyPermission] = program.abilities;

test("unl-117-219 Arachnoid Horror: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-117-219 Arachnoid Horror: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /play-location-permission/);
  assert.match(program.judgeReason, /740\.2\.a/);
  assert.match(program.judgeReason, /occupied/);
  assert.match(program.judgeReason, /battlefieldId/);
  assert.match(program.judgeReason, /EventPattern/);
  assert.match(program.judgeReason, /conquer\/hold/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(257|357|359|265)/);
});

test("unl-117-219 Arachnoid Horror: [Hunt 2] is a valued keyword declaration (823.1.c)", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt", value: 2 });
  // 823.1.c.3: the 2 is the Hunt Value; the card never restates the XP clause.
  assert.equal(hunt.value, 2);
});

test("unl-117-219 Arachnoid Horror: the two printed play permissions are static, not triggered", () => {
  // 355.2.b: game effects may make locations valid that are not valid by default
  // (355.2.a). Both sentences are passive permissions, so neither becomes a
  // trigger or an activated ability.
  assert.equal(selfPermission.kind, "static");
  assert.equal(friendlyPermission.kind, "static");
  assert.equal(program.abilities.filter(ability => ability.kind === "triggered").length, 0);
});

test("unl-117-219 Arachnoid Horror: 'I can be played to an occupied battlefield if an enemy unit is alone there'", () => {
  assert.equal(selfPermission.effect.kind, "play-location-permission");
  assert.deepEqual(selfPermission.effect.value, {
    kind: "constant",
    value: {
      zone: "battlefield",
      // 170.11.a: occupied means a Unit is present. 740.2.a: alone means no other
      // friendly unit at the same location; enemyUnitAlone is the placeholder for
      // that predicate (no merged ObjectFilter anchor evaluates it).
      battlefield: { occupied: true, enemyUnitAlone: true },
      appliesTo: "self"
    }
  });
  // The permission is active while the card is in hand, i.e. while it is played.
  assert.equal(selfPermission.effect.duration, "while-in-hand");
  assert.equal(selfPermission.condition, undefined);
});

test("unl-117-219 Arachnoid Horror: the second sentence extends the same permission to friendly units", () => {
  assert.equal(friendlyPermission.effect.kind, "play-location-permission");
  assert.deepEqual(friendlyPermission.effect.value, {
    kind: "constant",
    value: {
      zone: "battlefield",
      battlefield: { occupied: true, enemyUnitAlone: true },
      appliesTo: "friendly-units"
    }
  });
  // A permanent's passive ability applies while it is on the board (365.1/366).
  assert.equal(friendlyPermission.effect.duration, "while-on-board");
});

test.todo(
  "unl-117-219 Arachnoid Horror: register the Hunt 2 expansion in the real pipeline after aligning the " +
    "conquer/hold filter events with the conquered/held EventPattern vocabulary (823.1.c.1); " +
    "the current registration validator rejects the expansion before the alias matcher can run"
);
test.todo(
  "unl-117-219 Arachnoid Horror: both play-location permissions reach the Make Relevant Choices location choice " +
    "(CR 355.2.b) and the “enemy unit is alone there” gate is evaluated with the 740.2.a predicate " +
    "— no consumer of play-location-permission is merged (same gap as sfd/dauntless-vanguard, ogn/miss-fortune-buccaneer)"
);
test.todo(
  "unl-117-219 Arachnoid Horror: match the scoring wave's battlefieldId to Hunt units present there " +
    "(383.4.c.2.a / 383.4.d.2.a / 823.1.c.1); the translated objectId filter requires unit attribution"
);
