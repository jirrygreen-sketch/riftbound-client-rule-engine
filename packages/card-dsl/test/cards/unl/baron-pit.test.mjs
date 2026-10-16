import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/baron-pit.js";
// The Ganking expansion is what an approximation of this card would silently
// reuse if "can move here from anywhere" were written as [Ganking].
import ganking from "../../../../engine-core/dist/effects/keywords/Ganking.js";

const CANONICAL_ID =
  "card.hash-9a277d1f603718992521dc7464de01bdb5cc00d5d35d10081db5b0c9cfc4c3db";
const SOURCE_TEXT =
  "(You can't start the game with a token battlefield.)\nUnits can move here from anywhere.";

const [ability] = program.abilities;

test("unl-t01 Baron Pit: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-t01 Baron Pit: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The reminder parenthetical is part of the printed text even though it adds
  // no ability (135.2.d.1 / 135.2.d.3).
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /187\.9/);
  assert.match(program.judgeReason, /449\.1/);
  assert.match(program.judgeReason, /zones\/movement/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /RIFT-75/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("unl-t01 Baron Pit: one passive move permission with this Battlefield as the destination", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 187.9: "Units can move here from anywhere." 449.1/449.2: a Move is defined
  // by its Origin and Destination, so the permission must record both halves.
  assert.equal(ability.effect.kind, "continuous.movement");
  assert.equal(ability.effect.move, "standard");
  assert.equal(ability.effect.origin, "anywhere");
  assert.equal(ability.effect.destination, "self");
  // It grants a destination permission only; it is not Ganking and does not
  // touch 449.2.a / 451.2's other destination restrictions.
  assert.equal(ability.effect.addsPermission, true);
  assert.equal(ability.effect.canGank, undefined);
  assert.equal(ability.effect.restriction, undefined);
  assert.deepEqual(ability.effect.filter, { type: "unit", zone: "board" });
  // The 053.3 "here" referent is NOT expressed as sameLocationAs: that anchor
  // constrains where the affected object sits, not where a Move ends (see
  // judgeReason point 4).
  assert.equal(ability.effect.filter.sameLocationAs, undefined);
});

test("unl-t01 Baron Pit: the declared permission is not the [Ganking] expansion", () => {
  // 810.1.b / 810.1.c: Ganking adds the Battlefield→Battlefield option to the
  // holder's own Standard Move. Baron Pit neither grants Ganking nor restricts
  // itself to "battlefield to battlefield": it opens the DESTINATION at this
  // Battlefield to units coming from anywhere (187.9, 449.1/449.2). The two
  // declared shapes must therefore differ; reusing the Ganking expansion here
  // would implement another ability.
  const [gankingAbility] = ganking.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(gankingAbility.kind, "static");
  assert.equal(gankingAbility.effect.kind, ability.effect.kind);
  assert.notDeepEqual(gankingAbility.effect, ability.effect);
  assert.notEqual(gankingAbility.effect.permission, ability.effect.permission);
  assert.notEqual(gankingAbility.effect.destination, ability.effect.destination);
});

test.todo(
  "unl-t01 Baron Pit: consume the destination permission in the Standard Move (144.4, 449.1/449.2) " +
    "so a unit may move to this Battlefield from anywhere, without adding the Ganking " +
    "Battlefield->Battlefield option — zones/movement.ts only reads its own readiness/timing " +
    "inputs and no merged code reads the layered MovementPermissions (RIFT-75, RIFT-91)"
);

test.todo(
  "unl-t01 Baron Pit: register this CardProgram's static ability as a ContinuousEffectSpec so the " +
    "permission is even visible in production — registerContinuousEffect has no caller (RIFT-91)"
);

test.todo(
  "unl-t01 Baron Pit: express the 053.3 'here' referent as a Move DESTINATION anchor; the merged " +
    "filter vocabulary only has sameLocationAs, which anchors the affected object's own location " +
    "(that would invert the printed scope)"
);
