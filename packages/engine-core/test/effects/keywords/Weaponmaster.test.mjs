import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";
import weaponmaster from "../../../src/effects/keywords/Weaponmaster.ts";

const host = { canonicalCardId: "sfd-092-221" };
const program = abilities => ({
  canonicalCardId: host.canonicalCardId,
  rulesetVersion: EFFECT_IR_V2_RULESET,
  status: "executable",
  abilities,
  sourceText: "Weaponmaster"
});

test("Weaponmaster metadata identifies an unvalued separately stacking keyword", () => {
  assert.equal(weaponmaster.keyword, "Weaponmaster");
  assert.equal(weaponmaster.valued, false);
  assert.equal(weaponmaster.stacking, "separate");
  assert.ok(weaponmaster.ruleRefs.includes("821.1.c.7"));
});

test("Weaponmaster expands to a mandatory play trigger", () => {
  const [ability] = weaponmaster.expand({ host });
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    source: { canonicalCardId: host.canonicalCardId }
  });
});

test("Weaponmaster exposes an optional controlled Equipment choice", () => {
  const [ability] = weaponmaster.expand({ host });
  const [choice] = ability.body;
  assert.equal(choice.op, "choice.optional");
  assert.deepEqual(choice.args.choice, {
    kind: "constant",
    value: {
      id: "weaponmaster-equipment",
      filter: { type: "gear", controller: "self", tags: ["Equipment"] },
      min: 0,
      max: 1,
      selection: "up-to"
    }
  });
});

test("Weaponmaster reduces and pays Equip cost before attachment", () => {
  const [ability] = weaponmaster.expand({ host });
  assert.deepEqual(ability.body.map(instruction => instruction.op), [
    "choice.optional",
    "cost.modify",
    "cost.pay",
    "effect.attach"
  ]);
  assert.deepEqual(ability.body[2].args.cost, {
    kind: "linked-value",
    instructionId: "weaponmaster-cost",
    key: "cost"
  });
  assert.deepEqual(ability.body[1].args.modifier, {
    kind: "constant",
    value: { kind: "reduce-equip-cost", resource: "power", amount: 1, domain: "any" }
  });
});

test("Weaponmaster expansion validates as an EffectIR CardProgram", () => {
  const result = validateCardProgram(program(weaponmaster.expand({ host })));
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("Weaponmaster links choice, cost, payment, and attachment in order", () => {
  const [ability] = weaponmaster.expand({ host });
  assert.equal(ability.body[1].linkedTo, "weaponmaster-choice");
  assert.equal(ability.body[2].linkedTo, "weaponmaster-cost");
  assert.equal(ability.body[3].linkedTo, "weaponmaster-pay");
  assert.deepEqual(ability.body[3].args.host, {
    kind: "constant",
    value: { kind: "source" }
  });
  assert.deepEqual(ability.body[3].args.objects, {
    kind: "linked-value",
    instructionId: "weaponmaster-choice",
    key: "choice"
  });
});

test("Weaponmaster ignores an accidental numeric value because it is unvalued", () => {
  assert.deepEqual(
    weaponmaster.expand({ host, value: 0 }),
    weaponmaster.expand({ host, value: Number.MAX_SAFE_INTEGER })
  );
});
