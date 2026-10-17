import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/khazix-mutating-horror.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/engine.js";

const CARD_ID =
  "card.hash-6080c717cf342299d6073468f9de4f808e7a244d4edd6bbe1ec9d6a519127a24";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "When I attack or defend, if an enemy unit is alone here, give me +2 :rb_might: this turn and gain 2 XP.";

const [ambush, attackTrigger, defendTrigger] = program.abilities;
const [attackGrant, attackGainXp] = attackTrigger.body;
const [defendGrant, defendGainXp] = defendTrigger.body;

const ALONE_ENEMY_HERE_COUNT = {
  kind: "count",
  subject: "alone-enemy-units-here",
  filter: { type: "unit", controller: "opponent", sameLocationAs: "source" }
};

test("unl-143-219 Kha'Zix, Mutating Horror: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-143-219 Kha'Zix, Mutating Horror: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /Ambush/);
});

test("unl-143-219 Kha'Zix, Mutating Horror: unvalued Ambush plus attack and defend triggers", () => {
  assert.equal(program.abilities.length, 3);
  // 822.1.b / 822.2: Ambush is passive and redundant when repeated, so no value is printed.
  assert.deepEqual(ambush, { kind: "keyword", keyword: "ambush" });

  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(defendTrigger.trigger.at, "defense-declared");
  assert.deepEqual(defendTrigger.trigger.filter, {
    event: "defense-declared",
    filter: { source: "self" }
  });
  assert.equal(attackTrigger.optional, false);
  assert.equal(defendTrigger.optional, false);
});

test("unl-143-219 Kha'Zix, Mutating Horror: 'if an enemy unit is alone here' is the Trigger Condition (383.2.a.1)", () => {
  // 740.2.a defines "alone" as no other friendly unit at the same location; "here" is the source's
  // location (359.3.f), so exactly one enemy unit at that location fulfils the clause.
  assert.deepEqual(attackTrigger.trigger.condition, {
    kind: "compare",
    left: ALONE_ENEMY_HERE_COUNT,
    operator: "eq",
    right: { kind: "constant", value: 1 }
  });
  assert.deepEqual(defendTrigger.trigger.condition, attackTrigger.trigger.condition);
});

test("unl-143-219 Kha'Zix, Mutating Horror: +2 Might this turn plus gain 2 XP as two independent steps", () => {
  for (const [grant, gain, prefix] of [
    [attackGrant, attackGainXp, "khazix-mutating-horror.grant-might"],
    [defendGrant, defendGainXp, "khazix-mutating-horror.defend-grant-might"]
  ]) {
    assert.equal(grant.id, prefix);
    assert.equal(grant.op, "continuous.might");
    assert.deepEqual(grant.args.amount, { kind: "constant", value: 2 });
    assert.deepEqual(grant.args.duration, { kind: "constant", value: "this-turn" });
    // "me" is the ability host (355.10.d): the appliesTo self selector, never a fabricated target.
    assert.deepEqual(grant.args.appliesTo, { kind: "constant", value: "self" });
    assert.equal(grant.targets, undefined);

    // 359.3.e.14.c: "and gain 2 XP" is its own instruction and does not link to the Might half.
    assert.equal(gain.op, "effect.xp");
    assert.deepEqual(gain.args, { amount: { kind: "constant", value: 2 } });
    assert.equal(gain.linkedTo, undefined);
  }
});

test("unl-143-219 Kha'Zix, Mutating Horror golden: the gain 2 XP half really grants 2 XP", () => {
  const kernel = world().build();
  const outcome = resolveChainBody([attackGainXp], kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["khazix-mutating-horror.gain-xp", "executed"]
  ]);
  assert.equal(kernel.player("A").xp, 2);
  assert.equal(kernel.player("B").xp, 0);
  assert.equal(outcome.linkedValues["khazix-mutating-horror.gain-xp.gainedTo"], "A");
  assert.deepEqual(outcome.events.map(event => event.action), ["gain-xp"]);
});

test("unl-143-219 Kha'Zix, Mutating Horror golden: +2 Might registers for this turn and expires", () => {
  const base = world()
    .unit("khazix", { owner: "A", controller: "A", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("khazix"), controller: "A" });
  const outcome = resolveChainBody([attackGrant], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["khazix-mutating-horror.grant-might", "executed"]
  ]);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 2);
  assert.equal(registration.effect.filter.objectId, "khazix");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.equal(layers.evaluate(kernel.ref("khazix")).might, 6);
  assert.equal(layers.expireAt("turn-end").length, 1);
  assert.equal(layers.evaluate(kernel.ref("khazix")).might, 4);
});

test.todo(
  "unl-143-219 Kha'Zix, Mutating Horror: fire the attack-declared / defense-declared triggers from the real " +
    "combat workflow (CR 383.4.e / 383.4.f) so the supported Might and XP body enters the chain"
);
test.todo(
  "unl-143-219 Kha'Zix, Mutating Horror: [Ambush] (CR 822.1.b/822.1.c) is consumed by the play flow for its " +
    "valid battlefield locations and Reaction permission"
);
