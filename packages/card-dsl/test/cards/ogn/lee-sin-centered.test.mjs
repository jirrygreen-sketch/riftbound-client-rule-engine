import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/lee-sin-centered.js";
import accelerate from "../../../../engine-core/dist/effects/keywords/Accelerate.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import mightPrimitive from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { LayerEngine } from "../../../../engine-core/dist/layers/engine.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-98fc18fcf30d6dd0b192f1c6ea251dd6a2e6d4a439098c533f77e58a2161074f";
const c = value => ({ kind: "constant", value });

test("ogn-151-298 Lee Sin, Centered: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
      "Other buffed friendly units at my battlefield have +2 :rb_might:."
  );
});

test("ogn-151-298 Lee Sin, Centered: printed power is null (no printed value) and is never rewritten to 0", () => {
  // The catalog carries power: null; the program has no cost block at all, so
  // nothing can turn the missing printed value into a 0 cost. This test pins
  // that shape for reviewers.
  assert.equal(Object.hasOwn(program, "cost"), false);
  assert.equal(program.abilities.some(ability => ability.kind === "play"), false);
  assert.equal(JSON.stringify(program).includes('"power":0'), false);
  assert.equal(JSON.stringify(program).includes('"power": 0'), false);
});

test("ogn-151-298 Lee Sin, Centered: judgeReason cites the card-program binding, the buffed predicate and the location anchor", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /characteristics/);
  assert.match(program.judgeReason, /optionalAdditional/);
  assert.match(program.judgeReason, /sameLocationAs|锚点/);
  assert.match(program.judgeReason, /exclude/);
  assert.match(program.judgeReason, /accelerate\.cost/);
});

test("ogn-151-298 Lee Sin, Centered: the declared Accelerate keyword matches the merged KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Accelerate");
  assert.ok(registered, "effects/keywords/Accelerate.ts must be in the generated registry");
  assert.equal(program.abilities[0].keyword, registered.keyword.toLowerCase());
  assert.equal(registered.valued, false);
  assert.equal(registered.stacking, "single");
  assert.ok(registered.ruleRefs.includes("805.1.b"));
});

test("ogn-151-298 Lee Sin, Centered: Accelerate is declared, the +2 Might aura is a static effect", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, aura] = program.abilities;
  assert.deepEqual(keyword, { kind: "keyword", keyword: "accelerate" });

  assert.equal(aura.kind, "static");
  assert.equal(aura.effect.kind, "continuous.might");
  assert.equal(aura.effect.mode, "add");
  assert.equal(aura.effect.layer, "arithmetic");
  assert.deepEqual(aura.effect.amount, { kind: "constant", value: 2 });
  // 702.2.a/702.3: the "buffed" predicate is the Buff counter, which the merged
  // characteristics filter compares exactly; the location/other anchors stay the
  // contract 3.6 symbolic forms and remain the judged part (judgeReason).
  assert.deepEqual(aura.effect.filter, {
    type: "unit",
    controller: "controller",
    exclude: "self",
    sameLocationAs: "source",
    characteristics: { buffs: 1 }
  });
  assert.equal(aura.condition, undefined);
});

test("ogn-151-298 Lee Sin, Centered: the aura records the printed filter shape for reviewers", () => {
  // CR 740.1.a (friendly = same controller); printed "other" excludes the host,
  // 359.3.f.2 ("my battlefield" = host location), 702/703 (buffed state).
  assert.deepEqual(Object.keys(program.abilities[1].effect.filter), [
    "type",
    "controller",
    "exclude",
    "sameLocationAs",
    "characteristics"
  ]);
  assert.equal(program.abilities[1].effect.filter.exclude, "self");
  assert.equal(program.abilities[1].effect.filter.sameLocationAs, "source");
  assert.deepEqual(program.abilities[1].effect.filter.characteristics, { buffs: 1 });
});

test("ogn-151-298 Lee Sin, Centered: the merged continuous.might primitive registers the +2 aura it declares", () => {
  // The registered primitive is the layer consumer the aura's op declares; the
  // golden drives the card's own instruction through the interpreter so the
  // arithmetic-layer registration is the real one, not a hand-built effect.
  const base = world().unit("elder", { might: 3 }).unit("ally", { might: 2 }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("elder"), source: base.ref("elder") });
  const elderRef = kernel.ref("elder");
  const instruction = program.abilities[1].effect;
  assert.equal(instruction.kind, "continuous.might");
  assert.equal(instruction.mode, "add");
  // continuous.might's argsSchema accepts already-evaluated literals (the
  // interpreter evaluates Expr args before dispatch): pass the card's own
  // amount value and a locked target id.
  const run = runInstruction(mightPrimitive, {
    amount: instruction.amount.value,
    duration: "end-of-turn",
    target: "lee-sin-aura"
  }, { world: kernel, targets: { "lee-sin-aura": [elderRef] } });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, 2);
});

