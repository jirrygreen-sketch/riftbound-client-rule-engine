import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/black-market-broker.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /OBJECT_FILTER_ZONES/);
  assert.match(program.judgeReason, /exhausted/);
  assert.doesNotMatch(program.judgeReason, /token-play-requires-chain-creation/);
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
  "Facedown Zone source can be detected (355.9.a.3 / 107.3.a / 107.3.e / 422.2.a) — the hidden/facedown " +
    "zone vocabulary and source-zone payload are still needed"
);

test.todo(
  "sfd-121-221 Black Market Broker: the supported token-play path still needs the CR 187.5 Gold " +
    "definition and an exhausted-entry stipulation (184.1 / 185.2.d) for this card"
);

test("sfd-121-221 Black Market Broker: mode play performs chain creation and hand-off for a defined token", () => {
  const kernel = world().build();
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "mech" },
      amount: { kind: "constant", value: 1 },
      mode: { kind: "constant", value: "play" },
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: { kind: "constant", value: "token" }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.action), ["create-token", "play"]);
  assert.equal(run.linked.token.createdAmount, 1);
  assert.equal(run.linked.token.amount, 1);
  assert.equal(kernel.getObject(run.linked.token.objects[0].id).zone, "board");
});
