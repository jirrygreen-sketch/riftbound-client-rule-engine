import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/rad/overloaded-traveler.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL = "card.hash-adfd644e08c5d8afc96ca8c90b7a573a5e333bba2b2fb4d364ea5830160dc459";
const [staticAbility] = program.abilities;

// The card declares its static effect only; a card file cannot register it with
// LayerEngine (no merged caller reads a card program). The card's own declared
// effect is therefore fed to the real layer engine directly, exactly as the
// sibling goldens do, to prove the declared shape really computes +1 Might.
function unit(id, values = {}) {
  return {
    ref: { id, zoneEntryId: 1 },
    cardId: "card:" + id,
    name: id,
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: 3,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...values
  };
}

function spec() {
  return {
    id: "overloaded-traveler",
    layer: staticAbility.effect.layer,
    filter: { objectId: "traveler", zone: "board" },
    effect: staticAbility.effect
  };
}

test("rad-072-167 Overloaded Traveler: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "While there's a friendly gear with [Deploy] at my battlefield, I have +1 :rb_might:."
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-072-167 Overloaded Traveler: judgeReason names the conditional Might, the Deploy predicate, and the type mismatch", () => {
  // Rule anchors stay durable as engine dependencies merge.
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-258/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /\[Deploy\]/);
  assert.match(program.judgeReason, /830\.3/);
  assert.match(program.judgeReason, /143\.2/);
  // The catalog types this printing as a Spell with Might 2 while the text is a
  // permanent unit's static ability.
  assert.match(program.judgeReason, /Spell/);
});

test("rad-072-167 Overloaded Traveler: structure — one static conditional +1 Might on the source", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(staticAbility.kind, "static");
  const { effect } = staticAbility;
  assert.equal(effect.kind, "continuous.might");
  assert.equal(effect.mode, "add");
  assert.equal(effect.layer, "arithmetic");
  assert.equal(effect.appliesTo, "self");
  assert.deepEqual(effect.amount, { kind: "constant", value: 1 });
  assert.equal(effect.duration, "while-conditional");
});

test("rad-072-167 Overloaded Traveler: structure — the friendly-[Deploy]-gear-at-my-battlefield condition", () => {
  const { condition } = staticAbility;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });

  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "friendly-gears-with-deploy-at-my-battlefield");
  // "my battlefield" is the source's own location (sameLocationAs: "self");
  // the [Deploy] qualifier stays in the subject because no merged filter path
  // evaluates a keyword qualifier (judgeReason), and no key is added that
  // nothing would read.
  assert.deepEqual(condition.left.filter, {
    type: "gear",
    controller: "you",
    sameLocationAs: "self"
  });
  assert.equal(Object.hasOwn(condition.left.filter, "keyword"), false);
  assert.equal(Object.hasOwn(condition.left.filter, "keywords"), false);
});

test("rad-072-167 Overloaded Traveler: the declared +1 Might really computes in the merged arithmetic layer", () => {
  // 143.2.a / 479.4 / 479.4.e.1: the card's own continuous.might shape really
  // raises the source unit's Might by 1 through the merged layer engine.
  const traveler = unit("traveler");
  const engine = createLayerEngine([traveler], [
    { effect: spec(), duration: { type: "permanent" } }
  ]);
  assert.equal(engine.evaluate(traveler.ref).might, 4);

  // The +1 is applied before decreases (479.4.e.1): with a -2 Might effect also
  // registered on the same object the total is 2, not 3 or 5.
  const withReduction = createLayerEngine([traveler], [
    { effect: spec(), duration: { type: "permanent" } },
    {
      effect: {
        id: "shrink",
        layer: "arithmetic",
        filter: { objectId: "traveler" },
        effect: { kind: "decrease", amount: { kind: "constant", value: 2 } }
      },
      duration: { type: "permanent" }
    }
  ]);
  assert.equal(withReduction.evaluate(traveler.ref).might, 2);

  // The modification is a Might change, never a Buff counter (702).
  assert.equal(engine.evaluate(traveler.ref).buffs, 0);
});

test("rad-072-167 Overloaded Traveler: the card never approximates the conditional aura with a buff or a fixed value", () => {
  // Data-level guard that stays true regardless of which engine dependencies
  // have merged: the +1 Might is an arithmetic-layer modification conditioned on
  // the ability's while-clause, and it is not written as a counter or as a
  // permanent unconditional bonus.
  const effect = staticAbility.effect;
  assert.equal(effect.kind, "continuous.might");
  assert.equal(effect.layer, "arithmetic");
  assert.deepEqual(effect.amount, { kind: "constant", value: 1 });
  assert.equal(effect.appliesTo, "self");
  assert.equal(effect.duration, "while-conditional");
  assert.equal(staticAbility.condition.kind, "compare");
  assert.equal(/effect\.buff|effect\.counter/.test(effect.kind), false);
});

test.todo(
  "rad-072-167 Overloaded Traveler: register the card's static ability as a ContinuousEffectSpec so the " +
    "while-conditional +1 Might reaches production — no merged caller turns a CardProgram static ability " +
    "into a layer registration (registerContinuousEffect / LayerEngine.addContinuous have no caller; RIFT-91 follow-up)"
);
test.todo(
  "rad-072-167 Overloaded Traveler: filtering on the [Deploy] keyword needs a keyword predicate in the query " +
    "path (830.3 makes Deploy a checkable characteristic); layers/filter.ts can only test keywords through " +
    "characteristics field equality or the continuous-effect has-keyword condition"
);
test.todo(
  "rad-072-167 Overloaded Traveler: the catalog types this printing as Spell with Might 2 while its text " +
    "is a permanent unit's static ability ('I have +1 Might', 'my battlefield'; CR 1.5 143.2/107.2, and " +
    "157/351.2 for spells). Card-data issue report, not a card-program change."
);
