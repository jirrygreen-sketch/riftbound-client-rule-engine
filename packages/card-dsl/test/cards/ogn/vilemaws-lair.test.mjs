import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/vilemaws-lair.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-3e2d969f2528a782a98c698fc45d9937d376dd06244c444271adf9cbd4100e77";
const SOURCE_TEXT = "Units can't move from here to base.";

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

test("Vilemaw's Lair program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  // 054.1 ("Can't beats Can") is the operative rule; the reason must also name
  // the missing consumer, not just "not implemented".
  assert.match(program.judgeReason, /054/);
  assert.match(program.judgeReason, /358\.3\.a/);
  assert.match(program.judgeReason, /zones\/movement/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("Vilemaw's Lair structure: one passive movement restriction on units here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 144.4.b defines the Battlefield→Base Standard Move this restriction removes;
  // 421.1/449 describe Move itself.
  assert.equal(ability.effect.kind, "continuous.movement");
  assert.equal(ability.effect.restriction, "move-from-here-to-base");
  // 054.1: a prohibition only removes the option; it grants nothing.
  assert.equal(ability.effect.addsPermission, false);
  assert.equal(ability.effect.permission, undefined);
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self"
  });
});

test("Vilemaw's Lair golden: the merged layer engine records the declared restriction", () => {
  const unitHere = unit("unit-here");
  const engine = createLayerEngine([unitHere], [
    {
      effect: {
        id: "vilemaws-lair",
        layer: "ability",
        filter: ability.effect.filter,
        effect: ability.effect
      },
      duration: { type: "permanent" },
      timestamp: 1
    }
  ]);
  engine.setObjects([unitHere]);

  const snapshot = engine.evaluate(unitHere.ref);
  // The restriction is recorded on the layered object...
  assert.deepEqual(snapshot.movement.restrictions, ["move-from-here-to-base"]);
  // ...and, being a prohibition, it does not flip the baseline permission flags
  // or create a Ganking-style permission.
  assert.equal(snapshot.movement.allowed, true);
  assert.equal(snapshot.movement.canMove, true);
  assert.equal(snapshot.movement.canGank, false);
  assert.equal(snapshot.keywords.length, 0);
});

test("Vilemaw's Lair gap: a Battlefield→Base move still resolves while the restriction is recorded", () => {
  // 358.3.a / 359.3.e.14.b require the move to be negated at resolution while
  // later instructions still execute. The restriction is recorded by the layer
  // engine (test above) but nothing consumes it, so the merged move primitive
  // still relocates the unit. This is the concrete blocking gap.
  const kernel = world()
    .unit("unit-here", { location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const unitHere = unit("unit-here");
  const engine = createLayerEngine([unitHere], [
    {
      effect: {
        id: "vilemaws-lair",
        layer: "ability",
        filter: ability.effect.filter,
        effect: ability.effect
      },
      duration: { type: "permanent" },
      timestamp: 1
    }
  ]);
  engine.setObjects([unitHere]);
  assert.deepEqual(engine.evaluate(unitHere.ref).movement.restrictions, ["move-from-here-to-base"]);

  const unitRef = kernel.ref("unit-here");
  const run = runInstruction(move, {
    objects: { kind: "constant", value: { target: "unit-here" } },
    to: { kind: "constant", value: "controller-base" }
  }, { world: kernel, targets: { "unit-here": [unitRef] } });

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("unit-here").location, { type: "base", player: "A" });
  assert.deepEqual(kernel.events.map(event => event.action), ["move-location"]);
});

test.todo(
  "Vilemaw's Lair enforcement: the Standard Move (144.4.b, zones/movement.ts) and move effects " +
    "(421.2.a) must read the layered movement restriction and negate the Battlefield→Base move " +
    "at resolution while later instructions still execute (358.3.a, 359.3.e.14.b) — no consumer " +
    "of MovementPermissions exists (RIFT-75 zones batch + RIFT-91 layers)"
);

test.todo(
  "Vilemaw's Lair scope + registration: the 053.3 'here' referent needs the sameLocationAs " +
    "anchor in the layers matcher, and a merged producer must register this CardProgram's " +
    "static ability as a ContinuousEffectSpec (RIFT-91)"
);
