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
  // The merged LayerEngine evaluates the declared continuous.might effect on the
  // object it is registered against (479.4 arithmetic sublayer).
  const champion = unit("champion", { types: ["champion", "unit"] });
  // The declared filter names type "champion", which the merged layer filter
  // matches through object.types (layers/filter.ts typeMatches) when the
  // snapshot carries the supertype; the arithmetic itself is the merged part:
  // registering the same effect without the type gate applies +1 to the unit.
  const typeFree = { ...spec(), id: "packed-amphitheater-type-free", filter: { zone: "board", sameLocationAs: "self" } };
  const applied = createLayerEngine([champion], [
    { effect: typeFree, duration: { type: "permanent" } }
  ]);
  assert.equal(applied.evaluate(champion.ref).might, 4);

  // Positive increases are applied first, then decreases (479.4.e.1); a second
  // -2 Might effect on the same object still leaves 2, not -1.
  const engine = createLayerEngine([champion], [
    { effect: typeFree, duration: { type: "permanent" } },
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

test("rad-164-167 Packed Amphitheater: the merged filter cannot honour the printed ''here'' scope", () => {
  // 053.3 "here": the declared filter carries sameLocationAs "self", which the
  // merged layers filter does not implement. Registering the effect therefore
  // applies it to every Board object matching the other filter fields, so the
  // card must not be marked executable.
  const here = unit("champion-here", { types: ["champion", "unit"] });
  const elsewhere = unit("champion-elsewhere", {
    types: ["champion", "unit"],
    location: { type: "battlefield", id: "bf-2" }
  });
  const engine = createLayerEngine([here, elsewhere], [
    { effect: spec(), duration: { type: "permanent" } }
  ]);

  // The merged filter matches the Champion supertype through object.types but
  // ignores sameLocationAs entirely, so the aura is applied at every
  // Battlefield: the outside unit gets +1 Might even though the card says
  // "here". That over-application is exactly why the card is not executable.
  assert.equal(engine.evaluate(here.ref).might, 4);
  assert.equal(
    engine.evaluate(elsewhere.ref).might,
    4,
    "sameLocationAs is ignored, so the aura leaks to every Battlefield"
  );

  // A unit at this Battlefield that is not a Champion unit is unaffected by
  // the type gate: only the location anchor is missing, not the type predicate.
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

