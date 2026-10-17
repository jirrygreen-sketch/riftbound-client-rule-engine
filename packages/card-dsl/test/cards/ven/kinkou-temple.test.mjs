import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/kinkou-temple.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import tank from "../../../../engine-core/dist/effects/keywords/Tank.js";

const CANONICAL =
  "card.hash-0148fea511f023ebe4f6e9b7dd701d1290558c9cbf8bcd877bccd4cda78e5875";
const SOURCE_TEXT = "Units here with [Tank] have +1 :rb_might:.";

const [ability] = program.abilities;
const { effect } = ability;

function unit(id, overrides = {}) {
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
    location: { type: "battlefield", id: "kinkou" },
    might: 2,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false,
    ...overrides
  };
}

/** The ContinuousEffectSpec the card declares: layer + filter + arithmetic effect. */
function spec() {
  return {
    id: "kinkou-temple",
    layer: effect.layer,
    filter: effect.filter,
    effect
  };
}

/**
 * Register the card's declared ContinuousEffectSpec in the merged LayerEngine.
 * The declared filter is used verbatim, so an object passed here is matched by
 * the declared filter exactly as the merged matcher sees it.
 */
function layeredEngine(objects) {
  return createLayerEngine(objects, [
    { effect: spec(), duration: { type: "permanent" } }
  ]);
}

test("ven-159-166 Kinkou Temple: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-159-166 Kinkou Temple: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /keywords/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.doesNotMatch(program.judgeReason, /没有.*static.*注册|registerContinuousEffect 没有调用方|RIFT-91/);
  // The golden must prove the new program reaches the shared generated index,
  // not just the file system (scripts/gen-registries.mjs builds it from src/cards/**).
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("ven-159-166 Kinkou Temple: one static arithmetic +1 Might over units here with [Tank]", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 479.4 / 479.4.e.1 / 479.4.f: "+1" is an arithmetic-layer increase.
  assert.equal(effect.kind, "continuous.might");
  assert.equal(effect.mode, "add");
  assert.equal(effect.layer, "arithmetic");
  assert.deepEqual(effect.amount, { kind: "constant", value: 1 });

  // 479.3.b "have" + 815.3 Tank characteristic + 053.3 "here".
  assert.deepEqual(effect.filter, {
    type: "unit",
    zone: "board",
    keywords: ["Tank"],
    sameLocationAs: "self"
  });
  // 702's Buff counter is a different game object and is never used as the +1.
  assert.equal(effect.buffs, undefined);
  assert.equal(ability.effect.condition, undefined);
});

test("ven-159-166 Kinkou Temple golden: the merged arithmetic layer really adds +1 Might to a Tank unit", () => {
  // The merged LayerEngine evaluates the declared continuous.might effect in the
  // arithmetic sublayer (479.4): a Tank unit at the Battlefield goes 2 -> 3
  // Might through the real layer path. This proves the arithmetic and the
  // declared shape only; production static binding still needs the keyword
  // predicate to honor the gate.
  const tankUnit = unit("tank-unit", { keywords: [{ id: "Tank" }], might: 2 });
  const engine = layeredEngine([tankUnit]);

  assert.equal(engine.evaluate(tankUnit.ref).might, 3);
  // The printed characteristic is untouched (the layer only supplies the
  // effective value, 479.4).
  assert.equal(engine.evaluate(tankUnit.ref).printed.might, 2);
  // No Buff counter was placed by the +1 (702/702.3 is a different mechanic).
  assert.equal(engine.evaluate(tankUnit.ref).buffs, 0);
});

test("ven-159-166 Kinkou Temple golden: an enemy Tank unit here gets the bonus too (the card does not say 'friendly')", () => {
  const enemyTank = unit("enemy-tank", {
    keywords: [{ id: "Tank" }],
    owner: "B",
    controller: "B",
    might: 4
  });
  const engine = layeredEngine([enemyTank]);
  assert.equal(engine.evaluate(enemyTank.ref).might, 5);
});

test("ven-159-166 Kinkou Temple golden: the Tank KeywordDef that makes the gate readable is merged", () => {
  // 815.1 / 815.1.b / 815.3: Tank is a registered passive keyword, and its
  // expansion documents that the assignment requirement itself is still
  // pending. The card only reads the characteristic; it does not restate it.
  assert.equal(tank.keyword, "Tank");
  assert.equal(tank.stacking, "single");
  assert.ok(tank.ruleRefs.includes("815.1.b"));
  assert.ok(tank.ruleRefs.includes("815.3"));
});

test.todo(
  "ven-159-166 Kinkou Temple: give the merged filter a keyword predicate so 'with [Tank]' (815.3) selects only Tank " +
    "units; layers/filter.ts matches objectId/cardId/type/zone/location/controller/owner/state/tags/characteristics " +
    "but never compares ObjectSnapshot.keywords, so the declared gate is not evaluable yet"
);

test.todo(
  "ven-159-166 Kinkou Temple: verify the RIFT-257 static binder's sameLocationAs/self anchor against a production " +
    "CardProgram lifecycle once the keyword predicate is available"
);
