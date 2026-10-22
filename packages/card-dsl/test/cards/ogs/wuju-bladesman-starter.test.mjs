// RIFT-667 single-card golden: validation, identity, the key IR structure of Wuju
// Bladesman, Starter, and the merged friendly-controller normalization. The
// whole-card execution evidence for this card lives in
// `test/cards/templates/static-667.test.mjs`.
//
// Re-checked 2026-10-17/18. The card stays judge-required for exactly two
// measured reasons (judgeReason):
// - the printed "defends alone" predicate (CR 466.2.c.3 / 814.1.d / 740.2.a)
//   has no per-recipient static binding: staticFilter rejects the authored
//   defendsAlone key and the excluded/same-location anchors, and the production
//   condition is evaluated against the ability source while ignoring the
//   receiving object, so a per-recipient combatRole + friendly-neighbour count
//   cannot be expressed;
// - the Legend Zone (CR 107.4.c / 174.2.b / 174.6) is not part of the merged
//   ZoneId vocabulary, so the ability has no source-zone lifecycle.
// The merged parts really run and are asserted below: the arithmetic
// continuous.might registration, the controller:"self" normalization and the
// layers/filter.ts characteristics consumer (a control registration on
// characteristics.combatRole really gates the aura per recipient). Nothing
// here approximates the printed effect.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogs/wuju-bladesman-starter.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { ProgramBindingError } from "../../../../engine-core/dist/programs/errors.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  Object.assign(engine, { pipeline: { host: { objects: () => [source] } }, claimKeywords: () => ({}) });
  assert.throws(
    () => createEngineStaticBinder(engine).bindStatic(ability, source),
    /Unsupported static filter field defendsAlone/
  );
  // Control: dropping only the unmatched guard key shows the friendly-controller
  // normalization really resolves "self" to the source controller.
  const bindable = { ...ability, effect: { ...ability.effect, filter: { ...ability.effect.filter } } };
  delete bindable.effect.filter.defendsAlone;
  const registered = [];
  createEngineStaticBinder({
    layers: { addContinuous: spec => registered.push(spec), removeContinuous: () => {} },
    claimKeywords: () => ({})
  }).bindStatic(bindable, source);
  assert.equal(registered.length, 1);
  assert.deepEqual(registered[0].filter, { type: "unit", controller: "self", zone: "board" });
  const ally = { ...source, ref: { id: "ally", zoneEntryId: 1 }, controller: "A", owner: "A", types: ["unit"] };
  const enemy = { ...ally, ref: { id: "enemy", zoneEntryId: 1 }, controller: "B", owner: "B" };
  assert.equal(matchesObjectFilter(registered[0].filter, ally), true);
  assert.equal(matchesObjectFilter(registered[0].filter, enemy), false);
});

test("ogs-019-024 Wuju Bladesman, Starter: judgeReason names the measured guards that are missing", () => {
  // Re-probed 2026-10-17/18 (RIFT-667, RIFT-719).
  assert.match(program.judgeReason, /defendsAlone/);
  assert.match(program.judgeReason, /Legend Zone/);
  assert.match(program.judgeReason, /staticFilter/);
  assert.match(program.judgeReason, /characteristics/);
  assert.match(program.judgeReason, /RIFT-708/);
  assert.match(program.judgeReason, /466\.2\.c\.3/);
  assert.match(program.judgeReason, /740\.2\.a/);
});

