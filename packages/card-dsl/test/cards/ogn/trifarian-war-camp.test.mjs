import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/trifarian-war-camp.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL = "card.hash-ca6330500fc019b19ccf0df937fc22945cc8bf28a51c21eaef572c53cc31387f";
const SOURCE_TEXT = "Units here have +1 :rb_might:. (This includes attackers.)";

const [ability] = program.abilities;

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
    location: { type: "battlefield", id: "battlefield-1" },
    might: 2,
    energy: 1,
    power: ["Fury"],
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

/** Register the program's declared static effect in the merged layer engine. */
function layeredEngine(objects) {
  const engine = createLayerEngine(objects, [
    {
      effect: {
        id: "trifarian-war-camp",
        layer: ability.effect.layer,
        filter: ability.effect.filter,
        effect: ability.effect
      },
      duration: { type: "permanent" },
      timestamp: 1
    }
  ]);
  engine.setObjects(objects);
  return engine;
}

test("Trifarian War Camp program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /registerContinuousEffect/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("Trifarian War Camp structure: one arithmetic-layer +1 Might static, scoped to this Battlefield", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 479.3.b: "have" grants the ability; 479.4/479.4.a: +1 Might is the
  // arithmetic layer, applied as an increase (479.4.e.1).
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });

  // 053.3: "here" is this Battlefield. It covers every unit at the location
  // (both controllers) and makes no attacker/defender distinction — the printed
  // reminder "(This includes attackers.)" is exactly why no combat-role or
  // designation condition is written here.
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self"
  });
  assert.equal(ability.effect.filter.controller, undefined);
  assert.equal(ability.effect.condition, undefined);
});

test("Trifarian War Camp golden: the equivalent layer registration adds +1 Might through the arithmetic layer", () => {
  const unitHere = unit("unit-here");
  const enemyHere = unit("enemy-here", { owner: "B", controller: "B", might: 5 });
  const engine = layeredEngine([unitHere, enemyHere]);

  // Both controllers' units get the bonus: the card says "Units here", not
  // "your units here".
  assert.equal(engine.evaluate(unitHere.ref).might, 3);
  assert.equal(engine.evaluate(enemyHere.ref).might, 6);
  // The printed Might characteristics and everything else are untouched.
  assert.equal(engine.evaluate(unitHere.ref).printed.might, 2);
  assert.deepEqual(engine.evaluate(unitHere.ref).types, ["unit"]);
});

test.todo(
  "Trifarian War Camp registration: the card-program lifecycle binder (RIFT-257 programs/statics.ts) " +
    "must turn this static ability into a ContinuousEffectSpec for layers/LayerEngine, and resolve " +
    "190.6's controller of the Battlefield ability"
);

test.todo(
  "Trifarian War Camp scope: the 053.3 'here' referent needs the sameLocationAs anchor in " +
    "layers/filter.ts so the +1 Might applies only at this " +
    "Battlefield; the source leaving use must drop the effect immediately (652.2.c)"
);
