// RIFT-667 single-card golden: validation, identity, the key IR structure of Void
// Gate, and the merged primitive half of the printed effect. The whole-card
// execution evidence (its own scenario with a real Deal action through the generic
// card harness plus the measured outcome of binding its own static ability with the
// production binder) lives in `test/cards/templates/static-667.test.mjs`.
//
// The card stays judge-required: programs/statics.ts refuses the
// appliesTo:"deal-actions" anchor, and no consumer sums the granted Bonus Damage
// into the bonus expression of effect.damage. Nothing here approximates it.
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/void-gate.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-914c78ed19d1829c8172e4fcce5b399b51f05e15d1a02fb7eaaaf64e7132bc08";
const SOURCE_TEXT =
  "Spells and abilities affecting units here each deal 1 Bonus Damage. " +
  "(Each instance of damage the spell deals is increased by 1.)";
const [ability] = program.abilities;

test("ogn-296-298 Void Gate: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CANONICAL), program);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogn-296-298 Void Gate: one static Bonus Damage grant scoped to units here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);
  // 418.4 / 713-715: the grant is a property of a Deal action, not damage and
  // not a Might modification.
  assert.equal(ability.effect.kind, "continuous.bonus-damage");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
  assert.equal(ability.effect.appliesTo, "deal-actions");
  assert.equal(ability.effect.layer, "ability");
  // 053.3: "here" is this Battlefield.
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self"
  });
  assert.notEqual(ability.effect.kind, "continuous.might");
});

test("ogn-296-298 Void Gate component: the merged Deal primitive really adds the declared bonus and honours prevention", () => {
  // 714 / 715.2: the granted bonus is summed into the Deal action and added per
  // target. The card's own amount is fed through the real primitive here; what is
  // missing is the producer that would derive it from the static grant.
  const kernel = world()
    .unit("victim-a", { owner: "B", might: 5 })
    .unit("victim-b", { owner: "B", might: 5 })
    .build();
  const run = runInstruction(damage, {
    amount: { kind: "constant", value: 2 },
    target: "units",
    bonus: ability.effect.amount
  }, { world: kernel, targets: { units: [kernel.ref("victim-a"), kernel.ref("victim-b")] } });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 6);
  assert.deepEqual(run.linked.dealtTo, [
    { target: kernel.ref("victim-a"), amount: 3 },
    { target: kernel.ref("victim-b"), amount: 3 }
  ]);
  // 715.4: a prevented Deal action deals nothing, so the bonus never applies.
  const prevented = world().unit("victim", { owner: "B", might: 5 }).build();
  prevented.addReplacement(action => action.type === "damage" ? "prevented" : null);
  const blocked = runInstruction(damage, {
    amount: { kind: "constant", value: 2 },
    target: "units",
    bonus: ability.effect.amount
  }, { world: prevented, targets: { units: [prevented.ref("victim")] } });
  assert.equal(blocked.result.status, "negated");
  assert.equal(prevented.getObject("victim").damage, 0);
  assert.deepEqual(blocked.linked, {});
});

test("ogn-296-298 Void Gate: judgeReason names the measured Deal-action gap", () => {
  // Re-probed 2026-10-17 (RIFT-667): the production binder fails closed on the
  // anchor, so no registration exists and a real Deal action stays at its
  // printed amount.
  assert.match(program.judgeReason, /deal-actions/);
  assert.match(program.judgeReason, /continuous\.bonus-damage/);
  assert.match(program.judgeReason, /LocationRef/);
});

test.todo(
  "ogn-296-298 Void Gate: every Deal action affecting units here must get 1 Bonus Damage " +
    "(CR 418.4 / 713-715.4.a) - needs the appliesTo:deal-actions action binding and a consumer that sums the " +
    "granted bonus into effect.damage's bonus expression"
);