test("ogs-019-024 Wuju Bladesman, Starter golden: the merged characteristics consumer really gates a combatRole aura per recipient", () => {
  // Control for the one changed input: the printed `defendsAlone` guard is
  // replaced by the merged ObjectFilter spelling
  // characteristics: { combatRole: "defender" }, which staticFilter accepts and
  // layers/filter.ts consumes. The rest — the arithmetic +2, controller "self",
  // the production binder and the real ChainEngine — is untouched, so this
  // measures how far the merged path reaches: the recipient's designation can
  // be read per recipient, the 740.2.a friendly-neighbour count cannot.
  const { engine, kernel } = engineFixture([
    // The legend is the ability source; it is not a Unit and gets nothing.
    { id: "legend", types: ["legend"], might: null },
    { id: "defender-ally", types: ["unit"], might: 2, combatRole: "defender" },
    { id: "attacker-ally", types: ["unit"], might: 2, combatRole: "attacker" },
    { id: "defender-enemy", types: ["unit"], might: 2, combatRole: "defender", owner: "B" }
  ]);
  createEngineStaticBinder(engine).bindStatic({
    ...ability,
    effect: {
      ...ability.effect,
      filter: { type: "unit", controller: "self", zone: "board", characteristics: { combatRole: "defender" } }
    }
  }, kernel.getObject("legend"));
  const [entry] = engine.layers.registry.list();
  assert.deepEqual(entry.effect.filter, {
    type: "unit",
    controller: "self",
    zone: "board",
    characteristics: { combatRole: "defender" }
  });
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("defender-ally")).might, 4, "CR 466.2.c.3 defender + the printed +2");
  assert.equal(engine.layers.evaluate(kernel.ref("attacker-ally")).might, 2, "an attacking friendly unit is not a defender");
  assert.equal(engine.layers.evaluate(kernel.ref("defender-enemy")).might, 2, "CR 740.1.b: an enemy defender is not friendly");
  assert.equal(engine.layers.evaluate(kernel.ref("legend")).might, 1, "the legend is the source, not a unit recipient");
});

test("ogs-019-024 Wuju Bladesman, Starter golden: the production condition is evaluated against the source and ignores the receiving unit", () => {
  // The bindStaticToLayers condition closure is built with
  // abilityEnvironment(engine, source); it never receives the object the layer
  // engine is currently evaluating. A per-recipient predicate such as the
  // printed "defends alone" therefore cannot be expressed: the measured
  // condition results below depend only on the legend's own snapshot.
  const { engine, kernel } = engineFixture([
    { id: "legend", types: ["legend"], might: 1 },
    { id: "ally", types: ["unit"], might: 7 }
  ]);
  createEngineStaticBinder(engine).bindStatic({
    ...ability,
    effect: { ...ability.effect, filter: { type: "unit", controller: "self", zone: "board" } },
    condition: {
      kind: "compare",
      operator: "eq",
      left: { kind: "object-property", object: "self", property: "might" },
      right: { kind: "constant", value: 2 }
    }
  }, kernel.getObject("legend"));
  engine.layers.setObjects(kernel.objects);
  const [entry] = engine.layers.registry.list();
  const recipient = engine.layers.snapshot(kernel.ref("ally"));
  assert.equal(recipient.might, 7);
  // The legend's Might is 1, so the guard is false even though the receiving
  // Unit itself would satisfy "Might equals 2".
  assert.equal(entry.effect.effect.condition(recipient), false);
  // Two different recipients get the identical answer: the closure ignores its
  // argument, so no receiving-object fact can ever gate this aura.
  assert.equal(entry.effect.effect.condition({ ...recipient, might: 999, combatRole: "defender" }), false);
});

test("ogs-019-024 Wuju Bladesman, Starter golden: a source-bound condition applies the +2 to an unrelated friendly unit", () => {
  // Same closure, but now the legend's own Might is 2. The aura is applied to
  // every friendly board unit regardless of that unit's own combat state — the
  // exact failure mode the printed "defends alone" guard exists to prevent.
  const { engine, kernel } = engineFixture([
    { id: "legend", types: ["legend"], might: 2 },
    { id: "ally", types: ["unit"], might: 2 }
  ]);
  createEngineStaticBinder(engine).bindStatic({
    ...ability,
    effect: { ...ability.effect, filter: { type: "unit", controller: "self", zone: "board" } },
    condition: {
      kind: "compare",
      operator: "eq",
      left: { kind: "object-property", object: "self", property: "might" },
      right: { kind: "constant", value: 2 }
    }
  }, kernel.getObject("legend"));
  engine.layers.setObjects(kernel.objects);
  assert.equal(engine.layers.evaluate(kernel.ref("ally")).might, 4);
});

