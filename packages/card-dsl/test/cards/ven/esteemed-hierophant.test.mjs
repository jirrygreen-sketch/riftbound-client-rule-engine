import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/esteemed-hierophant.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-f580f1b022b337a29509e9df000540117dd9fd09ef728fb8fc82f34c6bfe8807";
const SOURCE_TEXT =
  "While you control 7 or more runes, prevent all damage that enemy spells and abilities would deal to me.";

const [ability] = program.abilities;
const [prevent] = ability.with;

/**
 * The prevention planner/source classification and source-relative condition
 * binding remain blocked; the absolute-player count itself executes below.
 */
const predicate = {
  id: "esteemed-hierophant.rune-condition",
  op: "condition.predicate",
  args: { condition: { kind: "constant", value: ability.condition } }
};

/**
 * The reference kernel compares filter fields literally, so the symbolic
 * "self" controller selector is bound to the acting player for the execution
 * check (the same convention as ven/protective-sands and ven/renekton).
 */
function substituteController(value, playerId) {
  if (Array.isArray(value)) return value.map((item) => substituteController(item, playerId));
  if (value === null || typeof value !== "object") return value === "self" ? playerId : value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substituteController(item, playerId)])
  );
}

const predicateFor = (playerId) => ({
  ...predicate,
  args: { condition: { kind: "constant", value: substituteController(ability.condition, playerId) } }
});

/** 133.5.a.1 / 431.1: a channeled rune sits in the controller's Rune Zone. */
function runeZoneWorld(runesTotal, channeled = runesTotal) {
  const ids = Array.from({ length: runesTotal }, (_, index) => `r${index + 1}`);
  const kernel = world().unit("hierophant", { controller: "A", might: 5 }).rune(ids).build();
  if (channeled > 0) {
    assert.equal(kernel.perform({ type: "channel-rune", player: "A", amount: channeled }).status, "done");
  }
  return kernel.clone({ controller: "A", sourceSnapshot: kernel.getObject("hierophant") });
}

test("ven-025-166 Esteemed Hierophant: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-025-166 Esteemed Hierophant: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /replacement\.prevent/);
  assert.match(program.judgeReason, /438\.7/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /spell and ability damage|spells and abilities/);
});

test("ven-025-166 Esteemed Hierophant: one prevention replacement scoped to enemy spells and abilities", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "replacement");
  // 438.7: Prevent is a Delayed Replacement Effect, so the card declares the
  // intercepted damage event rather than a resolving instruction.
  assert.equal(ability.replaces.event, "damage");
  assert.equal(ability.replaces.filter.target, "self");
  // 438.1.b / 418.6.b: the source classification has no discriminator in the
  // frozen damage GameAction; the intended scope is recorded declaratively.
  assert.deepEqual(ability.replaces.filter.sourceKind, ["spell", "ability"]);
  assert.equal(ability.replaces.filter.controller, "opponent");

  assert.equal(prevent.id, "esteemed-hierophant.prevent-all-damage");
  assert.equal(prevent.op, "replacement.prevent");
  assert.deepEqual(prevent.args.amount, { kind: "constant", value: "all" });
});

test("ven-025-166 Esteemed Hierophant: the rune clause is the ability's condition", () => {
  // 438.3.c keeps the Prevent Value "All"; 363.2.a / 383.2.b make the constant
  // condition part of the continuous effect's scope.
  const condition = ability.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 7 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "runes-you-control");
  assert.deepEqual(condition.left.filter, {
    type: "rune",
    zone: "rune-zone",
    controller: "self"
  });
});

test("ven-025-166 golden: the 7-or-more-runes condition really evaluates", () => {
  const seven = runeZoneWorld(7);
  const accepted = runAbilityBody([predicateFor("A")], seven);
  assert.equal(accepted.status, "executed");
  assert.equal(accepted.linkedValues["esteemed-hierophant.rune-condition.value"], true);

  const six = runeZoneWorld(7, 6);
  const rejected = runAbilityBody([predicateFor("A")], six);
  assert.equal(rejected.status, "executed");
  assert.equal(rejected.linkedValues["esteemed-hierophant.rune-condition.value"], false);
});

test("ven-025-166 golden: an opponent's runes do not satisfy the controller condition", () => {
  const kernel = runeZoneWorld(0);
  assert.equal(kernel.perform({ type: "channel-rune", player: "B", amount: 7 }).status, "done");
  const outcome = runAbilityBody([predicateFor("A")], kernel);
  assert.equal(outcome.linkedValues["esteemed-hierophant.rune-condition.value"], false);
});

test.todo(
  "ven-025-166 Esteemed Hierophant: 'prevent all damage' (438.1/438.2/438.3.c/438.7) needs a " +
    "replacement.prevent body planner that rewrites a matched damage event to zero; replacement lifecycle " +
    "registration is already available"
);

test.todo(
  "ven-025-166 Esteemed Hierophant: 'enemy spells and abilities' needs a damage-source " +
    "classification — the frozen damage GameAction carries only { source, target, amount, combat }"
);


test.todo(
  "ven-025-166 Esteemed Hierophant: replacement rune-count condition needs source-relative " +
    "controller:self binding (RIFT-359; 133.5.a.1/431.1)"
);
