import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/vex-cheerless.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";
import { DUEL_DOMAINS } from "../../../../engine-core/dist/cost/resources.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-f53634b94e6fae93d877ca3bb7f92c97c1f881953a9d82fc5a297b398f35d3ad";
const SOURCE_TEXT =
  "While I'm in combat, friendly spells cost :rb_energy_1::rb_rune_rainbow: less to a minimum of :rb_energy_1:, " +
  "and enemy spells cost :rb_energy_1::rb_rune_rainbow: more.";

const [friendlyEnergy, friendlyPower, enemyEnergy, enemyPower] = program.abilities;

const inCombat = {
  kind: "compare",
  left: { kind: "count", subject: "self-in-combat", filter: { object: "self" } },
  operator: "gte", right: { kind: "constant", value: 1 }
};

test("Vex, Cheerless: validates identity, registration, original text and current blockers", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(program.status, "judge-required");
  for (const gap of [/continuous\.cost-modification/, /Finalize/, /356\.4\.e/, /740\.2\.c/, /RIFT-359/]) {
    assert.match(program.judgeReason, gap);
  }
});

test("Vex, Cheerless: [1][A] modifies both resources with the Energy-only minimum", () => {
  assert.equal(program.abilities.length, 4);
  for (const [ability, stage, resource, controller] of [
    [friendlyEnergy, "discount", "energy", "caster"],
    [friendlyPower, "discount", "power", "caster"],
    [enemyEnergy, "increase", "energy", "caster-opponent"],
    [enemyPower, "increase", "power", "caster-opponent"]
  ]) {
    assert.equal(ability.kind, "static");
    assert.equal(ability.effect.kind, "continuous.cost-modification");
    assert.equal(ability.effect.stage, stage);
    assert.equal(ability.effect.resource, resource);
    assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
    assert.deepEqual(ability.effect.appliesTo, { type: "spell", controller });
    assert.deepEqual(ability.condition, inCombat);
  }
  assert.deepEqual(friendlyEnergy.effect.minimum, { kind: "constant", value: 1 });
  assert.equal(friendlyPower.effect.universal, true);
  assert.equal(enemyPower.effect.universal, true);
});

// Exercise the supported modifier subpath. This does not install Vex's static
// ability or claim the combat condition and Finalize projection are implemented.
function modify(energy, power, abilities) {
  const base = world().hand("spell", { types: ["spell"], energy, power: [] }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("spell") });
  const run = runInstruction(costModify, {
    id: "vex-spell-cost",
    printed: { id: "spell", cardType: "Spell", energy, power, domains: [] },
    modifiers: abilities.map(({ effect }, index) => ({
      id: `vex-${index}`, kind: effect.stage === "discount" ? "reduce" : "increase",
      resource: effect.resource, amount: effect.amount,
      ...(effect.minimum ? { minimum: effect.minimum } : {})
    }))
  }, { world: kernel });
  assert.equal(run.result.status, "executed");
  return run.linked.cost;
}

test("Vex supported modifier subpath: friendly [1][A] discount reduces both Energy and Power", () => {
  const plan = modify(2, 2, [friendlyEnergy, friendlyPower]);
  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: DUEL_DOMAINS }]);
  assert.equal(plan.discounts.length, 2);
});

test("Vex supported modifier subpath: Energy minimum and Power zero floor apply independently", () => {
  const plan = modify(1, 1, [friendlyEnergy, friendlyPower]);
  assert.equal(plan.total.energy, 1);
  assert.deepEqual(plan.total.power, []);
  assert.equal(plan.discounts[0].minimum, 1);
});

test("Vex supported modifier subpath: enemy [1][A] increase adds both Energy and any-domain Power", () => {
  const plan = modify(1, 0, [enemyEnergy, enemyPower]);
  assert.equal(plan.total.energy, 2);
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: DUEL_DOMAINS }]);
});

test.todo("Vex: bind static spell modifiers to Finalize with friendly/enemy relations and the ongoing-combat predicate (740.2.c, RIFT-359)");
