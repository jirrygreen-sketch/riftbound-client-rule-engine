// Golden test for Miss Fortune, Buccaneer (ogn-193-298).
//
// Execution evidence (the real printed-cost plays, the open-battlefield
// placement, the unpayable-cost boundary and the fail-closed
// play-location-permission bind) lives in the RIFT-675 parameterized template
// golden: test/cards/templates/static-static-675.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of both permissions.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/miss-fortune-buccaneer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const BUCCANEER_ID = "card.hash-713732fef292fb529d388efbec2020949fdfaeca0c39e3afeb5ed43119a7f3e5";

const CANONICAL = "card.hash-713732fef292fb529d388efbec2020949fdfaeca0c39e3afeb5ed43119a7f3e5";
const SOURCE_TEXT =
  "You may play me to an open battlefield.\nFriendly units may be played to open battlefields.";

const [playSelf, friendlyUnits] = program.abilities;

test("ogn-193-298 Miss Fortune, Buccaneer: passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("miss-fortune-buccaneer: identity, ruleset, status, judgeReason and sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /play-location-permission/);
  assert.match(program.judgeReason, /continuous\.location/);
  // Restored pre-resweep assertion /binder/.
  assert.match(program.judgeReason, /binder/);
  assert.match(program.judgeReason, /layerFor|playDestinationIsLegal/);
  assert.match(program.judgeReason, /open battlefield/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("miss-fortune-buccaneer: two static play-location permissions", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(
    program.abilities.map((ability) => ability.kind),
    ["static", "static"]
  );
  assert.deepEqual(
    program.abilities.map((ability) => ability.effect.kind),
    ["play-location-permission", "play-location-permission"]
  );
  assert.deepEqual(
    program.abilities.map((ability) => ability.effect.duration),
    ["while-in-hand", "while-on-board"]
  );
  assert.deepEqual(
    program.abilities.map((ability) => ability.condition),
    [{ kind: "always" }, { kind: "always" }]
  );
});

test("miss-fortune-buccaneer: 'open battlefield' means unoccupied and uncontrolled (CR 170.11.c)", () => {
  assert.equal(playSelf.effect.value.kind, "constant");
  // CR 170.11.a: occupied = 有单位；170.11.b: uncontrolled = 无玩家控制；
  // 170.11.c: open = 两者同时成立。
  assert.deepEqual(playSelf.effect.value.value, {
    zone: "battlefield",
    battlefield: { occupied: false, controlled: false },
    appliesTo: "self"
  });

  // 第一句只给本卡自己（355.2.b）；第二句给本卡控制者的所有友方单位。
  assert.deepEqual(friendlyUnits.effect.value.value, {
    zone: "battlefield",
    battlefield: { occupied: false, controlled: false },
    appliesTo: "friendly-units"
  });
  assert.equal(playSelf.effect.value.value.appliesTo, "self");
});

test.todo(
  "ogn-193-298 Miss Fortune, Buccaneer: map play-location-permission to a static layer registration and " +
    "consume its open-battlefield value (170.11.c: unoccupied and uncontrolled) during Finalize"
);
test.todo(
  "ogn-193-298 Miss Fortune, Buccaneer: bind the friendly-units permission scope so the controller's units " +
    "may be played to open battlefields (355.2.b)"
);
