import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/void-gate.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-914c78ed19d1829c8172e4fcce5b399b51f05e15d1a02fb7eaaaf64e7132bc08";
const SOURCE_TEXT =
  "Spells and abilities affecting units here each deal 1 Bonus Damage. " +
  "(Each instance of damage the spell deals is increased by 1.)";

const [ability] = program.abilities;

test("Void Gate program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  // The reason must name the granting path and the exact rules it depends on.
  assert.match(program.judgeReason, /Bonus Damage/);
  assert.match(program.judgeReason, /713/);
  assert.match(program.judgeReason, /715\.4\.a/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("Void Gate structure: one static Bonus Damage grant scoped to units here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 418.4 / 713: the grant is an intrinsic property of a Deal action, not damage
  // and not a Might modification.
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
  // It is not a Might aura and not a buff counter.
  assert.notEqual(ability.effect.kind, "continuous.might");
});

test("Void Gate golden: effect.damage adds the Bonus Damage per target through the merged primitive", () => {
  const kernel = world()
    .unit("victim-a", { owner: "B", might: 5 })
    .unit("victim-b", { owner: "B", might: 5 })
    .build();
  const [first, second] = [kernel.ref("victim-a"), kernel.ref("victim-b")];

  // CR 714/715.2: the granted Bonus Damage is summed and added to each target of
  // the single Deal action (the primitive consumes it through args.bonus).
  const run = runInstruction(damage, {
    amount: { kind: "constant", value: 2 },
    target: "units",
    bonus: ability.effect.amount
  }, { world: kernel, targets: { units: [first, second] } });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.dealt, 6);
  assert.equal(run.linked.dealtCount, 2);
  assert.deepEqual(run.linked.dealtTo, [
    { target: first, amount: 3 },
    { target: second, amount: 3 }
  ]);
  assert.equal(kernel.getObject("victim-a").damage, 3);
  assert.equal(kernel.getObject("victim-b").damage, 3);
});

test("Void Gate golden: a prevented Deal action deals no damage, so the Bonus Damage never applies (CR 715.4)", () => {
  const kernel = world().unit("victim", { owner: "B", might: 5 }).build();
  // 715.4: when no damage is dealt, the granted Bonus Damage does nothing. The
  // replacement below prevents the Deal action entirely.
  kernel.addReplacement(action => action.type === "damage" ? "prevented" : null);

  const run = runInstruction(damage, {
    amount: { kind: "constant", value: 2 },
    target: "units",
    bonus: ability.effect.amount
  }, { world: kernel, targets: { units: [kernel.ref("victim")] } });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(kernel.getObject("victim").damage, 0);
  // Nothing was dealt, so no "dealt" links exist at all.
  assert.deepEqual(run.linked, {});
  assert.deepEqual(run.events.map(event => [event.action, event.outcome]), [["damage", "prevented"]]);
});

test("Void Gate gap: the declared static grant has no consumer and its 'here' scope is unenforceable", () => {
  // The declaration is complete, but:
  //  - no merged producer computes this Battlefield's contribution and feeds it
  //    into a Deal action's bonus argument; and
  //  - the merged matchers implement no sameLocationAs anchor, so the "units
  //    here" scope would over-apply.
  // Both gaps are asserted structurally rather than by faking the grant.
  assert.equal(ability.effect.filter.sameLocationAs, "self");
  assert.equal(ability.effect.appliesTo, "deal-actions");
  assert.equal(ability.effect.amount.value, 1);
});

test.todo(
  "Void Gate grant: a continuous effect must add 1 Bonus Damage to each Deal action whose " +
    "targets are units at this Battlefield (418.4/713, 714 sum-once, 715.2 per target), " +
    "including the prevention example of 715.4.a — the layers/continuous consumer does not " +
    "model Deal-action grants and no producer registers card-program statics (RIFT-91)"
);

test.todo(
  "Void Gate scope: the 053.3 'here' referent needs the sameLocationAs anchor in the engine " +
    "matchers, plus 190.6's controller resolution for the Battlefield ability"
);
