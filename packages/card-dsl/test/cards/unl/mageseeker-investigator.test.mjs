import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/mageseeker-investigator.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-b160c71d3dd5254b9c98867feb0f67b7805cefc8624fcf4d00f8f427ab3be532";
const SOURCE_TEXT =
  "Opponents must pay :rb_rune_rainbow: for each unit beyond the first to move " +
  "multiple units to my battlefield at the same time.";

const [applied] = program.abilities;

test("unl-163-219 Mageseeker Investigator: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-163-219 Mageseeker Investigator: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /204\.4/);
  assert.match(program.judgeReason, /cost\.applied/);
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /355\.10\.b/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-163-219 Mageseeker Investigator: the card text is one Applied Cost static ability (204.4)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(applied.kind, "static");
  assert.equal(applied.effect.kind, "cost.applied");
  assert.equal(applied.effect.appliesTo, "self");
  // 204.4.a: the associated Game Action is the linked effect of the Cost; CR
  // narrows it to a simultaneous batch of Moves.
  assert.equal(applied.effect.action, "move");
  assert.equal(applied.effect.batch, "simultaneous");
  // 204.4.b / 204.4.c: the payer is the player performing the Move, and the
  // action is illegal when it cannot or will not be paid.
  assert.equal(applied.effect.payer, "moving-player");
  // 135.2.e.5 / 163.2.b: :rb_rune_rainbow: is Power of any Domain.
  assert.equal(applied.effect.resource, "power");
  assert.equal(applied.effect.domain, "any");
  // 355.10.b: "to my battlefield" is a restriction/permission on the game
  // action, not a target choice.
  assert.deepEqual(applied.effect.destination, { kind: "self-battlefield" });
  // "for each unit beyond the first" over the same simultaneous batch.
  assert.deepEqual(applied.effect.amount, { perBatch: "units-moved", minus: 1 });
});

test.todo(
  "unl-163-219 Mageseeker Investigator: an Applied Cost primitive plus movement wiring that charges [A] per unit " +
    "beyond the first at the same time the batch Move is performed (204.4.a-c) — RIFT-9 / RIFT-89"
);
test.todo(
  "unl-163-219 Mageseeker Investigator: universal Power ([A], 135.2.e.5 / 163.2.b) must stay representable; the six-domain " +
    "enumeration cannot express it and must not be replaced by a colored domain — cost/README.md contract request 2"
);
test.todo(
  "unl-163-219 Mageseeker Investigator: the simultaneous-batch unit count feeding the cost amount, and the " +
    "\"my battlefield\" destination anchor (355.10.b) — movement workstream (RIFT-21/31) and RIFT-90"
);
