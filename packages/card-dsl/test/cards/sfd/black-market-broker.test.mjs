import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/black-market-broker.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-d7a7aec53d72022d855ed2a7d4b387ece5fe5cdc5097de61bdb909825242b5dd";
const SOURCE_TEXT = "When you play a card from face down, play a Gold gear token exhausted.";

const [ability] = program.abilities;
const [instruction] = ability.body;

test("sfd-121-221 Black Market Broker: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-121-221 Black Market Broker: judgeReason names the facedown-source and Gold-token gaps", () => {
  assert.match(program.judgeReason, /Facedown Zone/);
  assert.match(program.judgeReason, /355\.9\.a\.3/);
  assert.match(program.judgeReason, /107\.3/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /440\.2\.c/);
  assert.match(program.judgeReason, /184\.1/);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /RIFT-84/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("sfd-121-221 Black Market Broker: the trigger is card-played, scoped to you and to a facedown source", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 359 / 383.4.a / 407: the card-played timing point; "you" is the ability's
  // controller (190.6.d). "from face down" has no merged payload field, so the
  // program declares details.fromFaceDown and fails closed instead of matching
  // every card played.
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    player: "self",
    details: { fromFaceDown: true }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);
});

test("sfd-121-221 Black Market Broker: the body declares one Gold token played exhausted", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "black-market-broker.play-gold-token");
  assert.equal(instruction.op, "effect.token");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: a *played* token is created on the Chain first.
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  // 184.1 / 185.2.d entry stipulation, never a later exhaust (143.4).
  assert.deepEqual(instruction.args.entersExhausted, { kind: "constant", value: true });
  assert.deepEqual(instruction.args.linkKey, { kind: "constant", value: "goldToken" });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
  assert.equal(instruction.condition, undefined);
});

test.todo(
  "sfd-121-221 Black Market Broker: the card-played event carries the pre-play zone so a " +
    "Facedown Zone source can be detected (355.9.a.3 / 107.3.a / 107.3.e / 422.2.a) — RIFT-84 hidden/facedown " +
    "support plus RIFT-91 trigger-filter consumption"
);

test.todo(
  "sfd-121-221 Black Market Broker: play the Gold gear token through chain creation plus the hand-off " +
    "play (440.2.c / 185.2.a / 350.2 / 354) with the CR 187.5 Gold definition and its exhausted entry " +
    "(184.1 / 185.2.d) — RIFT-62 token work / RIFT-82 definition batch"
);
