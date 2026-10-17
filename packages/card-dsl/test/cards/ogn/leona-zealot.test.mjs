import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/leona-zealot.js";


test("ogn-079-298: identity, exact source text, pure data and explicit blocked status", () => {
  const validation = validateCardProgram(program);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(validation.issues, []);
  assert.equal(program.canonicalCardId, "card.hash-da797609bf7c16ecdf7c10aed579c7d786c25395e580819421a8f380186df025");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /replacement.enter|Victory Score/);
  assert.match(program.judgeReason, /RIFT-/);
  assert.equal(program.sourceText, "If an opponent's score is within 3 points of the Victory Score, I enter ready.\nStunned enemy units here have -8 :rb_might:, to a minimum of 1 :rb_might:.");
  assert.deepEqual(JSON.parse(JSON.stringify(program)), program);
});

test("Leona: ready ENTRY is a replacement with a dynamic opponent/Victory Score condition", () => {
  assert.equal(program.abilities.length, 2);
  const replacement = program.abilities[0];
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, { event: "object-enters-board", filter: { object: "self", exhausted: true } });
  assert.deepEqual(replacement.condition, { kind: "compare", left: { kind: "count", subject: "players", filter: { relation: "opponent", scoreAtLeast: { relativeTo: "victory-score", offset: -3 } } }, operator: "gte", right: { kind: "constant", value: 1 } });
  assert.equal(replacement.with.length, 1);
  assert.equal(replacement.with[0].op, "replacement.enter");
  assert.deepEqual(replacement.with[0].args, { objects: { kind: "constant", value: "self" }, exhausted: { kind: "constant", value: false } });
  assert.equal(replacement.with[0].targets, undefined);
});

test("Leona: permanent -8 Might applies only to stunned enemies here with printed minimum one", () => {
  const aura = program.abilities[1];
  assert.equal(aura.kind, "static");
  assert.deepEqual(aura.effect, { kind: "continuous.might", layer: "arithmetic", mode: "add", amount: { kind: "constant", value: -8 }, minimum: 1, filter: { type: "unit", zone: "board", controller: "opponent", stunned: true, sameLocationAs: "self" } });
  assert.equal(aura.condition, undefined);
  assert.equal(aura.effect.duration, undefined);
});

test.todo("Leona: entry replacement evaluates any opponent against current Victory Score at distances 3/4, including non-eight modes; never emit ready-after-entry (RIFT-1/91/120)");
test.todo("Leona: real continuous aura at Might 1/8/9/10; preserve friendly/unstunned/other-location units and expire applicability as state changes (RIFT-91 layer filter/minimum bridge)");
