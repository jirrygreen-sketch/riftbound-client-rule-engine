// RIFT-643: static|| execution evidence is consolidated in ../templates/static-643.test.mjs.
// This file retains the card's identity, status, sourceText, and key IR guards.

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
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-044-221 Legion Quartermaster: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /mandatoryAdditional/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /translateCost/);
  assert.match(program.judgeReason, /return-to-hand/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-044-221 Legion Quartermaster: a mandatory additional cost from a passive ability (356.2.b.1)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);
  assert.equal(ability.effect.kind, "cost.additional");
  assert.equal(ability.effect.id, "legion-quartermaster.additional-cost");
  assert.equal(ability.effect.appliesTo, "self");
  // 356.2.b.1: the printed line has no "may", so it is not an Optional Additional Cost.
  assert.equal(ability.effect.optional, false);
  assert.equal(ability.effect.stage, "mandatory-additional");
});

test("sfd-044-221 Legion Quartermaster: the friendly gear is a cost choice, never a target (355.10.c)", () => {
  assert.equal(ability.effect.payments.length, 1);
  const [payment] = ability.effect.payments;
  // 414.1: the destination is the OWNER's hand, which is what return-to-hand means.
  assert.equal(payment.kind, "return-to-hand");
  assert.deepEqual(payment.amount, { kind: "constant", value: 1 });
  // 355.10.c / CR's own example: "as an additional cost to play me, kill a friendly
  // unit" does not target anything — a cost object is chosen, not targeted.
  assert.equal(payment.choice.id, "legion-quartermaster.friendly-gear");
  assert.deepEqual(payment.choice.filter, { type: "gear", zone: "board", controller: "controller" });
  assert.equal(payment.choice.min, 1);
  assert.equal(payment.choice.max, 1);
  assert.equal(payment.choice.selection, "one");
  // The cost lives on the static ability, so no TargetSpec/PickSpec is declared on
  // an instruction — the card must not turn a cost into a target declaration.
  assert.equal(ability.effect.payments.length, 1);
});

test.todo(
  "sfd-044-221 Legion Quartermaster: the mandatory additional cost must be collected in Total Cost step 2 " +
    "(356.2/356.2.a) — the cost plan only consumes caller-supplied mandatoryAdditional and has no " +
    "CardProgram wiring (RIFT-257's translateCost turns non-printed CostSpec fields into judge-required), " +
    "and no nonstandard cost component performs return-to-hand (414.1) — RIFT-261"
);

test.todo(
  "sfd-044-221 Legion Quartermaster: a play with no friendly gear on the Board must be illegal rather than " +
    "paying the cost partially (417.3-style completeness for a mandatory component) — needs the same " +
    "Finalize cost pipeline as above (RIFT-261)"
);
