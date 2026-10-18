// RIFT-667 single-card golden: validation, identity and the key IR structure of
// Legion Quartermaster. The whole-card execution evidence (its own real play
// through the generic card harness plus the measured outcome of binding its own
// static ability with the production binder) lives in
// `test/cards/templates/static-667.test.mjs`.
//
// The card stays judge-required: cost.additional has no layer mapping, no module
// binds the declared mandatory additional cost into Finalize, and the merged
// nonstandard cost vocabulary has no return-to-hand component. Nothing here
// approximates the printed cost.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/legion-quartermaster.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-a010c6a3b5692bc45e1c1a552db574267b69092695de19dc7869f7089ece7cb2";
const SOURCE_TEXT = "As an additional cost to play me, return a friendly gear to its owner's hand.";
const [ability] = program.abilities;

test("sfd-044-221 Legion Quartermaster: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-044-221 Legion Quartermaster: a mandatory additional cost from a passive ability (356.2.b.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // 356.2 / 356.2.a: the ability itself specifies the additional cost, which the
  // Total Cost step 2 collects.
  assert.equal(ability.effect.kind, "cost.additional");
  assert.equal(ability.effect.appliesTo, "self");
  // No printed "may", so the cost is mandatory.
  assert.equal(ability.effect.optional, false);
  assert.equal(ability.effect.stage, "mandatory-additional");
  assert.equal(ability.effect.id, "legion-quartermaster.additional-cost");
});

test("sfd-044-221 Legion Quartermaster: the friendly gear is a cost choice, never a target (355.10.c)", () => {
  assert.equal(ability.effect.payments.length, 1);
  const [payment] = ability.effect.payments;
  // 414.1: the destination is the OWNER's hand, which is what return-to-hand means.
  assert.equal(payment.kind, "return-to-hand");
  assert.deepEqual(payment.amount, { kind: "constant", value: 1 });
  assert.equal(payment.choice.id, "legion-quartermaster.friendly-gear");
  assert.deepEqual(payment.choice.filter, { type: "gear", zone: "board", controller: "controller" });
  assert.equal(payment.choice.min, 1);
  assert.equal(payment.choice.max, 1);
  assert.equal(payment.choice.selection, "one");
  assert.deepEqual(payment.choice.options, ["dynamic:friendly-gear-on-board"]);
  // A cost object is declared through the cost component, so the ability carries
  // no TargetSpec/PickSpec of its own.
  assert.equal(ability.effect.targets, undefined);
});

test("sfd-044-221 Legion Quartermaster: judgeReason names the measured pipeline gap", () => {
  // Re-probed 2026-10-17 (RIFT-667): the production binder fails closed on the
  // kind, and a real play paid the printed cost with the gear never returned.
  assert.match(program.judgeReason, /cost\.additional/);
  assert.match(program.judgeReason, /return-to-hand/);
  assert.match(program.judgeReason, /RIFT-261/);
});

test.todo(
  "sfd-044-221 Legion Quartermaster: the mandatory additional cost must be collected in Total Cost step 2 " +
    "(CR 356.2 / 356.2.a / 414.1) - needs a CardProgram -> Finalize mandatoryAdditional wiring and a " +
    "return-to-hand cost component (RIFT-261)"
);
test.todo(
  "sfd-044-221 Legion Quartermaster: a play with no friendly gear on the Board must be illegal rather than " +
    "paying the cost partially - needs the same Finalize cost pipeline"
);
