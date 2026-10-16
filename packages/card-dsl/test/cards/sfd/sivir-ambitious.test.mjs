import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sivir-ambitious.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";

const CANONICAL = "card.hash-4a74e3934f4bc0ee5d6d8c70c0b3f9df97cdfcc7c158bf1473bb64daa8aade48";
const SOURCE_TEXT =
  "[Deflect 2] (Opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose me with a spell or Ability.)\n" +
  "When I conquer after an attack, if you assigned 5 or more excess damage to enemy units, you may deal that much to an enemy unit.";

const [keyword, conquerTrigger] = program.abilities;
const [mayDeal] = conquerTrigger.body;
const [readExcess, dealDamage] = mayDeal.args.body.value;

test("sfd-120-221 Sivir, Ambitious: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-120-221 Sivir, Ambitious: judgeReason names the excess-damage, conquer-emission and tax gaps", () => {
  assert.match(program.judgeReason, /467\.2\.c\.4/);
  assert.match(program.judgeReason, /HistoryQuery/);
  assert.match(program.judgeReason, /payloadFields/);
  assert.match(program.judgeReason, /conquer/);
  assert.match(program.judgeReason, /383\.4\.c\.2\.a/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /RIFT-31\/RIFT-33/);
});

test("sfd-120-221 Sivir, Ambitious: [Deflect 2] is declared with its printed value, not expanded", () => {
  // 809.1.b.2: Deflect 2 makes opponents pay :rb_rune_rainbow::rb_rune_rainbow:
  // to choose this unit; 809.2 makes multiple instances sum.
  assert.deepEqual(keyword, { kind: "keyword", keyword: "deflect", value: 2 });
  assert.equal(deflect.keyword, "Deflect");
  assert.equal(deflect.valued, true);
  assert.equal(deflect.stacking, "sum");
  assert.ok(deflect.ruleRefs.includes("809.1.b.1"));
});

test("sfd-120-221 Sivir, Ambitious: 'when I conquer after an attack' carries the excess-damage condition on the trigger", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(conquerTrigger.kind, "triggered");
  // 383.4.c / 383.4.c.2.a: a Conquer Effect on the conquer timing point, put on
  // the Chain after the Conquer action when this unit took part in it.
  assert.equal(conquerTrigger.trigger.at, "conquer");
  assert.deepEqual(conquerTrigger.trigger.filter, { event: "conquer", filter: { source: "self" } });

  // 383.2.a.1: the "if you assigned …" clause immediately follows the trigger
  // condition, so it belongs to the TriggerSpec and is checked before the Chain;
  // 467.2.c.4 defines excess damage as the assignment above lethal.
  const condition = conquerTrigger.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "excess-damage-assigned-this-combat");
  assert.deepEqual(condition.left.filter, { targetController: "opponent", scope: "this-attack" });
  assert.deepEqual(condition.right, { kind: "constant", value: 5 });

  assert.equal(conquerTrigger.optional, false);
});

test("sfd-120-221 Sivir, Ambitious: the may-shape reads the assigned total, then deals exactly that much", () => {
  assert.deepEqual(conquerTrigger.body.map((instruction) => instruction.id), ["sivir-ambitious.may-deal"]);
  assert.equal(mayDeal.op, "choice.optional");
  assert.equal(mayDeal.args.body.kind, "constant");
  assert.deepEqual(mayDeal.args.body.value.map((instruction) => instruction.id), [
    "sivir-ambitious.read-excess-damage",
    "sivir-ambitious.deal-that-much"
  ]);

  // "that much" is a dynamic amount, never a fixed 5: the program declares the
  // missing read position (a source characteristic) and consumes it through the
  // interpreter's linked-value mechanism. Until the statistic is wired the read
  // throws MissingInformation and both instructions ignore, instead of dealing
  // a wrong amount.
  assert.equal(readExcess.op, "condition.value");
  assert.deepEqual(readExcess.args.value, {
    kind: "object-property",
    object: "source",
    property: "excessDamageAssignedThisCombat"
  });
  assert.deepEqual(readExcess.args.key, { kind: "constant", value: "excessDamage" });
  assert.equal(readExcess.linkedTo, undefined);

  assert.equal(dealDamage.op, "effect.damage");
  assert.deepEqual(dealDamage.args.amount, {
    kind: "linked-value",
    instructionId: "sivir-ambitious.read-excess-damage",
    key: "excessDamage"
  });
  assert.deepEqual(dealDamage.args.target, {
    kind: "constant",
    value: "sivir-ambitious.enemy-unit"
  });
  assert.equal(dealDamage.linkedTo, "sivir-ambitious.read-excess-damage");
  // 418.6.a: no source is named, so the ability source deals the damage; the
  // printed deal is not combat damage (418.6.c), so no combat flag is authored.
  assert.equal(dealDamage.args.source, undefined);
  assert.equal(dealDamage.args.combat, undefined);
  // 740.1.b: "enemy" = controlled by an opponent; 355.9.a.1: Board units.
  assert.deepEqual(dealDamage.targets, [
    {
      id: "sivir-ambitious.enemy-unit",
      filter: { type: "unit", controller: "opponent", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(mayDeal.targets, undefined);
  assert.equal(mayDeal.picks, undefined);
  assert.equal(mayDeal.linkedTo, undefined);
});

test.todo(
  "sfd-120-221 Sivir, Ambitious: the 'assigned 5 or more excess damage to enemy units' trigger condition " +
    "needs the combat-damage assignment statistic (467.2.c.4) — HistoryQuery only returns event counts and the " +
    "conquer payload declares no fields (RIFT-31 / RIFT-33)"
);

test.todo(
  "sfd-120-221 Sivir, Ambitious: the conquer timing point is emitted after the player has performed a " +
    "Conquer (383.4.c.2.a, 471.1, 473.2.a) — turn/flow.ts only commits the score action and no code emits conquer " +
    "(RIFT-31 / RIFT-33)"
);

test.todo(
  "sfd-120-221 Sivir, Ambitious: [Deflect 2]'s expansion (effects/keywords/Deflect.ts target.tax) is consumed by " +
    "the target pipeline so opponents must pay :rb_rune_rainbow::rb_rune_rainbow: to choose Sivir " +
    "(809.1.b.2) — TargetTaxAdapter wiring, RIFT-90"
);

test.todo(
  "sfd-120-221 Sivir, Ambitious: \"that much\" resolves from the wired excess-damage total once the statistic " +
    "exists; the authored read is currently fail-closed (MissingInformation), so no damage is dealt and no fixed " +
    "amount is substituted"
);
