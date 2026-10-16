import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/card-sharp.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-94f6785f45c0764b0cc33e8a81071bd4f8cfdc8c7bc304c63df0687a8e936307";
const EACH_ID = "card-sharp.each-player-may-play-gold";
const BONUS_ID = "card-sharp.play-gold-per-opponent";

const [ability] = program.abilities;
const [eachPlayer, bonusTokens] = ability.body;

test("sfd-081-221 Card Sharp: program validates, is registered and stays judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When you play me, you and each opponent may play a Gold gear token exhausted. " +
      "For each opponent who did, you play a Gold gear token exhausted."
  );
});

test("sfd-081-221 Card Sharp: judgeReason names the multi-player choice, result and Gold gaps", () => {
  assert.match(program.judgeReason, /355\.10\.e/);
  assert.match(program.judgeReason, /355\.18/);
  assert.match(program.judgeReason, /party-favors/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /RIFT-9/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-081-221 Card Sharp: one mandatory card-played self trigger", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
});

test("sfd-081-221 Card Sharp: the two clauses keep their printed order and a linked result key", () => {
  assert.deepEqual(ability.body.map((instruction) => [instruction.id, instruction.op]), [
    [EACH_ID, "choice.each-player"],
    [BONUS_ID, "effect.token"]
  ]);

  // 355.10.e / 355.18: the decision belongs to several players at resolution
  // time; the frozen single-chooser choose node cannot express it (see
  // judgeReason), so the shape is recorded as a per-player choice op.
  assert.deepEqual(eachPlayer.args.choosers, {
    kind: "constant",
    value: "controller-and-each-opponent"
  });
  assert.deepEqual(eachPlayer.args.optional, { kind: "constant", value: true });
  assert.deepEqual(eachPlayer.args.token, { kind: "constant", value: "gold" });
  // 440.2.c / 185.2.a: played tokens are created on the Chain; 184.1/185.2.d:
  // "exhausted" is the entry stipulation.
  assert.deepEqual(eachPlayer.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(eachPlayer.args.entersExhausted, { kind: "constant", value: true });
  assert.deepEqual(eachPlayer.args.resultKey, {
    kind: "constant",
    value: "opponentsWhoPlayed"
  });
});

test("sfd-081-221 Card Sharp: 'For each opponent who did' reads the first clause's per-seat result", () => {
  // The count is not a printed constant: it is the number of opponents who chose
  // to play, so the second clause reads the first clause's linked result.
  assert.equal(bonusTokens.linkedTo, EACH_ID);
  assert.equal(bonusTokens.op, "effect.token");
  assert.deepEqual(bonusTokens.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(bonusTokens.args.amount, {
    kind: "linked",
    instructionId: EACH_ID,
    key: "opponentsWhoPlayed"
  });
  assert.deepEqual(bonusTokens.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(bonusTokens.args.entersExhausted, { kind: "constant", value: true });
  // "you play": the ability's controller (190.6.d).
  assert.deepEqual(bonusTokens.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
});

test.todo(
  "sfd-081-221 Card Sharp: each player (you and every opponent) makes an independent optional 'play a " +
    "Gold gear token exhausted' decision at resolution (CR 355.10.e/355.18) — the frozen choose node has a " +
    "single chooser, no other-seat enumeration and no per-seat repetition (RIFT-9 target.player)"
);
test.todo(
  "sfd-081-221 Card Sharp: 'For each opponent who did' needs the per-seat outcome of the first clause " +
    "(CR 359.3.e.14 result family; RIFT-90 selection/result binding)"
);
test.todo(
  "sfd-081-221 Card Sharp: play a Gold gear token exhausted — CR 187.5 definition plus 440.2.c/185.2.a chain " +
    "creation and the 184.1/185.2.d exhausted entry stipulation (token primitive task)"
);
