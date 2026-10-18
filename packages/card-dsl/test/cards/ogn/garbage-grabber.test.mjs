// Execution evidence for the merged slice (1 energy + exhaust + Draw 1) lives
// in the RIFT-689 parameterized template golden:
// test/cards/templates/activated-activated-effect-draw-689.test.mjs
// This file keeps validation, identity, verbatim text, the declared status and
// the key structure of the printed cost/body.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/garbage-grabber.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-00d819e309a473483d8a8fe1f5b4cd6332aed4778597aa7272e310eba60023c8";

test("ogn-099-298 Garbage Grabber: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ogn-099-298 Garbage Grabber: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  const [ability] = program.abilities;
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, "Recycle 3 from your trash, :rb_energy_1:, :rb_exhaust:: Draw 1.");
  assert.match(program.judgeReason, /417\.6/);
  assert.match(program.judgeReason, /355\.10\.c/);
  assert.match(program.judgeReason, /choiceObjects/);
  assert.match(program.judgeReason, /Cost requires an exact object reference/);
  assert.match(program.judgeReason, /417\.5/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
  // 404.1.a: the printed trio is one activated cost with the Draw 1 effect.
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
});

test("ogn-099-298 Garbage Grabber: the printed cost is 1 energy + exactly 3 recycled cards + exhaust me", () => {
  const [ability] = program.abilities;
  assert.deepEqual(ability.cost.kind, "activated");
  assert.deepEqual(ability.cost.energy, { kind: "constant", value: 1 });
  assert.equal(ability.cost.payments.length, 2);

  const [recycle, exhaust] = ability.cost.payments;
  assert.equal(recycle.kind, "recycle");
  assert.deepEqual(recycle.amount, { kind: "constant", value: 3 });
  // 417.3/417.6: "Recycle 3 from your trash" is a completable, non-targeting
  // cost choice. min === max encodes "exactly 3"; "up-to" would allow paying
  // the cost with fewer cards and is therefore not printed here.
  assert.equal(recycle.choice.id, "garbage-grabber.recycled-cards");
  assert.equal(recycle.choice.min, 3);
  assert.equal(recycle.choice.max, 3);
  assert.equal(recycle.choice.selection, undefined);
  assert.equal(recycle.choice.zone, "trash");
  assert.equal(recycle.choice.owner, "controller");
  assert.deepEqual(exhaust, { kind: "exhaust" });
});

test("ogn-099-298 Garbage Grabber: the body is one independent Draw 1", () => {
  const [ability] = program.abilities;
  assert.equal(ability.body.length, 1);
  const [draw] = ability.body;
  assert.equal(draw.id, "draw-1");
  assert.equal(draw.op, "effect.draw");
  assert.deepEqual(draw.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(draw.linkedTo, undefined);
  assert.equal(draw.targets, undefined);
  assert.equal(draw.picks, undefined);
  assert.equal(draw.condition, undefined);
});
