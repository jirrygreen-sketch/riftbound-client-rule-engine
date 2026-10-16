import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "@riftbound/card-dsl";
import weaponmaster from "../../../src/effects/keywords/Weaponmaster.ts";
import { runAbilityBody } from "../../../dist/effects/interpreter.js";
import { instructionDefinitionsById } from "../../../dist/effects/instructions/registry.generated.js";
import { world } from "../../../dist/effects/testing/index.js";

const host = { canonicalCardId: "sfd-092-221" };
const program = abilities => ({
  canonicalCardId: host.canonicalCardId,
  rulesetVersion: EFFECT_IR_V2_RULESET,
  status: "judge-required",
  judgeReason: "Weaponmaster Equip-cost calculation/payment requires unmerged cost.modify / cost.pay primitives.",
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
  assert.equal(ability.body.length, 1);
  assert.equal(choice.op, "sequence");
  assert.deepEqual(choice.targets, [{
    id: "weaponmaster-equipment",
    filter: { type: "gear", controller: "self", tags: ["Equipment"] },
    min: 0,
    max: 1,
    selection: "up-to"
  }]);
  assert.deepEqual(choice.condition, {
    kind: "compare",
    left: { kind: "count", subject: "objects", filter: { object: { target: "weaponmaster-equipment" } } },
    operator: "gt",
    right: { kind: "constant", value: 0 }
  });
  assert.equal(choice.args.choice, undefined);
  assert.equal(choice.args.body.kind, "constant");
});

test("Weaponmaster reduces and pays Equip cost before attachment", () => {
  const [ability] = weaponmaster.expand({ host });
  const body = ability.body[0].args.body.value;
  assert.deepEqual(body.map(instruction => instruction.op), [
    "cost.modify",
    "cost.pay",
    "effect.attach"
  ]);
  assert.deepEqual(body[1].args.cost, {
    kind: "linked-value",
    instructionId: "weaponmaster-cost",
    key: "cost"
  });
  assert.deepEqual(body[0].args.modifier, {
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
  const [cost, pay, attach] = ability.body[0].args.body.value;
  assert.equal(cost.linkedTo, undefined);
  assert.equal(pay.linkedTo, "weaponmaster-cost");
  assert.equal(attach.linkedTo, "weaponmaster-pay");
  assert.deepEqual(attach.args.host, {
    kind: "constant",
    value: { kind: "source" }
  });
  assert.deepEqual(attach.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "weaponmaster-equipment" }
  });
  assert.deepEqual(cost.args.source, attach.args.objects);
});

test("Weaponmaster selecting no Equipment skips cost and attachment without a boolean prompt", () => {
  const kernel = world().object("gear", { types: ["gear"], tags: ["Equipment"], zone: "board" }).build();
  kernel.setTargets("weaponmaster-equipment", []);
  const [ability] = weaponmaster.expand({ host });
  const outcome = runAbilityBody(ability.body, kernel);
  assert.deepEqual(outcome.results.map(result => result.id), ["weaponmaster-choice"]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(kernel.events, []);
});

// TestWorld does not bind symbolic controller filters. Do not simulate a
// selected Equipment or its cost; the real targeting/cost integration is pending.
test("Weaponmaster primitives are registered and the catalog program stays judge-required", () => {
  const abilities = weaponmaster.expand({ host });
  const card = program(abilities);
  assert.equal(card.status, "judge-required");
  assert.match(card.judgeReason, /unmerged cost.modify \/ cost.pay/);
  assert.equal(instructionDefinitionsById.has("cost.modify"), true);
  assert.equal(instructionDefinitionsById.has("cost.pay"), true);
});

test("Weaponmaster ignores an accidental numeric value because it is unvalued", () => {
  assert.deepEqual(
    weaponmaster.expand({ host, value: 0 }),
    weaponmaster.expand({ host, value: Number.MAX_SAFE_INTEGER })
  );
});
