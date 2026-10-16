import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/zilean-time-mage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-0edf62a2fa247fc8feb7ea57978657018d5be55376452b2c4173a7170526aa61";
const SOURCE_TEXT =
  "Once each turn, if you would play a token unit while I'm at a battlefield, you may play that token " +
  "and an additional copy of it instead.";

const [replacement] = program.abilities;
const [rewrite] = replacement.with;

test("unl-086-219 Zilean, Time Mage: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-086-219 Zilean, Time Mage: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /once each turn|Once each turn|386\.1/);
  assert.match(program.judgeReason, /ObjectSelector|事件对象/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-086-219 Zilean, Time Mage: one replacement ability on the play of a token unit", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(replacement.kind, "replacement");
  // CR 369.1 / 370.1: a would-instead clause replaces the event itself. CR 375
  // gives the same shape for token plays.
  assert.equal(replacement.replaces.event, "play");
  assert.deepEqual(replacement.replaces.filter, {
    type: "unit",
    token: true,
    controller: "self"
  });
  // "while I'm at a battlefield": the source's location is the applicability
  // condition (464.2.b); the replacement pipeline does not evaluate a position
  // condition today (see judgeReason).
  assert.deepEqual(replacement.condition, {
    kind: "expression",
    value: { kind: "constant", value: "source-at-a-battlefield" }
  });
});

test("unl-086-219 Zilean, Time Mage: the rewrite keeps 'that token + an additional copy' as the exact shape", () => {
  assert.equal(replacement.with.length, 1);
  assert.equal(rewrite.id, "zilean-time-mage.play-token-and-additional-copy");
  // The rewrite must play the replaced event's token and an additional copy of
  // it; no merged opcode can turn one play into two, so the shape is kept for
  // review instead of being approximated with effect.copy (whose play mode is
  // explicitly blocked).
  assert.equal(rewrite.op, "replacement.play-with-additional-copy");
  assert.deepEqual(rewrite.args.original, {
    kind: "constant",
    value: { triggerEvent: "play", role: "original-token" }
  });
  assert.deepEqual(rewrite.args.additional, {
    kind: "constant",
    value: { triggerEvent: "play", role: "additional-copy", copyOf: "original-token" }
  });
  assert.equal(rewrite.targets, undefined);
  assert.equal(rewrite.linkedTo, undefined);
});

test.todo(
  "unl-086-219 Zilean, Time Mage: execute the two-play rewrite through the merged copy/play primitives once the " +
    "replacement pipeline can produce the second play (CR 370.1 / 375; RIFT-120) — no execution scenario is claimed here"
);

test.todo(
  "unl-086-219 Zilean, Time Mage: apply the replacement from the event pipeline and produce the second play " +
    "(CR 369.1 / 370.1 / 375) — needs the replaced-event object selector and a play rewrite; RIFT-120"
);
test.todo(
  "unl-086-219 Zilean, Time Mage: 'Once each turn' as a replacement frequency (CR 383.3.e / 386.1) — no merged " +
    "ReplacementAbility frequency field (contract change request)"
);
test.todo(
  "unl-086-219 Zilean, Time Mage: 'while I'm at a battlefield' evaluated when the replacement would apply " +
    "(CR 464.2.b) — the replacement pipeline does not consume the position condition (RIFT-91 / RIFT-120)"
);
