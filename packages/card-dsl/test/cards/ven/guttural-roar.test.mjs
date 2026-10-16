import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/guttural-roar.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-1ced4268c533ffec88b27ec278a78271dee36cc714cbc77853dc64a26a1cda7b";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Give a unit +2 :rb_might: this turn. If it's [Empowered], give it +4 :rb_might: this turn instead.";

const [action, play] = program.abilities;
const [plusTwo, plusFour] = play.body;
const EMPOWERED = { kind: "expression", value: { kind: "constant", value: "is-empowered" } };

test("ven-072-166 Guttural Roar: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("ven-072-166 Guttural Roar: judgeReason names the temporary-Might gap and the Empowered-predicate gap", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /Empowered/);
  assert.match(program.judgeReason, /conditionMatches/);
  assert.match(program.judgeReason, /135\.2\.b\.5\.b/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-072-166 Guttural Roar: printed energy 2, absent power, [Action] keyword", () => {
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 }
  });
  // power: null in the catalog means no printed power; the field is absent.
  assert.equal(Object.hasOwn(play.cost, "power"), false);
});

test("ven-072-166 Guttural Roar: the two Might values are mutually exclusive, not stacked", () => {
  // 135.2.b.5.b: the conditional clause belongs to the instruction it follows,
  // and "instead" rewrites the amount — so exactly one of +2 / +4 applies.
  assert.deepEqual(play.body.map(instruction => instruction.id), [
    "guttural-roar.give-plus-2",
    "guttural-roar.give-plus-4-instead"
  ]);

  assert.equal(plusTwo.op, "continuous.might");
  assert.deepEqual(plusTwo.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(plusTwo.args.duration, { kind: "constant", value: "this-turn" });
  // The +2 branch runs only when the target is NOT Empowered.
  assert.deepEqual(plusTwo.condition, { kind: "not", condition: EMPOWERED });
  assert.equal(plusTwo.linkedTo, undefined);

  assert.equal(plusFour.op, "continuous.might");
  assert.deepEqual(plusFour.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(plusFour.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(plusFour.condition, EMPOWERED);
  // "it" is the unit the previous instruction already locked; the branch depends
  // on it, so a mistargeted first instruction also ignores this one
  // (359.3.e.14.a). No second TargetSpec is declared: the branch must not offer
  // a fresh choice of unit.
  assert.equal(plusFour.linkedTo, "guttural-roar.give-plus-2");
  assert.equal(plusFour.targets, undefined);
  assert.deepEqual(plusFour.args.target, { kind: "constant", value: "guttural-roar.unit" });
});

test("ven-072-166 Guttural Roar: 'a unit' is a target, and the printing adds no restriction", () => {
  assert.equal(plusTwo.targets.length, 1);
  const [target] = plusTwo.targets;
  assert.equal(target.id, "guttural-roar.unit");
  assert.deepEqual(target.filter, { type: "unit", zone: "board" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  // No friendly/enemy restriction and no minimum is invented: the printed text
  // says only "a unit" and has no "to a minimum of" clause (143.2.c is general).
  assert.equal(Object.hasOwn(plusTwo.args, "minimum"), false);
  assert.equal(Object.hasOwn(plusFour.args, "minimum"), false);
});

test("ven-072-166 Guttural Roar: the Empowered predicate stays descriptive and is never an always-true condition", () => {
  // No merged Condition evaluates "is Empowered" (828.2), and the layers engine
  // treats unknown conditions as true — so writing anything else here would
  // silently apply both +2 and +4. The named predicate plus not/instead pairing
  // is the reviewed shape.
  assert.equal(plusTwo.condition.kind, "not");
  assert.equal(plusFour.condition.kind, "expression");
  assert.equal(plusFour.condition.value.value, "is-empowered");
  assert.notEqual(plusFour.condition.kind, "always");
  assert.notEqual(plusTwo.condition.kind, "always");
});

test.todo(
  "ven-072-166 Guttural Roar: 'Give a unit +2/+4 :rb_might: this turn' needs the continuous.might layers " +
    "consumer with an end-of-turn duration (317.2.c) — RIFT-91"
);

test.todo(
  "ven-072-166 Guttural Roar: \"If it's [Empowered]\" needs an Empowered state predicate (CR 828.2) in " +
    "Condition / layers/engine.ts conditionMatches; unknown conditions currently evaluate to true, so the " +
    "two branches cannot be told apart yet — RIFT-91"
);
