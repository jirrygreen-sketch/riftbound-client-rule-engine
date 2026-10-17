// Golden test for Wuju Bladesman, Starter (ogs-019-024).
//
// The card declares one conditional Passive Ability ("While a friendly unit
// defends alone, it gets +2 :rb_might:.") as a continuous.might static effect
// (contract 3.1 / 3.7). The guard predicate has no merged evaluator, so the
// runnable evidence is validation, identity, the structural contract, the
// merged binder's fail-closed refusal of the guard key, and the layer filter's
// missing friendly/defends-alone semantics; the full aura stays test.todo.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/wuju-bladesman-starter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";

const CANONICAL_ID =
  "card.hash-cf38f851f4d3c20ede56526fcc1ad4c1ed2581cc73341deaa53ea09e51c15790";
const SOURCE_TEXT = "While a friendly unit defends alone, it gets +2 :rb_might:.";
const [ability] = program.abilities;

test("ogs-019-024 Wuju Bladesman, Starter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogs-019-024 Wuju Bladesman, Starter: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // README section 2: name the missing semantics and the dependent tasks.
  assert.match(program.judgeReason, /defends alone/);
  assert.match(program.judgeReason, /740\.2\.a/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /matchesObjectFilter/);
  assert.match(program.judgeReason, /staticFilter/);
  assert.match(program.judgeReason, /Legend Zone/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ogs-019-024 Wuju Bladesman, Starter: one static +2 Might aura over friendly units", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  // CR 364.3.a / 363: "While …" is the condition of a Passive Ability, which is
  // computed by the layers (continuous effects never enter the chain).
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 2 });
  assert.deepEqual(ability.effect.filter, {
    type: "unit",
    // The frozen PlayerSelector spelling for the ability controller (190.6.d).
    controller: "self",
    zone: "board",
    // Descriptive spelling of the "defends alone" guard (Defender designation +
    // CR 740.2.a "no other friendly units at the same location"); see judgeReason
    // for why no merged evaluator consumes it.
    defendsAlone: true
  });
  assert.equal(ability.effect.duration, undefined);
  // The ability has no instruction body: a static ability is not played or resolved.
  assert.equal(ability.body, undefined);
});

test("ogs-019-024 Wuju Bladesman, Starter: the aura is gated, never an unconditional +2", () => {
  // The guard cannot be dropped without changing the card: a bare
  // continuous.might on every friendly unit would grant +2 outside combat and
  // to units that are not defending alone. Assert the guard is present and is
  // NOT one of the layer conditions the merged engine evaluates
  // (always/never/type/has-tag/has-keyword), so the gap stays visible.
  const filterKeys = Object.keys(ability.effect.filter);
  assert.ok(filterKeys.includes("defendsAlone"));
  assert.equal(ability.effect.filter.type, "unit");
  assert.equal(ability.effect.filter.controller, "self");
  assert.equal(ability.effect.filter.zone, "board");
  // No Might condition would be honest: the card has no Might threshold.
  assert.equal(ability.effect.filter.mightGte, undefined);
  assert.equal(ability.condition, undefined);
});

test("ogs-019-024 Wuju Bladesman, Starter: the merged static binder fails closed on the defendsAlone guard", () => {
  // The RIFT-257 static binding path is merged, and it refuses this card's
  // guard key before any layer effect is registered: staticFilter throws on
  // defendsAlone, so the aura can never be registered as an unconditional +2.
  const source = {
    ref: { id: "wuju", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    controller: "A",
    owner: "A",
    zone: "board"
  };
  const engine = { layers: { addContinuous: () => { throw new Error("must not register"); } } };
  const binder = createEngineStaticBinder(engine);
  assert.throws(() => binder.bindStatic(program.abilities[0], source), (error) => {
    assert.ok(error instanceof ProgramBindingError);
    assert.match(error.message, /Unsupported static filter field defendsAlone/);
    return true;
  });
  // The judge-required status keeps the production registry from handing the
  // program to any lifecycle binder at all.
  const registry = new ProgramRegistry([program]);
  assert.throws(() => registry.get(CANONICAL_ID), (error) => {
    assert.ok(error instanceof ProgramBindingError);
    assert.equal(error.code, "judge-required");
    assert.match(error.message, /defends alone/);
    return true;
  });
});

test("ogs-019-024 Wuju Bladesman, Starter: production staticFilter normalizes friendly targets by controller", () => {
  const registered = [];
  const engine = {
    layers: {
      addContinuous: spec => registered.push(spec),
      removeContinuous: () => {}
    }
  };
  const source = {
    ref: { id: "wuju", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    controller: "A",
    owner: "A",
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" }
  };
  const binder = createEngineStaticBinder(engine);
  const bindableAbility = {
    ...program.abilities[0],
    effect: {
      ...program.abilities[0].effect,
      filter: { ...program.abilities[0].effect.filter }
    }
  };
  delete bindableAbility.effect.filter.defendsAlone;
  const handle = binder.bindStatic(bindableAbility, source);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].filter.controller, "A");
  assert.equal(registered[0].filter.zone, "board");

  const ally = {
    ref: { id: "u1", zoneEntryId: 1 },
    types: ["unit"],
    zone: "board",
    controller: "A",
    owner: "A",
    tags: [],
    location: { type: "battlefield", id: "battlefield-1" },
    exhausted: false,
    stunned: false,
    attachedTo: null,
    faceDown: false,
    combatRole: "defender",
    characteristics: {}
  };
  const enemy = { ...ally, ref: { id: "u2", zoneEntryId: 1 }, controller: "B", owner: "B" };
  assert.equal(matchesObjectFilter(registered[0].filter, ally), true);
  assert.equal(matchesObjectFilter(registered[0].filter, enemy), false);
  handle.unbind();
});

test.todo(
  "Wuju Bladesman, Starter: a friendly unit gets +2 Might exactly while it defends alone " +
    "(CR 363/364.3.a + 740.2.a: Defender designation from CR 466.2.c.3 with no other friendly " +
    "unit at the same location) — blocked because layers/filter.ts reads neither the merged " +
    "ObjectSnapshot.combatRole (contract 3.8) nor any same-location exclusion predicate, and " +
    "staticFilter rejects defendsAlone (contract change request)"
);

test.todo(
  "Wuju Bladesman, Starter: the resolution of the aura from the Legend Zone (CR 107.4.c / " +
    "174.2.b / 174.6) — the frozen ZoneId (effects/contract.ts) and the reference kernel have no " +
    "legend zone, and a static ability has no field to declare its source zone"
);
