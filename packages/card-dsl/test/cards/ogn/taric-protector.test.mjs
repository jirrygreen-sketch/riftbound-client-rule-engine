// Golden test for Taric, Protector (ogn-074-298).
//
// Execution evidence (play, payment, keyword expansion and the fail-closed
// static bind) lives in the RIFT-698 parameterized template golden:
// test/cards/templates/keyword-keyword-static-698.test.mjs.
// This file keeps validation, identity, verbatim text, declared status and the
// key structure of the printed abilities.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/taric-protector.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-28133bb22a32a90c2f06d32acb4d895d0867ae822e8e802eb227f80405c2ea6f";

test("ogn-074-298 Taric, Protector: program validates and is registered by canonicalCardId", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-074-298 Taric, Protector: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Tank/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /exclude/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  assert.equal(program.sourceText, "[Shield] (+1 :rb_might: while I'm a defender.)\n[Tank] (I must be assigned combat damage first.)\nOther friendly units here have [Shield].");
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
});

test("Taric: printed Shield and Tank are declarations with no hand-written expansion", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(program.abilities.slice(0, 2), [{ kind: "keyword", keyword: "shield" }, { kind: "keyword", keyword: "tank" }]);
});

test("Taric: grant Shield only to other friendly units sharing the host's location", () => {
  const grant = program.abilities[2];
  assert.equal(grant.kind, "static");
  assert.deepEqual(grant.effect, { kind: "continuous.keyword", layer: "ability", filter: { type: "unit", zone: "board", controller: "controller", sameLocationAs: "self", exclude: "self" }, keyword: "shield" });
  assert.equal(grant.condition, undefined);
  assert.equal(grant.effect.duration, undefined);
  // The printed aura also applies at a Base; no battlefield-only qualification.
  assert.equal(grant.effect.filter.zone, "board");
});

test.todo(
  "Taric: [Shield] defender Might and [Tank] damage priority need a Defender/Attacker designation " +
    "producer plus the continuous.combat damage-assignment consumer (814.1.d/815.1.b); the " +
    "template golden executes the play, payment and keyword expansion and pins the fail-closed build"
);
test.todo(
  "Taric: 'Other friendly units here have [Shield]' needs the static binder to resolve the " +
    "controller/sameLocationAs/exclude relative filter and to re-expand a granted keyword (364.1/364.2)"
);
