// Scenario execution evidence: ../templates/static-666.test.mjs (one row per card plus condition boundaries).
// This file retains validation, identity, and key IR structure checks; whole-card status stays judge-required until all consumers exist.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/sneaky-deckhand.js";

const CANONICAL = "card.hash-66b3ff5cc86cf822bdc111bcd4693bcba033d4b02cc95a9e2daf443c8bbedd8a";
const [permission] = program.abilities;

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /play-location-permission/);
  assert.match(program.judgeReason, /continuous\.location/);
  assert.match(program.judgeReason, /playLocations/);
  assert.equal(program.sourceText, "You may play me to an open battlefield.");
});

test("the single ability is a static open-battlefield play permission for self while in hand", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(permission.kind, "static");
  assert.equal(permission.effect.kind, "play-location-permission");
  assert.equal(permission.effect.duration, "while-in-hand");
  assert.deepEqual(permission.effect.value, {
    kind: "constant",
    value: {
      zone: "battlefield",
      battlefield: { open: true },
      appliesTo: "self"
    }
  });
  // No generic play body exists: the card grants a location, it does not do anything on resolution.
  assert.equal(program.abilities.some(ability => ability.kind === "play"), false);
});

test.todo(
  "accept the open-battlefield play location at Make Relevant Choices (CR 355.2.a/355.2.b; open = " +
    "unoccupied and uncontrolled, 170.11.c): wire a card-static continuous.location registration into the " +
    "layers registry and have the Finalize placement validator query playLocations; the current " +
    "play-location-permission shape has no static layer mapping"
);