test("ogs-019-024 Wuju Bladesman, Starter golden: sameLocationAs normalizes to a LocationRef the layer filter cannot match", () => {
  // The interpreter's queryObjects supports symbolic location anchors, but the
  // static aura does not run through it. staticFilter normalizes
  // sameLocationAs:"self" into a concrete LocationRef, and layers/filter.ts
  // then compares that object by reference identity (with a type-only string
  // fallback) against kernels that clone their snapshots, so the anchor does
  // not select the friendly neighbour. 740.2.a needs a per-object
  // same-location + friendly-only count instead.
  const { engine, kernel } = engineFixture([
    { id: "legend", types: ["legend"], zone: "board", location: { type: "battlefield", id: "battlefield-1" }, might: null },
    { id: "ally", types: ["unit"], might: 2 }
  ]);
  const registered = [];
  createEngineStaticBinder({
    layers: { addContinuous: spec => registered.push(spec), removeContinuous: () => {} },
    pipeline: { host: { objects: () => kernel.objects } },
    claimKeywords: () => ({})
  }).bindStatic({
    ...ability,
    effect: { ...ability.effect, filter: { type: "unit", controller: "self", zone: "board", sameLocationAs: "self" } }
  }, kernel.getObject("legend"));
  assert.deepEqual(registered[0].filter.location, { type: "battlefield", id: "battlefield-1" });
  engine.layers.setObjects(kernel.objects);
  const ally = engine.layers.snapshot(kernel.ref("ally"));
  assert.deepEqual(ally.location, { type: "battlefield", id: "battlefield-1" }, "the ally really is at the same location");
  assert.equal(matchesObjectFilter(registered[0].filter, ally), false, "the location object identity is not preserved by the cloned snapshot");
});

test("ogs-019-024 Wuju Bladesman, Starter golden: the reference kernel exposes the Legend Zone for its source", () => {
  // CR 107.4.c / 174.2.b / 174.6: a Legend can have Passive Abilities, and the
  // ability is established for the duration of regular play. The merged ZoneId
  // vocabulary and reference kernel now expose the public Legend Zone, so this
  // card can be placed as a source without using the Board as test scaffolding.
  const kernel = world().player("A", {}).build();
  const zones = Object.keys(kernel.stateForTest().players[0].zones);
  assert.deepEqual(zones, ["hand", "deck", "rune-deck", "trash", "banishment", "board", "rune-zone", "chain", "legend"]);
  assert.equal(zones.includes("legend"), true);
  const withLegend = world().player("A", {}).card("legend", { types: ["legend"], zone: "legend" }).build();
  assert.equal(withLegend.getObject("legend").zone, "legend");
});

test("ogs-019-024 Wuju Bladesman, Starter: staticFilter rejects the excluded/same-location anchors the printed guard would need", () => {
  // These are the merged rejections that make the printed guard unexpressible;
  // they are asserted so the gap is measured rather than described.
  const { kernel } = engineFixture([{ id: "legend", types: ["legend"], might: null }]);
  const source = kernel.getObject("legend");
  const binder = () => createEngineStaticBinder({
    layers: { addContinuous: () => { throw new Error("must not register"); }, removeContinuous: () => {} },
    pipeline: { host: { objects: () => kernel.objects } },
    claimKeywords: () => ({})
  });
  for (const filter of [
    { type: "unit", controller: "self", zone: "board", defendsAlone: true },
    { type: "unit", controller: "self", zone: "board", exclude: "self" }
  ]) {
    assert.throws(() => binder().bindStatic({ ...ability, effect: { ...ability.effect, filter } }, source), error => {
      assert.ok(error instanceof ProgramBindingError || error?.code === "judge-required");
      return true;
    });
  }
});

test.todo(
  "ogs-019-024 Wuju Bladesman, Starter: a friendly unit must get +2 Might exactly while it defends alone " +
    "(CR 363 / 364.3.a / 466.2.c.3 / 814.1.d / 740.2.a) - needs a per-recipient static predicate binding the " +
    "recipient's combatRole and a same-location friendly-neighbour count (contract change request)"
);
test.todo(
  "ogs-019-024 Wuju Bladesman, Starter: the ability must resolve from the Legend Zone (CR 107.4.c / 174.2.b / " +
    "174.6) - the merged ZoneId vocabulary has no legend zone and the static ability has no source-zone field"
);

/** A real ChainEngine over the given board objects, so the production binder,
 * the layer engine and the filter consumer all run on a live pipeline. */
function engineFixture(objects) {
  const builder = world().player("A", { energy: 0 }).player("B", { energy: 0 });
  for (const object of objects) builder.card(object.id, { zone: "board", location: { type: "battlefield", id: "battlefield-1" }, ...object });
  const kernel = builder.build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => { throw new Error("Unexpected choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  return { engine, kernel };
}
