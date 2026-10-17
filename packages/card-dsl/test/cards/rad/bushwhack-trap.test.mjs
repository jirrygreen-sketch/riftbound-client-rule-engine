// Golden test for Bushwhack Trap (rad-108-167).
// The printed ability is [Deploy] plus the Facedown-Zone capacity permission.
// Neither has a merged expansion or consumer, so this file fixes the declaration,
// the card-data observations (Device Unit with might null) and the gap inventory.
// RIFT-670 single-card golden: validation, identity, judgeReason and the key
// structure of Bushwhack Trap. Real execution evidence for this card (the
// whole-card scenario through the generic card harness plus the measured
// outcome of binding each expanded static ability) lives in
// `test/cards/templates/keyword-static-670.test.mjs`.
//
// The card stays judge-required: the Deploy expansion's `continuous.location`
// has no layer mapping, its `hold` trigger carries the `here` anchor the
// production filter translator rejects, and the Facedown-Zone occupancy clause
// has no zone model or consumer. Nothing here approximates them.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/bushwhack-trap.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-7dc2f2b5203681ffa7df7153d6be71e334c6fc0a355cb23adba138c9dd72e338";
const SOURCE_TEXT =
  "[Deploy] (Play this only to a battlefield. When an opponent holds here, kill this.)\n" +
  "While you or an ally control this battlefield, that player may hide an additional card here.";

const [deployKeyword, facedownPermission] = program.abilities;

test("rad-108-167 Bushwhack Trap: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-108-167 Bushwhack Trap: judgeReason names Deploy, the Facedown Zone and the control clause", () => {
  assert.match(program.judgeReason, /Deploy/);
  assert.match(program.judgeReason, /830\.1\.b/);
  assert.match(program.judgeReason, /facedown-zone/);
  assert.match(program.judgeReason, /107\.3\.b\.1/);
  assert.match(program.judgeReason, /190\.6/);
  assert.doesNotMatch(program.judgeReason, /RIFT-357|RIFT-359/);
});

test("rad-108-167 Bushwhack Trap: [Deploy] is declared as a keyword and nothing else (830.1/830.2)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deployKeyword, { kind: "keyword", keyword: "deploy" });
  // Deploy is expanded by the merged KeywordDef; the card must not rewrite the
  // keyword as bespoke play/permission effects.
  assert.equal(program.abilities.filter(ability => ability.kind === "triggered").length, 0);
  assert.equal(program.abilities.filter(ability => ability.kind === "replacement").length, 0);
});

test("rad-108-167 Bushwhack Trap: the Facedown-Zone permission is a static trait-layer effect (107.3.b.1)", () => {
  assert.equal(facedownPermission.kind, "static");
  assert.equal(facedownPermission.effect.kind, "continuous.facedown-capacity");
  assert.equal(facedownPermission.effect.layer, "trait");
  assert.deepEqual(facedownPermission.effect.value, { kind: "constant", value: 1 });
  assert.equal(facedownPermission.effect.zoneKind, "facedown-zone");
  assert.equal(facedownPermission.effect.here, true);
  assert.equal(facedownPermission.effect.permittedPlayer, "battlefield-controller");
  assert.equal(facedownPermission.condition, undefined);
});

test.todo(
  "rad-108-167 Bushwhack Trap: [Deploy] expansion still needs its source-Battlefield here anchor " +
    "and the location/cleanup consumers before the hold trigger can bind (CR 830.1.b)"
);
test.todo(
  "rad-108-167 Bushwhack Trap: 'that player may hide an additional card here' raising the battlefield's " +
    "Facedown Zone capacity (CR 107.3.a/107.3.b/107.3.b.1, 422.1) — the contract has no facedown-zone " +
    "ZoneId and no Hide action"
);
test.todo(
  "rad-108-167 Bushwhack Trap: 'while you or an ally control this battlefield' resolving the battlefield " +
    "controller (190.6.a/190.6.d) with the here referent (CR 053.3)"
);

