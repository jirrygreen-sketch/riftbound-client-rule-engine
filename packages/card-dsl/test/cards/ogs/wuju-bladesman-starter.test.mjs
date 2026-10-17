// RIFT-667 single-card golden: validation, identity, the key IR structure of Wuju
// Bladesman, Starter, and the merged friendly-controller normalization. The
// whole-card execution evidence for this card lives in
// `test/cards/templates/static-667.test.mjs`.
//
// The card stays judge-required: staticFilter rejects the authored defendsAlone
// key, the aura has no binding for the recipient's combatRole or a same-location
// friendly-neighbour count, and the Legend Zone is absent from ZoneId. Nothing
// here approximates the printed effect.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/wuju-bladesman-starter.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";

const CANONICAL_ID = "card.hash-cf38f851f4d3c20ede56526fcc1ad4c1ed2581cc73341deaa53ea09e51c15790";
const SOURCE_TEXT = "While a friendly unit defends alone, it gets +2 :rb_might:.";
const [ability] = program.abilities;

test("ogs-019-024 Wuju Bladesman, Starter: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(CANONICAL_ID), program);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogs-019-024 Wuju Bladesman, Starter: one static +2 Might aura over friendly units", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // 479.4 / 479.4.a: "+2 Might" is an arithmetic-layer increase.
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 2 });
  // "friendly unit" uses the ability-controller spelling, and the printed
  // "defends alone" predicate is carried explicitly (no evaluator consumes it).
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    controller: "self",
    zone: "board",
    defendsAlone: true
  });
  assert.equal(ability.effect.appliesTo, undefined);
});

test("ogs-019-024 Wuju Bladesman, Starter: the production binder fails closed and never registers an unconditional +2", () => {
  // 363 / 364.3.a / 466.2.c.3 / 740.2.a: the guard key is refused outright, so
  // the aura can never be registered as an unconditional +2 Might.
  const source = {
    ref: { id: "wuju", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    name: "wuju",
    types: ["legend"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" },
    combatRole: null,
    might: null,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const engine = { layers: { addContinuous: () => { throw new Error("must not register"); }, removeContinuous: () => {} } };
  assert.throws(
    () => createEngineStaticBinder(engine).bindStatic(ability, source),
    /Unsupported static filter field defendsAlone/
  );
  // Control: dropping only the unmatched guard key shows the friendly-controller
  // normalization really resolves "self" to the source controller.
  const bindable = { ...ability, effect: { ...ability.effect, filter: { ...ability.effect.filter } } };
  delete bindable.effect.filter.defendsAlone;
  const registered = [];
  createEngineStaticBinder({ layers: { addContinuous: spec => registered.push(spec), removeContinuous: () => {} } })
    .bindStatic(bindable, source);
  assert.equal(registered.length, 1);
  assert.deepEqual(registered[0].filter, { type: "unit", controller: "A", zone: "board" });
  const ally = { ...source, ref: { id: "ally", zoneEntryId: 1 }, controller: "A", owner: "A", types: ["unit"] };
  const enemy = { ...ally, ref: { id: "enemy", zoneEntryId: 1 }, controller: "B", owner: "B" };
  assert.equal(matchesObjectFilter(registered[0].filter, ally), true);
  assert.equal(matchesObjectFilter(registered[0].filter, enemy), false);
});

test("ogs-019-024 Wuju Bladesman, Starter: judgeReason names the measured guards that are missing", () => {
  // Re-probed 2026-10-17 (RIFT-667).
  assert.match(program.judgeReason, /defendsAlone/);
  assert.match(program.judgeReason, /Legend Zone/);
});

test.todo(
  "ogs-019-024 Wuju Bladesman, Starter: a friendly unit must get +2 Might exactly while it defends alone " +
    "(CR 363 / 364.3.a / 466.2.c.3 / 814.1.d / 740.2.a) - needs a per-recipient static predicate binding the " +
    "recipient's combatRole and a same-location friendly-neighbour count (contract change request)"
);
test.todo(
  "ogs-019-024 Wuju Bladesman, Starter: the ability must resolve from the Legend Zone (CR 107.4.c / 174.2.b / " +
    "174.6) - effects/contract.ts ZoneId has no legend zone and the static ability has no source-zone field"
);
