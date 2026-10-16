import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/dazzling-aurora.js";

test("ogn-160-298 Dazzling Aurora: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-160-298 Dazzling Aurora: identity, version and verbatim source text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-ec34157eb04ae011d9a79dacfd64f6303e1d79eb376db6975abef7998e893318"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "At the end of your turn, reveal cards from the top of your Main Deck until you reveal a unit. Play it, ignoring its cost, and recycle the rest."
  );
  assert.match(program.judgeReason, /RIFT-89/);
  assert.match(program.judgeReason, /RIFT-66/);
});

test("ogn-160-298 Dazzling Aurora: turn-end trigger with reveal/play/recycle body shape", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "turn-end");
  assert.equal(ability.trigger.filter.event, "turn-end");
  assert.equal(ability.trigger.filter.player, "self");
  assert.equal(ability.optional, false);

  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "dazzling-aurora.reveal-until-unit",
    "dazzling-aurora.play-unit",
    "dazzling-aurora.recycle-rest"
  ]);
  const [reveal, play, recycle] = ability.body;
  assert.equal(reveal.op, "effect.reveal-until");
  assert.equal(reveal.linkedTo, undefined);
  assert.deepEqual(reveal.args.from, { kind: "constant", value: "deck-top" });
  assert.deepEqual(reveal.args.until, { kind: "constant", value: { type: "unit" } });

  assert.equal(play.op, "effect.play");
  assert.equal(play.linkedTo, "dazzling-aurora.reveal-until-unit");
  assert.equal(play.args.object.instructionId, "dazzling-aurora.reveal-until-unit");
  assert.equal(play.args.object.key, "revealedUnit");
  assert.deepEqual(play.args.ignoreCost, { kind: "constant", value: "printed" });

  assert.equal(recycle.op, "effect.recycle");
  assert.equal(recycle.linkedTo, "dazzling-aurora.reveal-until-unit");
  assert.equal(recycle.args.objects.instructionId, "dazzling-aurora.reveal-until-unit");
  assert.equal(recycle.args.objects.key, "revealedRest");
});

test.todo(
  "Dazzling Aurora: ordered reveal-until-unit over the Main Deck top (zoneSlice / RIFT-66 reveal-until)"
);
test.todo(
  "Dazzling Aurora: play the revealed unit ignoring its printed cost via a zeroed finalized cost plan (cost.modify / RIFT-89)"
);
test.todo(
  "Dazzling Aurora: recycle the non-unit cards revealed before the unit (linked result of reveal-until, RIFT-66)"
);