test.todo(
  "ogn-151-298 Lee Sin, Centered: 'Other buffed friendly units at my battlefield have +2 Might.' needs a " +
    "host-location ('my battlefield', 359.3.f.2) anchor the layer filter can match — statics.ts resolves " +
    "sameLocationAs to a structured location that layers/filter.ts never matches — and a dynamic 'other' " +
    'exclusion (printed "other"), which staticFilter rejects outright.'
);

test("ogn-151-298 Lee Sin, Centered: the characteristics predicate really identifies a Buffed unit (702.2.a/702.3)", () => {
  // The "buffed" state is the unit's Buff counter, which the merged layer filter compares exactly;
  // this is the part of the aura's filter vocabulary that the 2026-10-17 recheck could promote.
  const kernel = world()
    .unit("buffed-ally", { owner: "A", types: ["unit"], might: 2, buffs: 1 })
    .unit("plain-ally", { owner: "A", types: ["unit"], might: 2, buffs: 0 })
    .unit("enemy", { owner: "B", types: ["unit"], might: 2, buffs: 1 })
    .build();
  const layers = new LayerEngine(kernel.objects);
  layers.setObjects(kernel.objects);
  const byId = new Map(layers.evaluateAll().map((object) => [object.ref.id, object]));
  assert.equal(matchesObjectFilter({ type: "unit", characteristics: { buffs: 1 } }, byId.get("buffed-ally")), true);
  assert.equal(matchesObjectFilter({ type: "unit", characteristics: { buffs: 1 } }, byId.get("plain-ally")), false);
  assert.equal(matchesObjectFilter({ type: "unit", characteristics: { buffs: 1 } }, byId.get("enemy")), true);
});

test("ogn-151-298 Lee Sin, Centered TODO: the aura must apply +2 Might to other buffed friendlies at my battlefield", {
  todo: "359.3.f.2 / 478.1: the layer filter must follow the host's location and exclude the host itself"
}, () => {
  // The correct expectation follows the printed text: the host is excluded (printed "other") and the
  // aura only reaches buffed friendlies (702.2.a) at the host's battlefield (359.3.f.2). Today the
  // binder folds sameLocationAs into a STRUCTURED location that layers/filter.ts never matches and
  // rejects exclude: "self" outright, so the aura applies nowhere; the current result is not
  // written as the expected behaviour.
  const kernel = world()
    .unit("lee", { types: ["unit"], might: 6, location: { type: "battlefield", id: "bf-1" } })
    .unit("buffed-here", { owner: "A", types: ["unit"], might: 2, buffs: 1, location: { type: "battlefield", id: "bf-1" } })
    .unit("buffed-elsewhere", { owner: "A", types: ["unit"], might: 2, buffs: 1, location: { type: "battlefield", id: "bf-2" } })
    .unit("plain-here", { owner: "A", types: ["unit"], might: 2, buffs: 0, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const layers = new LayerEngine(kernel.objects);
  layers.setObjects(kernel.objects);
  layers.addContinuous({
    id: "lee-sin-aura",
    layer: "arithmetic",
    source: kernel.ref("lee"),
    filter: { type: "unit", controller: "A", exclude: "self", sameLocationAs: "source", characteristics: { buffs: 1 } },
    effect: { kind: "continuous.might", mode: "add", amount: 2 }
  }, { type: "permanent" });
  layers.setObjects(kernel.objects);
  const might = new Map(layers.evaluateAll().map((object) => [object.ref.id, object.might]));
  // Printed "other": the host itself is excluded; 359.3.f.2: only the host's battlefield; 702.2.a: only buffed units.
  assert.equal(might.get("lee"), 6);
  assert.equal(might.get("buffed-here"), 4);
  assert.equal(might.get("buffed-elsewhere"), 2);
  assert.equal(might.get("plain-here"), 2);
});

test("Lee Sin: the actual static binder blocks the aura's unsupported other anchor", () => {
  const f = fixture({ cards: [{ id: "lee", cardId: CANONICAL, types: ["unit"], might: 6 }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("lee"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  f.engine.advance();
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindStatic(program.abilities[1], f.kernel.getObject("lee")),
    /Static exclude anchor needs a dynamic relative filter/
  );
  assert.deepEqual(f.engine.layers.registry.list(), []);
});
