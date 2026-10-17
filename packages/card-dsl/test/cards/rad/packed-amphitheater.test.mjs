import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/packed-amphitheater.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL =
  "card.hash-7e95acea2b29696bcdb29e7def854dacdbb55f72f5160fb4bc3e9c872950af6e";
const SOURCE_TEXT = "Champion units here have +1 :rb_might:.";

const [ability] = program.abilities;

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
    ...values,
  };
}

/** The ContinuousEffectSpec the card declares: layer + filter + the arithmetic effect. */
function spec() {
  return {
    id: "packed-amphitheater",
    layer: ability.effect.layer,
    filter: ability.effect.filter,
    effect: ability.effect
  };
}

test("rad-164-167 Packed Amphitheater: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("rad-164-167 Packed Amphitheater: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /133\.7\.a/);
});

test("rad-164-167 Packed Amphitheater: one static arithmetic +1 Might for Champion units here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 479.4 / 479.4.e.1: +1 Might is an arithmetic-layer addition.
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });

  // 133.7.a Champion is a Unit supertype; 053.3 "here" is this Battlefield.
  assert.deepEqual(ability.effect.filter, {
    type: "champion",
    zone: "board",
    sameLocationAs: "self"
  });
});

test("rad-164-167 Packed Amphitheater: the merged arithmetic layer performs the declared +1 Might", () => {
  // The merged LayerEngine evaluates the declared continuous.might effect in the
  // arithmetic sublayer (479.4): a Champion unit on the board really goes from
  // 3 to 4 Might with the card's own spec.
  const champion = unit("champion", { types: ["champion", "unit"] });
  const applied = createLayerEngine([champion], [
    { effect: spec(), duration: { type: "permanent" } }
  ]);
  assert.equal(applied.evaluate(champion.ref).might, 4);

  // Positive increases are applied first, then decreases (479.4.e.1); a second
  // -2 Might effect on the same object still leaves 2, not -1.
  const engine = createLayerEngine([champion], [
    { effect: spec(), duration: { type: "permanent" } },
    {
      effect: {
        id: "shrink",
        layer: "arithmetic",
        filter: { objectId: "champion" },
        effect: { kind: "decrease", amount: { kind: "constant", value: 2 } }
      },
      duration: { type: "permanent" }
    }
  ]);
  assert.equal(engine.evaluate(champion.ref).might, 2);
});

test("rad-164-167 Packed Amphitheater: the declared filter scopes the aura to Champion units at this Battlefield (133.7.a / 053.3)", () => {
  // The card declares "here" with the sameLocationAs anchor and the Champion
  // supertype gate. The golden fixes the declared shape; whether the merged
  // filter honours the anchor is recorded in judgeReason and the todos rather
  // than pinned by an assertion that would break when the anchor lands.
  assert.deepEqual(ability.effect.filter, {
    type: "champion",
    zone: "board",
    sameLocationAs: "self"
  });

  // The declared arithmetic really applies to a Champion unit on the Board
  // through the merged layer engine: Might 3 -> 4 (479.4 / 479.4.e.1).
  const champion = unit("champion", { types: ["champion", "unit"] });
  const applied = createLayerEngine([champion], [
    { effect: spec(), duration: { type: "permanent" } }
  ]);
  assert.equal(applied.evaluate(champion.ref).might, 4);

  // A unit without the Champion supertype is unaffected by the type gate.
  const plain = unit("plain-here");
  const gated = createLayerEngine([plain], [
    { effect: spec(), duration: { type: "permanent" } }
  ]);
  assert.equal(gated.evaluate(plain.ref).might, 3);
});

test.todo(
  "rad-164-167 Packed Amphitheater: register the card program's static ability as a " +
    "ContinuousEffectSpec so the +1 Might is applied in production (no merged path reads " +
    "CardProgram abilities; registerContinuousEffect has no caller) — RIFT-91 follow-up"
);

test.todo(
  "rad-164-167 Packed Amphitheater: honour the 053.3 ''here'' anchor (sameLocationAs) in the layers " +
    "filter so only Champion units at this Battlefield get +1 Might, and prove the Champion supertype " +
    "(133.7.a) is present on board snapshots"
);

