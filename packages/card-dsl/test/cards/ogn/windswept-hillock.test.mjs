import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/windswept-hillock.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import ganking from "../../../../engine-core/dist/effects/keywords/Ganking.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL = "card.hash-ce3c166d72907a0d5807cb816eb9409a1ebc640347881bf29b083c9f4789e4de";
const SOURCE_TEXT = "Units here have [Ganking]. (They can move from battlefield to battlefield.)";

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

test("Windswept Hillock program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Ganking/);
  assert.match(program.judgeReason, /RIFT-83/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /zones\/movement/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("Windswept Hillock structure: one static Ganking grant scoped to units here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);

  // 479.3.b: "have [Ganking]" is an ability-altering static effect; the keyword
  // id must match the registered KeywordDef exactly.
  assert.equal(ability.effect.kind, "continuous.grant-keyword");
  assert.equal(ability.effect.keyword, "Ganking");
  assert.equal(ability.effect.value, undefined);
  // 053.3: "here" is this Battlefield; the grant is not restricted to the
  // controller's units (the card says "Units here").
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    zone: "board",
    sameLocationAs: "self"
  });
  assert.equal(ability.effect.filter.controller, undefined);
});

test("Windswept Hillock golden: the granted keyword id resolves to the merged Ganking definition", () => {
  const definition = keywordDefinitionsById.get(ability.effect.keyword);
  assert.ok(definition, "the granted KeywordId must be registered");
  assert.equal(definition, ganking);
  assert.equal(definition.valued, false);
  // 810.2: multiple Ganking instances are redundant.
  assert.equal(definition.stacking, "single");

  // 810.1.c: the expansion adds the Battlefield→Battlefield option to the
  // Standard Move without touching the unit's other options.
  const [staticAbility] = definition.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(staticAbility.kind, "static");
  assert.deepEqual(staticAbility.effect, {
    kind: "continuous.movement",
    permission: "battlefield-to-battlefield",
    source: "battlefield",
    destination: "battlefield",
    move: "standard",
    addsPermission: true
  });
});

test("Windswept Hillock golden: the equivalent layer registration records the granted keyword", () => {
  const unitHere = unit("unit-here");
  const engine = createLayerEngine([unitHere], [
    {
      effect: {
        id: "windswept-hillock",
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
  assert.deepEqual(snapshot.keywords, [{ id: "Ganking", value: undefined }]);
  assert.deepEqual(snapshot.keywords.map(keyword => keyword.id), ["Ganking"]);
  // 810.3: whether a unit has Ganking is a readable characteristic.
  assert.equal(snapshot.printed.keywords.length, 0);
  // The grant itself records no movement permission: the permission comes from
  // expanding the granted keyword (Ganking.ts), which the layers loader does not
  // do on its own.
  assert.deepEqual(snapshot.movement.restrictions, []);
  assert.equal(snapshot.movement.canGank, false);
});

test("Windswept Hillock gap: nothing in the merged engine registers the grant or consumes the permission", () => {
  // Three separate missing pieces, asserted as structure rather than by faking
  // the grant:
  //  1. no producer registers a card program's static ability as a
  //     ContinuousEffectSpec (registerContinuousEffect has no caller);
  //  2. the merged matcher ignores sameLocationAs, so "here" would over-grant;
  //  3. the granted continuous.movement permission is never read by
  //     zones/movement.ts, so Battlefield→Battlefield still cannot happen.
  const elsewhere = unit("unit-elsewhere", { location: { type: "battlefield", id: "battlefield-9" } });
  const engine = createLayerEngine([elsewhere], [
    {
      effect: {
        id: "windswept-hillock",
        layer: "ability",
        filter: ability.effect.filter,
        effect: ability.effect
      },
      duration: { type: "permanent" },
      timestamp: 1
    }
  ]);
  engine.setObjects([elsewhere]);
  // The unit at another Battlefield is granted Ganking even though the printed
  // scope is "here" (sameLocationAs is ignored by layers/filter.ts).
  assert.deepEqual(engine.evaluate(elsewhere.ref).keywords.map(keyword => keyword.id), ["Ganking"]);
  assert.equal(elsewhere.location.id, "battlefield-9");
});

test.todo(
  "Windswept Hillock registration + scope: a merged producer must register this CardProgram's " +
    "static ability as a ContinuousEffectSpec, and the 053.3 'here' referent needs the " +
    "sameLocationAs anchor in layers/filter.ts (RIFT-91), with 190.6's controller of the " +
    "Battlefield ability resolved"
);

test.todo(
  "Windswept Hillock movement: the granted continuous.movement permission must be read by the " +
    "Standard Move validation (144.4.c / 144.4.c.1, zones/movement.ts) so a unit here can move " +
    "Battlefield→Battlefield — no consumer of the layered movement permissions exists (RIFT-75)"
);
