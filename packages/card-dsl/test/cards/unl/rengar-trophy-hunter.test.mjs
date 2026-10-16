import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/rengar-trophy-hunter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-7af45bc5485b4630b0159d3ebb543753b28e1c439f0bdccf266c500a9d157088";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "I can be played to a battlefield where there are enemy units (even if you don't have units there).";

const [ambush, playPermission] = program.abilities;

test("unl-120-219 Rengar, Trophy Hunter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-120-219 Rengar, Trophy Hunter: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Ambush/);
  assert.match(program.judgeReason, /822\.1\.d/);
  assert.match(program.judgeReason, /play-location-permission/);
  assert.match(program.judgeReason, /355\.2\.b/);
  assert.match(program.judgeReason, /RIFT-266/);
});

test("unl-120-219 Rengar, Trophy Hunter: [Ambush] stays a keyword declaration (822.1.a)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(ambush, { kind: "keyword", keyword: "ambush" });
  assert.equal(ambush.value, undefined);
});

test("unl-120-219 Rengar, Trophy Hunter: the verb form widens the Ambush permission as a static ability (822.1.d)", () => {
  // 822.1.d: Ambush used as a verb means "play with the permissions of the
  // Ambush keyword", and the rule text quotes this very card as its example.
  assert.equal(playPermission.kind, "static");
  assert.equal(playPermission.effect.kind, "play-location-permission");
  assert.deepEqual(playPermission.effect.value, {
    kind: "constant",
    value: {
      zone: "battlefield",
      // "where there are enemy units (even if you don't have units there)":
      // enemyUnits is the placeholder for the missing occupancy predicate, and
      // requiresFriendlyUnits records that the normal Ambush condition is lifted.
      battlefield: { enemyUnits: true, requiresFriendlyUnits: false },
      appliesTo: "self"
    }
  });
  // It widens the valid locations of this card as it is played (355.2.b).
  assert.equal(playPermission.effect.duration, "while-in-hand");
  assert.equal(playPermission.condition, undefined);
  // A permission is not a restriction on another play ability.
  assert.equal(program.abilities.filter(ability => ability.kind === "play").length, 0);
});

test("unl-120-219 Rengar, Trophy Hunter: the reminder text is reminder text only (135.2.d.3)", () => {
  // "(even if you don't have units there)" explains the same permission rather
  // than adding a second ability, so the card declares exactly two abilities.
  assert.equal(program.abilities.length, 2);
  assert.match(program.sourceText, /\(even if you don't have units there\)/);
});

test.todo(
  "unl-120-219 Rengar, Trophy Hunter: [Ambush] adds the battlefield permission and grants [Reaction] while " +
    "being played there (CR 822.1.b / 822.1.c / 355.2.b) — no Ambush KeywordDef is merged (RIFT-266)"
);
test.todo(
  "unl-120-219 Rengar, Trophy Hunter: the verb-form permission lets the card be played to a battlefield with " +
    "enemy units even without friendly units there (CR 822.1.d) and the “enemy units” predicate is evaluated " +
    "(740.1.b) — play-location-permission has no layer/Finalize consumer (same gap as sfd/dauntless-vanguard, " +
    "ogn/sneaky-deckhand)"
);

