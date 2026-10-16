import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/renekton-rage-fueled.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-4ea204b4fa413be39f3508c65d93d8ef270e1bb64d97edf9a216efa7d50394f4";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)\n" +
  "When I attack, if you control 4 or fewer runes, deal 2 to all enemy units here.";

const [accelerate, attackTrigger] = program.abilities;
const [dealTwo] = attackTrigger.body;

/**
 * The reference kernel compares filter fields literally, so the symbolic
 * "self" controller selector of the trigger condition is bound to the acting
 * player for the execution check (the same convention as ven/protective-sands).
 */
function substituteController(value, playerId) {
  if (Array.isArray(value)) return value.map((item) => substituteController(item, playerId));
  if (value === null || typeof value !== "object") return value === "self" ? playerId : value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substituteController(item, playerId)])
  );
}

/** 133.5.a.1 / 431.1: a channeled rune sits in the controller's Rune Zone. */
function runeWorld(runesTotal) {
  const ids = Array.from({ length: runesTotal }, (_, index) => `r${index + 1}`);
  const kernel = world().rune(ids).build();
  if (runesTotal > 0) {
    assert.equal(kernel.perform({ type: "channel-rune", player: "A", amount: runesTotal }).status, "done");
  }
  return kernel;
}

const predicateBody = (condition) => [
  {
    id: "renekton.rune-gate",
    op: "condition.predicate",
    args: { condition: { kind: "constant", value: condition } }
  }
];

test("ven-019-166 Renekton, Rage Fueled: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-019-166 Renekton: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /effect\.damage/);
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("ven-019-166 Renekton: unvalued [Accelerate] with the merged 805 expansion", () => {
  assert.equal(program.abilities.length, 2);
  // 805.1.b: the cost is fixed [1] + one domain-matched Power, so the keyword
  // carries no value; 805.4 keeps multiple instances redundant.
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
  assert.equal(accelerate.value, undefined);
  const definition = keywordDefinitionsById.get("Accelerate");
  assert.ok(definition, "the Accelerate KeywordDef is merged");
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "single");
});

test("ven-019-166 Renekton: attack trigger with the 4-or-fewer-runes trigger condition", () => {
  assert.equal(attackTrigger.kind, "triggered");
  assert.equal(attackTrigger.optional, false);
  // 383.4.e: "When I attack" is an Attack Trigger on the closed attack-declared
  // timing point; 383.4.e.2.a checks the condition once per combat.
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(attackTrigger.trigger.once, "per-combat");
  // 383.2.a.1: the following clause is part of the Trigger Condition itself.
  const condition = attackTrigger.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "lte");
  assert.deepEqual(condition.right, { kind: "constant", value: 4 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "runes-you-control");
  assert.deepEqual(condition.left.filter, {
    type: "rune",
    zone: "rune-zone",
    controller: "self"
  });
});

test("ven-019-166 Renekton: body is one non-target set damage of exactly 2", () => {
  assert.deepEqual(attackTrigger.body.map((instruction) => instruction.id), [
    "renekton.deal-2-to-enemy-units-here"
  ]);
  assert.equal(dealTwo.op, "effect.damage");
  assert.deepEqual(dealTwo.args.amount, { kind: "constant", value: 2 });
  // 355.10.d: "all enemy units here" is a characteristic-selected set, never a
  // target — no TargetSpec may stand in for it, because that would fire
  // "become a target" for every unit (355.7/754).
  assert.equal(dealTwo.targets, undefined);
  assert.equal(dealTwo.picks, undefined);
  assert.equal(dealTwo.linkedTo, undefined);
  assert.deepEqual(dealTwo.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: {
        type: "unit",
        zone: "board",
        controller: "opponent",
        sameLocationAs: "self"
      }
    }
  });
});

test("ven-019-166 Renekton golden: the 4-or-fewer-runes trigger condition really evaluates", () => {
  const condition = substituteController(attackTrigger.trigger.condition, "A");

  // Exactly 4 runes: "4 or fewer runes" holds.
  const four = runeWorld(4);
  const accepted = runAbilityBody(predicateBody(condition), four);
  assert.equal(accepted.status, "executed");
  assert.deepEqual(accepted.results[0].result.linkedValues, { value: true });

  // Five runes: the trigger condition is not fulfilled, so the ability would
  // not even be put on the chain.
  const five = runeWorld(5);
  const rejected = runAbilityBody(predicateBody(condition), five);
  assert.equal(rejected.status, "executed");
  assert.deepEqual(rejected.results[0].result.linkedValues, { value: false });
});

test.todo(
  "ven-019-166 Renekton: deal 2 to every enemy unit here (418.1.b/418.1.d with the 355.10.d " +
    "non-target set) needs the merged effect.damage to accept a query/set selector instead of only " +
    "ctx.targets(specId) — the same RIFT-9 target.query gap as og/firestorm"
);

test.todo(
  "ven-019-166 Renekton: the attack-declared timing point needs its combat emitter and the " +
    "CardProgram trigger registration (RIFT-120 plus the engine batch 4–5 combat transaction)"
);

test.todo(
  "ven-019-166 Renekton: [Accelerate]'s cost/entry rewrite (805.1.b.1 Fury money, 805.6 ready " +
    "entry) needs a card-program → cost-plan/entry-replacement wiring (RIFT-89)"
);
