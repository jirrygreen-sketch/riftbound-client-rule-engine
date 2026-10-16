import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/taric-protector.js";


test("ogn-074-298: identity, exact source text, pure data and explicit blocked status", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(program.canonicalCardId, "card.hash-28133bb22a32a90c2f06d32acb4d895d0867ae822e8e802eb227f80405c2ea6f");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Tank|designation/);
  assert.match(program.judgeReason, /RIFT-/);
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

test.todo("Taric: Shield defender Might, Tank damage priority and summed granted Shield (CR 814/815; RIFT-83/91 keyword consumers)");
test.todo("Taric: real continuous.keyword aura updates for friendly/enemy/other-location units and moving/removing the host (RIFT-1/91 layer filter/host binding)");
