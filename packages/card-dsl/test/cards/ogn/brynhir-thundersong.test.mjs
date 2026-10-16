import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/brynhir-thundersong.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-c3d99cfdb7043f9a6d4f6898cda1e76169b34bfb8ba341d7b4189ff2c78fc63d";
const [triggered] = program.abilities;

test("brynhir-thundersong: passes validateCardProgram and is indexed by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardProgramsById.get(CARD_ID), program);
});

test("brynhir-thundersong: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /canAct|打出许可/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, "When you play me, opponents can't play cards this turn.");
});

test("brynhir-thundersong: 'When you play me' is a mandatory card-played trigger filtered to the source (420.4.a)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "controller" }
  });
  assert.equal(triggered.trigger.condition, undefined);
  assert.equal(triggered.optional, false);
});

test("brynhir-thundersong: the body declares a turn-long play prohibition for opponents", () => {
  assert.equal(triggered.body.length, 1);
  const [instruction] = triggered.body;
  assert.equal(instruction.id, "brynhir-thundersong.forbid-play");
  assert.equal(instruction.op, "continuous.restrict");
  assert.deepEqual(instruction.args, {
    operation: { kind: "constant", value: "play" },
    forbidden: { kind: "constant", value: true },
    player: { kind: "constant", value: "opponent" },
    duration: { kind: "constant", value: "end-of-turn" }
  });
  // The card only declares the restriction; it never advances priority, and the
  // prohibition applies to the opponents, not to the controller.
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.condition, undefined);
});

test.todo(
  "brynhir-thundersong: the continuous.restrict primitive (RIFT-9, depends on condition.predicate) is required before " +
    "the declared prohibition can execute"
);
test.todo(
  "brynhir-thundersong: chain canAct(player, speed) and Finalize must consult the lasting restriction so opponents cannot play cards (400/402-407)"
);
test.todo(
  "brynhir-thundersong: the 'this turn' expiry needs the continuous.duration / timing-point expiry wiring (RIFT-91, CR 317/318)"
);
