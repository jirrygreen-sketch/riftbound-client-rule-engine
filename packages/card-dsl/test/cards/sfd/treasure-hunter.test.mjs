import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/treasure-hunter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-391b4e14a6ac07093188b967dee259bef4f8692e3d1e87e6bb28cf249f3e788a";
const SOURCE_TEXT = "When I move, play a Gold gear token exhausted.";

const [ability] = program.abilities;
const [instruction] = ability.body;

test("sfd-130-221 Treasure Hunter: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-130-221 Treasure Hunter: judgeReason names the current token gaps", () => {
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /440\.2\.c/);
  assert.match(program.judgeReason, /184\.1/);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /LocationExpr/);
  assert.match(program.judgeReason, /ability-controller-base/);
});

test("sfd-130-221 Treasure Hunter: 'when I move' subscribes to object-moved scoped to this unit", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 421.1 / 449.1-449.2 / 458: "When I move" is any successful Move; the
  // printed text names no destination, so no toZone filter is authored.
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, { event: "object-moved", filter: { source: "self" } });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);
});

test("sfd-130-221 Treasure Hunter: the body declares one Gold token played exhausted", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "treasure-hunter.play-gold-token");
  assert.equal(instruction.op, "effect.token");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: a *played* token is created on the Chain first.
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(instruction.args.location, { kind: "location", value: "ability-controller-base" });
  // 184.1 / 185.2.d entry stipulation, never a later exhaust (143.4).
  assert.deepEqual(instruction.args.entersExhausted, { kind: "constant", value: true });
  assert.deepEqual(instruction.args.linkKey, { kind: "constant", value: "goldToken" });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test.todo(
  "sfd-130-221 Treasure Hunter: play the Gold gear token through chain creation plus the hand-off play " +
    "(440.2.c / 185.2.a / 350.2 / 354) with the CR 187.5 Gold definition and its exhausted entry " +
    "(184.1 / 185.2.d); effect.token also needs to consume the contract LocationExpr " +
    "ability-controller-base as a runtime LocationRef."
);
