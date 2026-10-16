import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/yeti-brawler.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL_ID =
  "card.hash-372a2d2a0b9116fc9b30d8a6f4899848963d12a45cf804935f7f8f9d355c80be";
const SOURCE_TEXT =
  "When I conquer, if you assigned 3 or more excess damage, play two Gold gear tokens exhausted. " +
  '(They have "[Reaction][>] Kill this, :rb_exhaust:: [Add] :rb_rune_rainbow:.")';

const [ability] = program.abilities;
const [playGold] = ability.body;

test("unl-018-219 Yeti Brawler: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-018-219 Yeti Brawler: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /excess damage/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /184\.1/);
  assert.match(program.judgeReason, /RIFT-62/);
});

test("unl-018-219 Yeti Brawler: 'When I conquer' trigger with the excess-damage clause as trigger condition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.c / 383.4.c.1: "When I conquer" is a Conquer Effect; "self" is the
  // conquering unit's controller.
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, { event: "conquer", player: "self" });
  // 383.2.a.1: the "if you assigned 3 or more excess damage" clause follows the
  // trigger condition directly and belongs to it; the count shape names the
  // damage-assignment ledger that has no merged evaluation (judgeReason).
  assert.equal(ability.trigger.condition.kind, "compare");
  assert.equal(ability.trigger.condition.operator, "gte");
  assert.deepEqual(ability.trigger.condition.right, { kind: "constant", value: 3 });
  assert.equal(ability.trigger.condition.left.kind, "count");
  assert.equal(ability.trigger.condition.left.subject, "excess-damage-assigned-this-combat");
  assert.equal(ability.optional, false);
});

test("unl-018-219 Yeti Brawler: two Gold gear tokens are created on the Chain and played", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), ["yeti-brawler.play-gold"]);
  assert.equal(playGold.op, "effect.token");
  // 187.5: the printed "Gold gear token" is a defined token, so the definition id
  // is the printed name rather than invented statistics.
  assert.deepEqual(playGold.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(playGold.args.amount, { kind: "constant", value: 2 });
  // 350.2 / 440.2.c / 185.2.a: a played token is created on the Chain first;
  // creating it on the Board then playing would add a wrong Board entry.
  assert.deepEqual(playGold.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playGold.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.deepEqual(playGold.args.linkKey, { kind: "constant", value: "goldTokens" });
  // The "exhausted" entry override (143.4 / 184.1 / 185.2.d) has no IR argument;
  // it is recorded in judgeReason and never faked by create-then-exhaust.
  assert.deepEqual(Object.keys(playGold.args).sort(), [
    "amount", "linkKey", "location", "mode", "token"
  ]);
  assert.equal(playGold.targets, undefined);
  assert.equal(playGold.linkedTo, undefined);
});

test("unl-018-219 Yeti Brawler: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test.todo(
  "unl-018-219 Yeti Brawler: expose the conquer payload's assigned excess damage (CR 467.2.c.1–c.4: assigning vs dealing) " +
    "— the scoring payload has no such field and ResolveContext has no damage-assignment ledger (engine batch 4/5)"
);

test.todo(
  "unl-018-219 Yeti Brawler: Gold gear token definition with its printed ability (CR 187.5) — effect.token's frozen table has no gold entry"
);

test.todo(
  "unl-018-219 Yeti Brawler: chain-create then cost-waived play of the token (CR 440.2.c / 185.2.a / 350.2 / 354) — RIFT-62"
);

test.todo(
  "unl-018-219 Yeti Brawler: exhausted entry override on the created token (CR 143.4 / 184.1 / 185.2.d)"
);
