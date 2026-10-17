// RIFT-667 single-card golden: validation, identity and the key IR structure of
// Trifarian War Camp. The real execution evidence for this card (its own scenario
// through the generic card harness plus the measured outcome of binding its own
// static ability with the production binder) lives in
// `test/cards/templates/static-667.test.mjs`.
//
// The card stays judge-required: the registered arithmetic filter carries the
// source LocationRef value, but layers/filter.ts compares structured locations by
// reference and layer snapshots are cloned, so the +1 reaches no unit. Nothing
// here approximates the printed effect.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/trifarian-war-camp.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-ca6330500fc019b19ccf0df937fc22945cc8bf28a51c21eaef572c53cc31387f";
const SOURCE_TEXT = "Units here have +1 :rb_might:. (This includes attackers.)";
const [ability] = program.abilities;

test("ogn-294-298 Trifarian War Camp: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CANONICAL), program);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogn-294-298 Trifarian War Camp: one arithmetic-layer +1 Might static scoped to this Battlefield", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);
  // 479.3.b / 479.4 / 479.4.a / 479.4.e.1: "have" grants the ability and +1
  // Might is an arithmetic-layer increase.
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
  // 053.3: "here" is this Battlefield; it covers both controllers and makes no
  // attacker/defender distinction (hence the printed reminder).
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self"
  });
  assert.equal(ability.effect.filter.controller, undefined);
});

test("ogn-294-298 Trifarian War Camp: judgeReason names the measured location-comparison gap", () => {
  // Re-probed 2026-10-17 (RIFT-667): the production binder really registers this
  // declaration, and the registered filter really matches only an identical
  // location object; cloned layer snapshots never match.
  assert.match(program.judgeReason, /matchesObjectFilter/);
  assert.match(program.judgeReason, /LocationRef/);
  assert.match(program.judgeReason, /battlefield/);
});

test.todo(
  "ogn-294-298 Trifarian War Camp: both controllers' units at this battlefield must gain the printed +1 Might " +
    "(CR 053.3 / 479.4) - layers/filter.ts must compare the here location by battlefield id (and base by player) " +
    "instead of by object reference"
);
